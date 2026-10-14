import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "node:net";

const repo = resolve("..");
const output = resolve(repo, "operations/luna-ui-qa-20261008");
await mkdir(output, { recursive: true });
const fixture = resolve(output, "quota-ui-fixture.sqlite");
const python = process.platform === "win32" ? "py" : "python3";
const pythonArgs = process.platform === "win32" ? ["-3"] : [];
const env = { ...process.env, OUTBOUNDER_DB_PATH: fixture, ENABLE_LIVE_DISPATCH: "false",
  OUTBOUNDER_RECOVER_QUEUE: "0", OUTBOUNDER_DISPATCHER_PORT: "18766",
  OUTBOUNDER_CONTROL_TOKEN: "quota-ui-test-only", SMTP_USER: "", SMTP_PASSWORD: "" };
for (const port of [3001, 18766]) {
  await new Promise((ready, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(ready));
  });
}
const setup = spawnSync(python, [...pythonArgs, "-c", `
import sqlite3,os
from pathlib import Path
source=Path('operations/luna-ui-qa-20261008/ui-fixture.sqlite').resolve()
target=Path(os.environ['OUTBOUNDER_DB_PATH'])
assert target != source and 'quota-ui-fixture' in target.name
with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as src,sqlite3.connect(target) as dst:
 src.backup(dst)
 tables={r[0] for r in dst.execute("SELECT name FROM sqlite_master WHERE type='table'")}
 for table in ('dispatch_queue','dispatch_runs','campaign_sends','mailboxes'):
  if table in tables: dst.execute('DELETE FROM '+table)
import campaign_database as db
db.init_campaign_tables()
with db.connection_scope() as dst:
 dst.execute("INSERT INTO mailboxes(email,sender_name,smtp_server,smtp_user,smtp_password,daily_limit,hourly_limit,status,provider_type,created_at) VALUES ('quota@example.test','Fixture','smtp.invalid','fixture-login','fixture-only',20,4,'ACTIVE','MICROSOFT',CURRENT_TIMESTAMP)")
`], { cwd: repo, env, encoding: "utf8" });
assert.equal(setup.status, 0, setup.stderr);
const require = createRequire(import.meta.url);
const children = [
  spawn(python, [...pythonArgs, "dispatcher_sidecar.py"], { cwd: repo, env, stdio: "ignore" }),
  spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3001"], { env, stdio: "ignore" }),
];
let browser;
const checks = [], pageErrors = [];
try {
  for (let attempt = 0; ; attempt++) {
    try { const r = await fetch("http://127.0.0.1:3001/api/mailboxes"); if (r.ok) break; } catch {}
    assert.ok(attempt < 80, "Fixture web failed to start");
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("http://127.0.0.1:3001/mailboxes");
  const edit = page.getByRole("button", { name: "Edit quota@example.test", exact: true });
  await edit.click();
  await page.getByText("Connection and sending limits", { exact: true }).click();
  const warmup = page.getByRole("checkbox", { name: "Use recommended warmup caps" });
  assert.equal(await warmup.isChecked(), true);
  assert.equal(await page.getByLabel("Daily quota", { exact: true }).getAttribute("max"), null);
  assert.equal(await page.getByLabel("Hourly quota", { exact: true }).getAttribute("max"), null);
  await page.getByLabel("Daily quota", { exact: true }).fill("50");
  await page.getByLabel("Hourly quota", { exact: true }).fill("10");
  assert.equal(await warmup.isChecked(), false);
  assert.ok((await warmup.boundingBox()).width <= 24);
  assert.ok((await warmup.locator("..").boundingBox()).height >= 44);
  const savedResponse = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/mailboxes" && r.request().method() === "POST");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const saved = await savedResponse;
  const savedPayload = await saved.json();
  assert.equal(saved.status(), 200, JSON.stringify(savedPayload));
  assert.equal(savedPayload.senderNotified, true);
  await edit.click();
  await page.getByText("Connection and sending limits", { exact: true }).click();
  assert.equal(await page.getByLabel("Daily quota", { exact: true }).inputValue(), "50");
  assert.equal(await page.getByLabel("Hourly quota", { exact: true }).inputValue(), "10");
  assert.equal(await warmup.isChecked(), false);
  const pacing = await (await fetch("http://127.0.0.1:3001/api/dispatch?mailboxPacing=1")).json();
  assert.equal(pacing.mailboxes[0].effectiveDailyLimit, 50);
  assert.equal(pacing.mailboxes[0].effectiveHourlyLimit, 10);
  checks.push("50/day and 10/hour save through actual browser/API/SQLite, persist on reopening, and notify the real isolated sidecar");
  await warmup.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, "quota-controls-desktop.png") });
  await page.setViewportSize({ width: 375, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await warmup.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, "quota-controls-mobile.png") });
  await warmup.check();
  const recommendedResponse = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/mailboxes" && r.request().method() === "POST");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  assert.equal((await recommendedResponse).status(), 200);
  const recommended = await (await fetch("http://127.0.0.1:3001/api/dispatch?mailboxPacing=1")).json();
  assert.equal(recommended.mailboxes[0].manualLimits, false);
  assert.equal(recommended.mailboxes[0].configuredDailyLimit, 50);
  assert.equal(recommended.mailboxes[0].effectiveDailyLimit, 5);
  checks.push("warmup is explicitly opt-in; configured quotas survive enabling recommended caps; mobile fits");
  await page.route("**/api/dispatch?*", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    if (payload.snapshot) payload.snapshot.is_running = true;
    await route.fulfill({ response, json: payload });
  });
  await page.goto("http://127.0.0.1:3001/#settings");
  await page.getByText("Sender limits", { exact: true }).click();
  const limits = page.locator(".mailbox-pacing-row").first();
  const daily = limits.getByLabel("Daily cap", { exact: true });
  const hourly = limits.getByLabel("Hourly cap", { exact: true });
  assert.equal(await daily.isEnabled(), true);
  await daily.fill("70");
  await hourly.fill("12");
  assert.equal(await limits.getByRole("checkbox").isChecked(), false);
  const limitResponse = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/dispatch" && r.request().method() === "POST");
  await limits.getByRole("button", { name: "Save limits", exact: true }).click();
  const limitSaved = await limitResponse;
  const limitPayload = await limitSaved.json();
  assert.equal(limitSaved.status(), 200, JSON.stringify(limitPayload));
  assert.equal(limitPayload.mailboxes[0].effectiveDailyLimit, 70);
  assert.equal(limitPayload.mailboxes[0].effectiveHourlyLimit, 12);
  checks.push("Settings quota inputs remain enabled with browser-simulated running state; actual fixture pacing POST saves 70/day and 12/hour");
  assert.deepEqual(pageErrors, []);
  await writeFile(resolve(output, "quota-ui-proof.json"), JSON.stringify({ checks, pageErrors }, null, 2));
  console.log(JSON.stringify({ checks, pageErrors }, null, 2));
} finally {
  for (const context of browser?.contexts() || []) {
    for (const page of context.pages()) await page.unrouteAll({ behavior: "wait" });
  }
  await browser?.close();
  for (const child of children) child.kill();
}
