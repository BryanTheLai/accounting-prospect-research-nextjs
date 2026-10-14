import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { requireAvailablePort } from "./process-supervisor.mjs";

await requireAvailablePort(3001);
await requireAvailablePort(18766);
if (!existsSync(chromium.executablePath())) throw new Error("Install the QA browser first: npx playwright install chromium");
const env = { ...process.env, OUTBOUNDER_BUILD_DIR: ".next-qa" };
const require = createRequire(import.meta.url);
await new Promise((resolve, reject) => {
  const build = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "build", "--webpack"], { stdio: "inherit", env });
  build.once("error", reject);
  build.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`QA production build failed (${code})`)));
});
const fixture = spawn(process.execPath, ["scripts/qc-fixture.mjs"], { stdio: "inherit", env });
let fixtureExited = false;
fixture.once("exit", () => { fixtureExited = true; });
const suites = ["panel-quality-ui.mjs", "email-quality-ui.mjs", "secondary-quality-ui.mjs", "primary-quality-ui.mjs", "expanded-page-walkthrough.mjs", "interactive-chart-ui.mjs", "long-call-script-ui.mjs", "ui-state-qa.mjs"];
try {
  for (let attempt = 0; ; attempt++) {
    if (fixtureExited) throw new Error("Isolated QA service exited before startup");
    try { if ((await fetch("http://127.0.0.1:3001/api/mailboxes")).ok) break; } catch {}
    if (attempt >= 120) throw new Error("Isolated QA service did not start");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const mailboxes = await (await fetch("http://127.0.0.1:3001/api/mailboxes")).json();
  assert.ok(mailboxes.mailboxes.every((mailbox) => mailbox.smtpServer === "smtp.invalid"));
  // The web app can answer /api/mailboxes before the Python dispatcher sidecar has
  // finished booting, because that route never touches the sidecar. Waiting only on the
  // web port made /api/dispatch intermittently return an error body with no `snapshot`,
  // which surfaced as "Cannot read properties of undefined (reading 'live_dispatch')".
  let status;
  for (let attempt = 0; ; attempt++) {
    status = await (await fetch("http://127.0.0.1:3001/api/dispatch?summary=1")).json();
    if (status && status.snapshot) break;
    if (attempt >= 120) throw new Error("Isolated QA dispatcher sidecar did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(status.snapshot.live_dispatch, false);
  assert.equal(status.snapshot.is_running, false);
  for (const suite of suites) {
    console.log(`QA: ${suite}`);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [`tests/${suite}`], { stdio: "inherit", env: { ...process.env, UI_QA_URL: "http://127.0.0.1:3001" } });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${suite} failed (${code})`)));
    });
  }
  console.log("All isolated UI quality suites passed. Live sending was not used.");
} finally {
  if (!fixtureExited && fixture.pid) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(fixture.pid), "/T", "/F"], { stdio: "ignore" });
    else fixture.kill("SIGTERM");
  }
}
