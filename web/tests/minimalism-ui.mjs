import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.UI_QA_URL || "http://127.0.0.1:3001";
assert.equal(new URL(base).hostname, "127.0.0.1");
assert.equal(new URL(base).port, "3001", "Fixture service only; never run call writes against the live desk");
const output = "../operations/minimalism-review-20261008";
await mkdir(`${output}/screenshots`, { recursive: true });
const templates = (await (await fetch(`${base}/api/playbooks`)).json()).templates;
const first = await (await fetch(`${base}/api/prospects?id=uiqa_lead_001`)).json();
const second = await (await fetch(`${base}/api/prospects?id=uiqa_lead_002`)).json();
assert.match(first.company, /^Synthetic /);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
const page = await context.newPage();
const errors = [], checks = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (request.method() !== "GET") {
    assert.equal(new URL(request.url()).origin, base);
    assert.equal(new URL(request.url()).pathname, "/api/calls", "Only isolated fixture call records may be written");
  }
});
await page.route("**/api/dispatch?*", async (route) => {
  if (route.request().url().includes("mailboxPacing")) {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ mailboxes: [], limits: {}, isRunning: false }) });
    return;
  }
  await route.fulfill({ contentType: "application/json", body: JSON.stringify({
    snapshot: { is_running: false, is_paused: false, live_dispatch: false, sent_today: 0, queue_pending: 0 },
    templates: templates.map((template) => ({ name: template.name, isDefault: template.isDefault })),
    campaigns: [], eligibleCount: 2, hasMore: false,
    candidates: [first, second].map((lead) => ({ id: lead.id, company: lead.company, status: "Approved for Outreach", fit: 100, campaignId: lead.campaignId })),
  }) });
});

try {
  await page.goto(`${base}/#campaigns`);
  await page.locator(".dispatch-candidate").first().waitFor();
  assert.equal(await page.locator(".dock-item").count(), 5);
  assert.equal(await page.getByRole("link", { name: "Setup", exact: true }).count(), 0);
  assert.equal(await page.locator(".dock-telemetry").count(), 0);
  await page.locator(".dispatch-candidate input").first().check();
  await page.waitForFunction(() => document.querySelector('[aria-label="Preview recipient"]')?.value === "uiqa_lead_001");
  await page.getByText(`Previewing ${first.company}`, { exact: false }).waitFor();
  assert.equal(await page.getByLabel("Search prospects for email preview").count(), 0);
  await page.locator(".dispatch-candidate input").nth(1).check();
  await page.locator(".dispatch-candidate input").first().uncheck();
  await page.waitForFunction(() => document.querySelector('[aria-label="Preview recipient"]')?.value === "uiqa_lead_002");
  await page.locator(".campaign-email-preview-content").waitFor();
  await page.locator(".campaign-email-preview").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/screenshots/selected-recipient-mobile.png` });
  checks.push("five navigation choices; preview follows selection without a second search");

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: /Campaign setup/ }).click();
  await page.getByRole("heading", { name: "Campaign setup", exact: true }).waitFor();
  assert.equal(await page.getByText("Copyable research prompts", { exact: true }).count(), 0);
  assert.equal(await page.getByText(/Streamlit registry prompt/).count(), 0);
  await page.locator('summary').filter({ hasText: "Review saved draft values" }).click();
  await page.getByText("Preview linked email template", { exact: true }).waitFor();
  checks.push("one Settings entrance retains campaign setup and saved template review");

  await page.goto(`${base}/activity`);
  await page.getByText("SMTP accepted", { exact: true }).first().waitFor();
  await page.getByText("Bounce events", { exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Health and quotas" }).count(), 0);
  assert.match(await page.locator("main").innerText(), /Lifetime send events/);
  checks.push("Activity reports lifetime events, not delivery; duplicate quota panel removed");

  await page.goto(`${base}/#prospects`);
  await page.locator(".filter-label select").selectOption("Custom imported stage");
  await page.getByRole("button", { name: /^Open Synthetic / }).first().click();
  await page.locator("#prospect-stage").waitFor({ state: "attached" });
  assert.equal(await page.locator("#prospect-stage").inputValue(), "Custom imported stage");
  await page.getByRole("button", { name: "Close prospect details" }).click();
  await page.locator(".filter-label select").selectOption("all");
  await page.getByLabel("Campaign scope", { exact: true }).selectOption(first.campaignId);
  await page.getByRole("button", { name: `Open ${first.company}`, exact: true }).click();
  await page.getByRole("link", { name: /Check this email/ }).click();
  await page.getByRole("link", { name: "← Prospects", exact: true }).click();
  await page.getByRole("heading", { name: first.company, exact: true }).waitFor();
  assert.equal(await page.getByLabel("Campaign scope", { exact: true }).inputValue(), first.campaignId);
  checks.push("custom imported stages filter/display without mutation; email-check return preserves campaign/contact");
  await page.getByRole("button", { name: "Close prospect details" }).click();

  await page.getByRole("link", { name: "Call", exact: true }).click();
  await page.getByText("Queue filters", { exact: false }).first().click();
  await page.getByLabel("Search call queue", { exact: true }).fill("Pagination");
  await page.getByRole("heading", { name: "Synthetic Pagination Contact 000", exact: true }).waitFor();
  await page.locator("#call-notes").fill("Keep these unsaved notes");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Skip →", exact: true }).click();
  assert.equal(await page.locator("#call-notes").inputValue(), "Keep these unsaved notes");
  await page.getByRole("heading", { name: "Synthetic Pagination Contact 000", exact: true }).waitFor();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Email", exact: true }).click();
  assert.equal(new URL(page.url()).hash, "#dialer");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Skip →", exact: true }).click();
  await page.getByRole("heading", { name: "Synthetic Pagination Contact 001", exact: true }).waitFor();
  assert.equal(await page.locator("#call-notes").inputValue(), "");
  await page.getByRole("button", { name: "← Previous", exact: true }).click();
  checks.push("unsaved notes are kept on cancelled navigation; discard requires confirmation");

  for (let i = 0; i < 99; i++) await page.getByRole("button", { name: "Skip →", exact: true }).click();
  await page.getByRole("heading", { name: "Synthetic Pagination Contact 099", exact: true }).waitFor();
  await page.locator("#call-notes").fill("Delayed-save fixture proof");
  let release;
  await page.route("**/api/calls", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    await new Promise((resolve) => { release = resolve; });
    await route.continue();
  });
  await page.getByRole("button", { name: "No answer", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#call-notes")?.disabled);
  assert.equal(await page.getByLabel("Call script style", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel("Campaign scope", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Skip →", exact: true }).isDisabled(), true);
  await page.getByRole("link", { name: "Email", exact: true }).click();
  assert.equal(new URL(page.url()).hash, "#dialer");
  release();
  await page.getByRole("button", { name: "Load next contacts", exact: true }).waitFor();
  await page.unroute("**/api/calls");
  await page.getByRole("button", { name: "Load next contacts", exact: true }).click();
  await page.getByRole("heading", { name: "Synthetic Pagination Contact 100", exact: true }).waitFor();
  await page.getByRole("button", { name: "No answer", exact: true }).click();
  await page.getByText("Queue complete. No more contacts in this view.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "No answer", exact: true }).count(), 0);
  checks.push("slow save locks contact changes; contact100 continues to101; final save shows completion");

  const layouts = [];
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/#campaigns", "/#prospects", "/#settings", "/activity", "/playbooks", "/mailboxes"]) {
      await page.goto(`${base}${path}`);
      await page.locator("main").waitFor();
      const layout = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth }));
      assert.ok(layout.documentWidth <= width + 1, `${path} overflows at ${width}`);
      layouts.push({ path, ...layout });
    }
  }
  assert.deepEqual(errors, []);
  const proof = { checks, layouts, pageErrors: errors, fixtureOnly: true, realEmailControlsUsed: false };
  await writeFile(`${output}/browser-proof.json`, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
} catch (error) {
  console.error("Failed browser check at", page.url(), "after", checks);
  await page.screenshot({ path: `${output}/screenshots/failed-check.png`, fullPage: true });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
