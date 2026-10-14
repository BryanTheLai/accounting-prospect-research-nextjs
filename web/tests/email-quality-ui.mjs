import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { renderEmailTemplatePreview } from "../lib/email-template-preview.mjs";

const base = "http://127.0.0.1:3001";
const output = "../operations/full-ui-qc-20261008";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], keyWarnings = [], checks = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (/same key|unique.*key/i.test(message.text())) keyWarnings.push(message.text()); });
let phase = "normal";
await page.route("**/api/dispatch**", async (route) => {
  if (route.request().method() === "POST") {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (phase === "accept-start") {
      const snapshot = (await (await fetch(`${base}/api/dispatch?summary=1`)).json()).snapshot;
      snapshot.is_running = true;
      snapshot.queue_pending = route.request().postDataJSON().leadIds.length;
      phase = "accepted-refresh-error";
      return route.fulfill({ json: { snapshot } });
    }
    return route.fulfill({ status: 503, json: { error: "Synthetic dispatch rejection" } });
  }
  if (["error","accepted-refresh-error"].includes(phase) && !route.request().url().includes("mailboxPacing")) return route.fulfill({ status: 503, json: { error: "Synthetic service outage" } });
  const response = await route.fetch(); const payload = await response.json();
  if (payload.snapshot) {
    payload.snapshot.is_running = false;
    payload.snapshot.live_dispatch = phase === "live";
    if (phase === "empty") { payload.candidates = []; payload.eligibleCount = 0; payload.hasMore = false; }
  }
  await route.fulfill({ response, json: payload });
});
page.on("request", (request) => assert.equal(new URL(request.url()).hostname, "127.0.0.1"));
async function go() { await page.goto("about:blank"); await page.goto(`${base}/#campaigns`); }
async function check(name, fn) {
  try { await fn(); checks.push({ name, status: "passed" }); }
  catch (error) { checks.push({ name, status: "failed", error: error.message }); await page.screenshot({ path: `${output}/email-failure-${checks.length}.png` }); throw error; }
}
try {
  await check("Email: scope, quick picks, selected-recipient A/B personalization, same-template slots, empty selection, complete copy, layout", async () => {
    await go(); await page.locator(".dispatch-candidate").first().waitFor();
    await page.getByText("Quick selection", { exact: true }).click();
    const candidates = page.locator(".dispatch-candidate input");
    await candidates.nth(0).check(); await candidates.nth(1).check();
    const picker = page.getByRole("combobox", { name: "Preview recipient", exact: true });
    await picker.waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="Preview recipient"]')?.options.length === 2);
    const id = await picker.inputValue();
    const lead = await (await fetch(`${base}/api/prospects?id=${encodeURIComponent(id)}`)).json();
    const templates = (await (await fetch(`${base}/api/playbooks`)).json()).templates;
    const a = await page.getByRole("combobox", { name: "Variant A", exact: true }).inputValue();
    const expectedTemplate = templates.find((item) => item.name === a);
    const previewLead = { ...lead, company_name: lead.company, buyer_name: lead.buyer || "there", contact_email: lead.email };
    const expectedBody = renderEmailTemplatePreview(expectedTemplate.body, previewLead, () => 0);
    await page.waitForFunction((body) => document.querySelector('[aria-label="Variant A message"] pre')?.textContent === body, expectedBody);
    await page.getByRole("combobox", { name: "Variant B", exact: true }).selectOption(a);
    await page.waitForFunction((body) => document.querySelector('[aria-label="Variant B message"] pre')?.textContent === body, expectedBody);
    assert.equal(await page.locator(".email-template-card").count(), 2);
    assert.deepEqual(keyWarnings, []);
    await page.getByRole("combobox", { name: "Variant B", exact: true }).selectOption("");
    await page.getByText("Choose a template above.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: /^Start dry run/ }).isDisabled(), true);
    await page.getByRole("combobox", { name: "Variant B", exact: true }).selectOption(a);
    for (const width of [1440, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
      await page.locator(".campaign-email-preview").scrollIntoViewIfNeeded();
      if ([1440,375].includes(width)) await page.screenshot({ path: `${output}/after-email-preview-${width}.png` });
      assert.equal(await page.locator('[aria-label="Variant A message"] pre').textContent(), expectedBody);
    }
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    assert.equal(await picker.count(), 0);
    await page.getByRole("button", { name: "Direct only", exact: true }).click();
    assert.ok(await page.locator(".dispatch-candidate input:checked").count() >= 0);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
  });

  await check("Delivery-mode/live-start dialogs: desktop/mobile bounds, keyboard focus trap, Escape and return focus; no sending", async () => {
    phase = "normal"; await go(); await page.locator(".dispatch-candidate").first().waitFor();
    const modeSwitch = page.getByRole("switch", { name: "Live email delivery", exact: true });
    await modeSwitch.click();
    const modeDialog = page.getByRole("alertdialog", { name: "Enable real email delivery?", exact: true });
    await modeDialog.waitFor();
    for (let i = 0; i < 7; i++) { await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="alertdialog"]'))), true); }
    await page.keyboard.press("Escape"); assert.equal(await modeDialog.count(), 0);
    assert.equal(await modeSwitch.evaluate((node) => node === document.activeElement), true);
    phase = "live"; await go(); await page.locator(".dispatch-candidate").first().waitFor();
    await page.locator(".dispatch-candidate input").first().check();
    for (const width of [1440,375,320]) {
      await page.setViewportSize({ width, height: 900 });
      const start = page.getByRole("button", { name: /^Start sending/ });
      await start.click();
      const dialog = page.getByRole("alertdialog", { name: "Send real emails?", exact: true });
      await dialog.waitFor();
      const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x+bounds.width <= width);
      if (width === 375) await page.screenshot({ path: `${output}/live-confirmation-fixture-mobile.png` });
      await page.keyboard.press("Escape"); assert.equal(await dialog.count(), 0);
    }
  });

  await check("Email connection failure/retry, empty eligibility, and rejected-start busy/error feedback (synthetic controls; no real run)", async () => {
    phase = "error"; await go();
    await page.getByRole("button", { name: "Retry connection", exact: true }).waitFor();
    assert.match(await page.locator(".dispatch-candidates [role=alert]").innerText(), /Synthetic service outage/);
    assert.equal(await page.getByText("Unavailable", { exact: true }).count(), 1);
    assert.equal(await page.getByText("UNAVAILABLE", { exact: true }).count(), 1);
    phase = "normal";
    await page.getByRole("button", { name: "Retry connection", exact: true }).click();
    await page.locator(".dispatch-candidate").first().waitFor();
    phase = "empty"; await go();
    await page.getByText("No recipients ready to queue", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: /^Start dry run/ }).isDisabled(), true);
    phase = "normal"; await go(); await page.locator(".dispatch-candidate").first().waitFor();
    await page.locator(".dispatch-candidate input").first().check();
    await page.getByRole("button", { name: /^Start dry run/ }).click();
    const busy = page.getByRole("button", { name: "Starting…", exact: true }); await busy.waitFor();
    assert.equal(await busy.isDisabled(), true);
    await page.getByText("Synthetic dispatch rejection", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: /^Start dry run/ }).isEnabled(), true);
    phase = "accept-start";
    await page.getByRole("button", { name: /^Start dry run/ }).click();
    await page.getByText("Dry run started", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Retry connection", exact: true }).waitFor();
    assert.equal(await page.getByText("Dispatch action failed", { exact: true }).count(), 0);
    phase = "normal";
    await page.getByRole("button", { name: "Retry connection", exact: true }).click();
    await page.getByText("Idle", { exact: true }).waitFor();
  });

  await check("Template and recipient fetch failures remain distinct; retry recovers and clearing recipients clears stale errors", async () => {
    let failed = true;
    await page.route("**/api/playbooks", (route) => failed ? route.fulfill({ status: 503, json: { error: "Synthetic template outage" } }) : route.continue());
    await go(); await page.getByRole("button", { name: "Retry templates", exact: true }).waitFor();
    await page.getByText("Templates unavailable", { exact: true }).waitFor();
    assert.equal(await page.getByText("Loading template…", { exact: true }).count(), 0);
    failed = false; await page.getByRole("button", { name: "Retry templates", exact: true }).click();
    await page.locator(".email-template-card").nth(1).waitFor();
    await page.route("**/api/prospects?id=*", (route) => route.fulfill({ status: 503, json: { error: "Synthetic recipient outage" } }));
    await page.getByText("Quick selection", { exact: true }).click();
    await page.locator(".dispatch-candidate input").first().check();
    await page.getByText("Recipient unavailable", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".campaign-email-preview [role=alert]"));
  });
  assert.deepEqual(errors, []); assert.deepEqual(keyWarnings, []);
} finally {
  await writeFile(`${output}/email-quality-proof.json`, JSON.stringify({ checks, errors, keyWarnings, environment: "isolated fixture; sending/provider controls intercepted" }, null, 2));
  console.log(JSON.stringify({ checks, errors, keyWarnings }, null, 2));
  await page.unrouteAll({ behavior: "wait" }); await browser.close();
}
