import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import Database from "better-sqlite3";

const base = "http://127.0.0.1:3001";
const output = "../operations/full-ui-qc-20261008";
const db = new Database(`${output}/fixture.sqlite`, { fileMustExist: true });
assert.equal(db.prepare("SELECT marker FROM ui_qc_fixture").get().marker, "full-ui-qc-fixture-only");
db.prepare("DELETE FROM mailboxes WHERE email='qc-sender@example.test'").run();
db.prepare("DELETE FROM email_suppression WHERE email='qc-optout@example.test'").run();
db.close();
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const checks = [], errors = [], invalidControlErrors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (/invalid form control.*not focusable/i.test(message.text())) invalidControlErrors.push(message.text()); });
page.on("dialog", (dialog) => dialog.accept());
page.on("request", (request) => assert.equal(new URL(request.url()).hostname, "127.0.0.1", "No external browser requests allowed"));
const fold = (title) => page.getByText(title, { exact: true }).locator("..");
async function open(title) { const element = fold(title); if (!await element.evaluate((node) => node.open)) await page.getByText(title, { exact: true }).click(); return element; }
async function check(name, fn) {
  try { await fn(); checks.push({ name, status: "passed" }); }
  catch (error) { checks.push({ name, status: "failed", error: error.message }); await page.screenshot({ path: `${output}/failure-${checks.length}.png` }); throw error; }
}
async function reset() { await page.unrouteAll({ behavior: "wait" }); }
async function go(path) { await page.goto("about:blank"); await page.goto(`${base}${path}`); }
const config = await (await fetch(`${base}/api/dns-tools`)).json();
try {
  await check("Settings: every disclosure open; padded content, section gaps, keyboard toggle, real DNS template downloads; desktop/tablet/mobile", async () => {
    for (const width of [1440, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await go("/#settings");
      await page.getByRole("combobox", { name: "Campaign scope", exact: true }).selectOption("hydroball_clones");
      const dns = await open("Domain & deliverability tools");
      await open("Send window"); await open("Sender limits");
      await page.locator(".mailbox-pacing-row").first().waitFor();
      assert.equal(await page.locator(".dns-tools h2").count(), 0);
      assert.equal(await page.locator(".dns-tools h3").count(), 3);
      const geometry = await dns.evaluate((node) => {
        const summary = node.querySelector("summary").getBoundingClientRect();
        const first = node.querySelector("h3").getBoundingClientRect();
        const domain = node.querySelector(".dns-audit-input-row").getBoundingClientRect();
        const guide = node.querySelector(".dns-record-guide").getBoundingClientRect();
        return { inset: first.left-node.getBoundingClientRect().left, topGap: first.top-summary.bottom, sectionGap: guide.top-domain.bottom };
      });
      assert.ok(geometry.inset >= 16 && geometry.topGap >= 16 && geometry.sectionGap >= 20, JSON.stringify(geometry));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const summary = dns.locator("summary").first();
      await summary.focus(); await summary.press("Enter"); assert.equal(await dns.evaluate((node) => node.open), false);
      await summary.press("Space"); assert.equal(await dns.evaluate((node) => node.open), true);
      assert.ok(parseFloat(await summary.evaluate((node) => getComputedStyle(node).outlineWidth)) >= 2);
      await dns.scrollIntoViewIfNeeded();
      if ([1440,375].includes(width)) await page.screenshot({ path: `${output}/after-settings-open-${width}.png` });
    }
    for (const label of [/^Download BIND zone/, /^Download Cloudflare API JSON/]) {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("link", { name: label }).click();
      const download = await downloadPromise;
      await download.saveAs(`${output}/${download.suggestedFilename()}`);
      assert.equal(await download.failure(), null);
    }
  });

  await check("DNS: delayed/busy, CLEAN/LISTED/INCOMPLETE/error/retry states are explicit (synthetic provider responses); failed config has retry", async () => {
    await page.route("**/api/dns-tools", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const overall_status = page.__dnsResult || "CLEAN";
      if (overall_status === "ERROR") return route.fulfill({ status: 503, json: { error: "Synthetic DNS timeout" } });
      await new Promise((resolve) => setTimeout(resolve, 250));
      return route.fulfill({ json: { domain: "example.test", is_listed: overall_status === "LISTED", overall_status,
        checked_at: new Date().toISOString(), checks: [{ service: "Fixture DNSBL", status: overall_status === "INCOMPLETE" ? "QUERY_TIMEOUT" : overall_status, return_code: "127.0.0.2" }] } });
    });
    await page.getByLabel("Domain", { exact: true }).fill("example.test");
    for (const [state, heading] of [["CLEAN", "No listings found"], ["LISTED", "Listing found"], ["INCOMPLETE", "Check incomplete"], ["ERROR", "Synthetic DNS timeout"], ["CLEAN", "No listings found"]]) {
      page.__dnsResult = state;
      await page.getByRole("button", { name: "Run DNSBL check", exact: true }).click();
      if (state !== "ERROR") {
        await page.getByRole("button", { name: "Checking…", exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Checking…", exact: true }).isDisabled(), true);
      }
      await page.locator(".dns-tools").getByText(heading, { exact: true }).waitFor();
      if (state === "INCOMPLETE") await page.getByText("At least one provider did not answer. This result does not establish a clean reputation.", { exact: true }).waitFor();
    }
    await reset();
    let configFailed = true;
    await page.route("**/api/dns-tools", (route) => configFailed ? route.fulfill({ status: 503, json: { error: "Synthetic DNS config failure" } }) : route.fulfill({ json: config }));
    await go("/#settings"); await open("Domain & deliverability tools");
    await page.getByText("Synthetic DNS config failure", { exact: true }).waitFor();
    configFailed = false;
    await page.getByRole("button", { name: "Retry DNS settings", exact: true }).click();
    await page.getByRole("button", { name: "Run DNSBL check", exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector(".dns-audit-form button").disabled);
    await reset();
  });

  await check("Sender-limit loading error is visible and retryable; successful fixture save remains saved when refresh fails", async () => {
    let fail = true;
    await page.route("**/api/dispatch?mailboxPacing=1", (route) => fail ? route.fulfill({ status: 503, json: { error: "Synthetic pacing outage" } }) : route.continue());
    await go("/#settings"); await open("Sender limits");
    await page.getByText("Synthetic pacing outage", { exact: true }).waitFor();
    fail = false;
    await page.getByRole("button", { name: "Retry sender limits", exact: true }).click();
    const row = page.locator(".mailbox-pacing-row").first(); await row.waitFor();
    await row.getByLabel("Daily cap", { exact: true }).fill("50");
    await row.getByLabel("Hourly cap", { exact: true }).fill("10");
    fail = true;
    const post = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/dispatch" && response.request().method() === "POST");
    await row.getByRole("button", { name: "Save limits", exact: true }).click();
    assert.equal((await post).status(), 200);
    await page.getByText("Sender limits saved. The current queue will recheck its available capacity.", { exact: true }).waitFor();
    await page.getByText("Synthetic pacing outage", { exact: true }).waitFor();
    await reset();
    await page.getByRole("button", { name: "Retry sender limits", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".mailbox-pacing-row p")?.textContent.includes("50/day"));
  });

  await check("Senders: add/edit forms, field grid/gaps, native validation, real fixture save, cancel/delete/pause confirmations, suppression feedback", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await go("/mailboxes");
    await page.getByRole("button", { name: "Edit bryanlai@openclose-desk.com", exact: true }).click();
    await page.getByText("Connection and sending limits", { exact: true }).click();
    const geometry = await page.locator("form details label").evaluateAll((nodes) => nodes.map((node) => ({ label: node.textContent, x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y, bottom: node.getBoundingClientRect().bottom })));
    assert.equal(geometry[0].y, geometry[1].y);
    assert.ok(geometry[1].x-geometry[0].x > 100);
    assert.ok(geometry[2].y-geometry[0].bottom >= 12);
    await page.screenshot({ path: `${output}/after-sender-edit-1440.png` });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Add sender", exact: true }).click();
    await page.getByLabel("Email address", { exact: true }).fill("qc-sender@example.test");
    await page.getByLabel("Sender name", { exact: true }).fill("QC fixture");
    await page.getByText("Connection and sending limits", { exact: true }).click();
    await page.getByRole("button", { name: "Add paused mailbox", exact: true }).click();
    await page.getByLabel("SMTP username", { exact: true }).waitFor({ state: "visible" });
    assert.deepEqual(invalidControlErrors, []);
    await page.getByLabel("SMTP server", { exact: true }).fill("smtp.invalid");
    await page.getByLabel("SMTP username", { exact: true }).fill("fixture-login");
    await page.getByLabel("SMTP password", { exact: true }).fill("fixture-only");
    await page.getByLabel("Daily quota", { exact: true }).fill("50");
    await page.getByLabel("Hourly quota", { exact: true }).fill("10");
    const created = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/mailboxes" && r.request().method() === "POST");
    await page.getByRole("button", { name: "Add paused mailbox", exact: true }).click();
    assert.equal((await created).status(), 201);
    await page.getByRole("button", { name: "Activate qc-sender@example.test", exact: true }).waitFor();
    await page.getByRole("button", { name: "Edit qc-sender@example.test", exact: true }).click();
    await page.getByText("Connection and sending limits", { exact: true }).click();
    assert.equal(await page.getByLabel("Daily quota", { exact: true }).inputValue(), "50");
    await page.setViewportSize({ width: 375, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${output}/after-sender-edit-375.png` });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Activate qc-sender@example.test", exact: true }).click();
    await page.getByRole("button", { name: "Pause qc-sender@example.test", exact: true }).waitFor();
    page.removeAllListeners("dialog"); page.on("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Pause qc-sender@example.test", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Pause qc-sender@example.test", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Delete qc-sender@example.test", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Edit qc-sender@example.test", exact: true }).count(), 1);
    page.removeAllListeners("dialog"); page.on("dialog", (dialog) => dialog.accept());
    await page.getByLabel("Email to suppress", { exact: true }).fill("qc-optout@example.test");
    await page.getByLabel("Reason", { exact: true }).fill("QC fixture only");
    await page.getByRole("button", { name: "Add to suppression list", exact: true }).click();
    await page.getByText("qc-optout@example.test", { exact: true }).waitFor();
    await page.getByLabel("Email to suppress", { exact: true }).fill("qc-optout@example.test");
    await page.getByLabel("Reason", { exact: true }).fill("QC duplicate fixture");
    await page.getByRole("button", { name: "Add to suppression list", exact: true }).click();
    await page.getByText("That address was already on the suppression list.", { exact: true }).waitFor();
  });

  await check("Sender refresh loading/failure/retry/empty; warmup metadata outage never claims Available (synthetic responses)", async () => {
    await page.route("**/api/dispatch?mailboxPacing=1", (route) => route.fulfill({ status: 503, json: { error: "Synthetic pacing outage" } }));
    await go("/mailboxes");
    const oldWarmup = page.locator("article").filter({ has: page.getByText("bryan@openclose-desk.com", { exact: true }) });
    await oldWarmup.getByText("Unknown", { exact: true }).waitFor();
    await oldWarmup.getByText(/Effective limits unavailable/).waitFor();
    await reset();
    let mode = "error";
    await page.route("**/api/mailboxes", async (route) => mode === "error" ? route.fulfill({ status: 503, json: { error: "Synthetic sender outage" } }) : mode === "empty" ? route.fulfill({ json: { mailboxes: [], suppressions: [] } }) : route.continue());
    await page.getByRole("button", { name: "Refresh mailboxes", exact: true }).click();
    await page.getByText("Synthetic sender outage", { exact: true }).waitFor();
    mode = "empty";
    await page.getByRole("button", { name: "Refresh mailboxes", exact: true }).click();
    await page.getByText("No mailboxes are configured.", { exact: true }).waitFor();
    mode = "restored";
    await page.getByRole("button", { name: "Refresh mailboxes", exact: true }).click();
    await page.getByRole("button", { name: "Edit qc-sender@example.test", exact: true }).waitFor();
    await reset();
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(invalidControlErrors, []);
} finally {
  await writeFile(`${output}/panel-quality-proof.json`, JSON.stringify({ checks, errors, invalidControlErrors, environment: "isolated SMTP-disabled fixture; DNS provider responses synthesized" }, null, 2));
  console.log(JSON.stringify({ checks, errors, invalidControlErrors }, null, 2));
  await reset(); await browser.close();
}
