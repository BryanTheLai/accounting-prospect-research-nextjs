import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = "http://127.0.0.1:3000";
const actual = await (await fetch(`${base}/api/dispatch`)).json();
assert.equal(actual.snapshot.is_running, true);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  assert.equal(request.method(), "GET", "This verification must never submit a send control");
});
try {
  await page.goto(`${base}/#campaigns`);
  await page.locator(".run-panel").getByText(/Saved run:/).waitFor();
  const liveText = await page.locator(".run-panel").innerText();
  assert.match(liveText, /LIVE MODE/);
  assert.match(liveText, /Pending messages survive a sender restart/);
  const layouts = [];
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    layouts.push(await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth })));
    assert.ok(layouts.at(-1).documentWidth <= width + 1);
  }
  await page.locator(".run-panel").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../operations/runtime/dispatch-live-mobile.png" });

  // Intercepted snapshots prove idle-to-active polling and outage reporting without changing the sender.
  let active = false, offline = false;
  await page.route("**/api/dispatch?*", async (route) => {
    if (offline) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Email service unavailable" }) });
      return;
    }
    const payload = structuredClone(actual);
    payload.snapshot.is_running = active;
    payload.snapshot.wait_reason = active ? "hourly_quota" : "stopped";
    payload.snapshot.live_dispatch = active;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.reload();
  await page.locator(".run-status-row").getByText(/Queue stopped/).waitFor();
  active = true;
  await page.locator(".run-status-row").getByText(/Waiting for hourly sender capacity/).waitFor({ timeout: 15000 });
  offline = true;
  await page.locator(".run-status-row").getByText(/Email service unavailable/).waitFor({ timeout: 15000 });
  offline = false;
  await page.locator(".run-status-row").getByText(/Waiting for hourly sender capacity/).waitFor({ timeout: 15000 });
  await page.unrouteAll();
  await page.reload();
  await page.locator(".run-panel").getByText(/Saved run:/).waitFor();
  assert.deepEqual(errors, []);
  const proof = { liveText, layouts, syntheticChecks: ["idle-to-active polling", "service outage", "service recovery"], pageErrors: errors };
  await writeFile("../operations/runtime/dispatch-ui-proof.json", JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await browser.close();
}
