import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.UI_QA_URL || "http://127.0.0.1:3001";
assert.equal(new URL(base).hostname, "127.0.0.1", "Local browser QA only");
const output = resolve("../operations/ui-qa/mobile-20261007");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 844 }, reducedMotion: "reduce" });
const page = await context.newPage();
const errors = [];
const failedApiRequests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (new URL(response.url()).pathname.startsWith("/api/") && response.status() >= 400) failedApiRequests.push({ path: new URL(response.url()).pathname, status: response.status() });
});
const results = [];
const flows = [];
const routes = ["/#campaigns", "/#prospects", "/#settings", "/playbooks", "/activity", "/mailboxes", "/email-preflight", "/import", "/yc"];

async function layout() {
  return page.evaluate(() => {
    const visible = (element) => element.checkVisibility() && element.getClientRects().length;
    const overflow = [...document.querySelectorAll("main *")].filter((element) => {
      if (!visible(element) || element.closest(".sr-only")) return false;
      let parent = element.parentElement;
      while (parent && parent !== document.body) {
        if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth) return false;
        parent = parent.parentElement;
      }
      const rect = element.getBoundingClientRect();
      return rect.right > innerWidth + 1 || rect.left < -1;
    }).slice(0, 10).map((element) => element.className || element.tagName);
    const small = [...document.querySelectorAll("main button, main select, main summary, main a.button, nav a")]
      .filter(visible).map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: (element.getAttribute("aria-label") || element.textContent).trim().slice(0, 60), width: rect.width, height: rect.height };
      }).filter((rect) => rect.width < 43.5 || rect.height < 43.5);
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow, small };
  });
}

async function checkFlow(name) {
  const state = await layout();
  assert.ok(state.scrollWidth <= state.width, `${name}: page overflow`);
  assert.deepEqual(state.overflow, [], `${name}: clipped content`);
  if (state.width <= 390) assert.deepEqual(state.small, [], `${name}: small touch targets`);
  await checkLightTheme();
  flows.push(name);
}

async function checkLightTheme() {
  const state = await page.evaluate(() => {
    const rgb = (value) => value.match(/[\d.]+/g)?.map(Number);
    const luminance = (color) => color.slice(0, 3).map((value) => value / 255)
      .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
    const lowContrast = [];
    for (const element of document.querySelectorAll("main *, nav *")) {
      if (!element.checkVisibility() || !element.textContent.trim() || element.children.length || element.closest("button:disabled") || element.tagName === "OPTION") continue;
      const foreground = rgb(getComputedStyle(element).color);
      let parent = element;
      let background = [255, 255, 255];
      while (parent) {
        const candidate = rgb(getComputedStyle(parent).backgroundColor);
        if (candidate && candidate[3] !== 0) { background = candidate; break; }
        parent = parent.parentElement;
      }
      const ratio = (Math.max(luminance(foreground), luminance(background)) + .05) / (Math.min(luminance(foreground), luminance(background)) + .05);
      if (ratio < 4.5) lowContrast.push({ text: element.textContent.trim().slice(0, 60), ratio: Number(ratio.toFixed(2)) });
    }
    return { colorScheme: getComputedStyle(document.documentElement).colorScheme, lowContrast };
  });
  assert.equal(state.colorScheme, "light", "Light mode is the only active theme");
  assert.deepEqual(state.lowContrast, [], "Visible text contrast against solid surfaces");
}

try {
  for (const width of [320, 375, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of routes) {
      await page.goto(base + route, { waitUntil: "networkidle" });
      await page.locator("h1").waitFor();
      const state = await layout();
      results.push({ route, ...state });
      assert.ok(state.scrollWidth <= width, `${route} at ${width}: page overflow ${state.scrollWidth}`);
      assert.deepEqual(state.overflow, [], `${route} at ${width}: clipped content`);
      if (width <= 390) assert.deepEqual(state.small, [], `${route} at ${width}: small touch targets`);
      await checkLightTheme();
      if (width <= 390 && route.startsWith("/#")) {
        assert.equal(await page.locator("h1").evaluate((element) => getComputedStyle(element).fontSize), "20px", "Smaller mobile heading actually wins the cascade");
      }
    }
  }
  if (new URL(base).port === "3001") assert.deepEqual(failedApiRequests, [], "Populated route load APIs succeed before intentional fault tests");
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto(base + "/#prospects", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Open / }).first().click();
  const details = page.getByRole("dialog", { name: "Selected prospect details" });
  await details.waitFor();
  const rect = await details.boundingBox();
  assert.ok(rect.x >= 0 && rect.x + rect.width <= 375 && rect.y >= 0 && rect.y + rect.height <= 844, "Prospect sheet fits viewport");
  await page.screenshot({ path: resolve(output, "prospect-sheet-mobile.png") });
  await page.keyboard.press("Escape");
  await details.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Open ")), true, "Focus returns to selected row");
  await page.getByRole("button", { name: "Add prospect", exact: true }).click();
  const formDialog = page.getByRole("dialog", { name: "Add a prospect" });
  await formDialog.waitFor();
  assert.equal(await page.getByLabel("Company name", { exact: true }).evaluate((element) => element === document.activeElement), true, "Focus begins in the first form field");
  await page.setViewportSize({ width: 375, height: 360 });
  await page.waitForFunction(() => {
    const rect = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
    return rect && rect.top >= 0 && rect.bottom <= innerHeight;
  });
  const shortRect = await formDialog.boundingBox();
  assert.ok(shortRect.y >= 0 && shortRect.y + shortRect.height <= 360, "Dialog fits a keyboard-sized viewport");
  await formDialog.getByRole("button", { name: "Add prospect", exact: true }).scrollIntoViewIfNeeded();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "Add prospect", exact: true }).evaluate((element) => element === document.activeElement), true, "Form focus returns to the opening control");
  await page.setViewportSize({ width: 375, height: 844 });
  flows.push("First-field focus, short-height dialog scrolling and focus restoration");
  await page.getByRole("link", { name: "Email", exact: true }).click();
  await page.getByRole("heading", { name: "Email campaigns", exact: true }).waitFor();
  await page.goBack();
  await page.getByRole("heading", { name: "Prospects", exact: true }).waitFor();
  await page.getByRole("searchbox", { name: "Search prospects", exact: true }).fill("no-such-prospect-qa");
  await page.getByText("No matches. Try another search or stage.", { exact: true }).waitFor();
  await page.getByRole("searchbox", { name: "Search prospects", exact: true }).fill("");
  await page.getByRole("button", { name: /^Open / }).first().waitFor();
  await page.screenshot({ path: resolve(output, "prospects-mobile.png") });
  await page.goto(base + "/#campaigns", { waitUntil: "networkidle" });
  await page.screenshot({ path: resolve(output, "email-mobile.png") });
  if (new URL(base).port === "3001") {
    const initial = await (await context.request.get(base + "/api/prospects?excludeGovernment=0")).json();
    assert.ok(initial.rows.length && initial.rows.every((row) => row.company.startsWith("Synthetic ")), "Mutations require synthetic fixture records");

    await page.route("**/api/prospects?**", async (route) => {
      if (new URL(route.request().url()).searchParams.has("id")) return route.continue();
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: { ...data, rows: data.rows.map((row) => ({ ...row, location: null, sector: null, signal: null })) } });
    });
    await page.goto(base + "/#prospects", { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Open Synthetic Acorn/ }).waitFor();
    assert.equal(await page.locator(".prospect-row .signal-cell").count(), 0, "Missing signals do not create filler rows");
    assert.equal(await page.locator(".prospect-row .company-copy small:not(.prospect-row-meta)").count(), 0, "Missing locations do not create filler lines");
    assert.equal(await page.locator(".prospect-row .stage-badge").first().evaluate((element) => getComputedStyle(element).gridRowStart), "2", "Mobile status follows identity without an empty row");
    await checkFlow("Compact rows with absent optional metadata");
    await page.setViewportSize({ width: 1280, height: 844 });
    assert.equal(await page.locator(".prospect-row .stage-badge").first().evaluate((element) => getComputedStyle(element).gridColumnStart), "3", "Desktop status stays under the Stage header when the signal is absent");
    await page.unroute("**/api/prospects?**");
    await page.setViewportSize({ width: 375, height: 844 });
    await page.reload({ waitUntil: "networkidle" });

    await page.goto(base + "/#prospects", { waitUntil: "networkidle" });
    await page.getByText("Filters", { exact: true }).click();
    await checkFlow("Expanded prospect filters");
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    await page.getByText("Filters", { exact: true }).click();
    await page.getByRole("button", { name: /^Open Synthetic Acorn/ }).click();
    await page.getByRole("dialog").waitFor();
    const detailsResponse = await (await context.request.get(base + "/api/prospects?id=uiqa_lead_001")).json();
    if (detailsResponse.status !== "Ready to Review") {
      await context.request.patch(base + "/api/prospects", { data: { id: "uiqa_lead_001", status: "Ready to Review" } });
      await page.keyboard.press("Escape");
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Open Synthetic Acorn/ }).click();
    }
    await page.getByRole("button", { name: "Approve for outreach", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Stage updated" }).waitFor();
    assert.equal((await (await context.request.get(base + "/api/prospects?id=uiqa_lead_001")).json()).status, "Approved for Outreach");
    await checkFlow("Prospect approval persists through the real API");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Add prospect", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add a prospect" });
    await add.getByRole("button", { name: "Add prospect", exact: true }).click();
    assert.equal(await add.locator("input:invalid").count() > 0, true, "Empty company is rejected");
    await checkFlow("Add prospect validation and mobile form");
    await page.keyboard.press("Escape");

    let release;
    let started;
    let finished;
    const held = new Promise((resolvePromise) => { release = resolvePromise; });
    const requested = new Promise((resolvePromise) => { started = resolvePromise; });
    const settled = new Promise((resolvePromise) => { finished = resolvePromise; });
    await page.route("**/api/prospects?**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("q") !== "Acorn") return route.continue();
      const response = await route.fetch();
      started();
      await held;
      try { await route.fulfill({ response }); } finally { finished(); }
    });
    await page.getByRole("searchbox", { name: "Search prospects", exact: true }).fill("Acorn");
    await requested;
    await page.getByRole("searchbox", { name: "Search prospects", exact: true }).fill("Birch");
    await page.getByRole("button", { name: "Open Synthetic Birch Works", exact: true }).waitFor();
    release();
    await settled;
    await page.waitForTimeout(250);
    assert.equal(await page.getByRole("button", { name: /^Open Synthetic Acorn/ }).count(), 0, "An older search response cannot replace a newer result");
    await page.unroute("**/api/prospects?**");
    flows.push("Delayed search response cannot overwrite the current query");

    await page.goto(base + "/#campaigns", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New campaign", exact: true }).click();
    await page.getByLabel("Campaign name", { exact: true }).fill(`Synthetic mobile QA draft ${Date.now()}`);
    await page.getByLabel("Who is it for?", { exact: true }).fill("Synthetic UI validation; no recipients and no sending.");
    await checkFlow("Campaign draft form");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Campaign draft saved" }).waitFor();
    const campaigns = await (await context.request.get(base + "/api/campaigns")).json();
    assert.ok(campaigns.campaigns.some((row) => row.name.startsWith("Synthetic mobile QA draft") && row.status === "PAUSED"));
    flows.push("Campaign draft saved paused through the real API");
    await page.locator("summary").filter({ hasText: "Preview both messages" }).click();
    await page.getByLabel("Preview recipient", { exact: true }).selectOption("uiqa_lead_001");
    await page.locator(".campaign-email-preview-content").waitFor();
    await page.getByRole("tab", { name: "Variant B", exact: true }).click();
    await checkFlow("Template preview and variant switching");

    await page.goto(base + "/mailboxes", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Add mailbox", exact: true }).click();
    await checkFlow("Mailbox form and collapsed connection settings");
    await page.locator("summary").filter({ hasText: "Connection and sending limits" }).click();
    await checkFlow("Expanded mailbox connection fields");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    await page.goto(base + "/import", { waitUntil: "networkidle" });
    await page.getByLabel("Existing campaign").selectOption("yc_us_expansion");
    await page.locator("summary").filter({ hasText: "Or paste CSV text" }).click();
    await page.getByLabel("CSV rows").fill("unrecognized_header\ninvalid-data");
    await page.getByRole("button", { name: "Preview import", exact: true }).click();
    await page.getByRole("alert").waitFor();
    await page.getByLabel("CSV rows").fill(`company_name,root_domain\nSynthetic Browser Import ${Date.now()},mobile-import-${Date.now()}.example.test`);
    await page.getByRole("button", { name: "Preview import", exact: true }).click();
    await page.getByRole("heading", { name: /^Preview for/ }).waitFor();
    await checkFlow("Invalid CSV recovery and populated import preview");

    await page.goto(base + "/yc", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Select shown", exact: true }).click();
    await checkFlow("Populated YC cards and selection");
    await page.screenshot({ path: resolve(output, "yc-mobile.png") });

    await page.goto(base + "/email-preflight?leadId=uiqa_lead_001", { waitUntil: "networkidle" });
    await page.getByLabel("Exact address to check").waitFor();
    await page.locator("summary").filter({ hasText: "Find a public email candidate" }).click();
    await checkFlow("Preflight deep link and discovery disclosure; no external lookup");

    await page.route("**/api/prospects?id=*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic contact failure. Retry." }) }));
    await page.goto(base + "/#prospects", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Open Synthetic Acorn/ }).click();
    await page.getByRole("button", { name: "Retry contact", exact: true }).waitFor();
    await checkFlow("Prospect detail failure stays visible in the mobile sheet");
    await page.unroute("**/api/prospects?id=*");
    await page.getByRole("button", { name: "Retry contact", exact: true }).click();
    await page.getByRole("dialog").getByRole("heading", { name: /^Synthetic Acorn/ }).waitFor();
    await page.keyboard.press("Escape");
    flows.push("Contact retry recovers using the real API");
    const dispatch = await (await context.request.get(base + "/api/dispatch?summary=1")).json();
    assert.equal(dispatch.snapshot.live_dispatch, false);
    assert.equal(dispatch.snapshot.is_running, false);
    assert.equal(dispatch.snapshot.queue_pending, 0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(base + "/#prospects", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Open / }).first().click();
  assert.equal(await page.getByRole("dialog", { name: "Selected prospect details" }).count(), 0, "Desktop details stay inline");
  await page.screenshot({ path: resolve(output, "prospects-desktop.png") });
  assert.deepEqual(errors, [], "No browser runtime exceptions");
  console.log(`${results.length} responsive route checks, prospect/navigation interactions and ${flows.length} populated workflow checks passed`);
} finally {
  writeFileSync(resolve(output, "responsive-results.json"), JSON.stringify({ results, flows, errors, failedApiRequests }, null, 2));
  await browser.close();
}
