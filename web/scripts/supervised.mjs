import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { readLocalEnv } from "./local-env.mjs";
import { superviseProcess, requireAvailablePort } from "./process-supervisor.mjs";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(web, "..");
const runtime = resolve(repo, "operations/runtime");
await mkdir(runtime, { recursive: true });
const localEnv = await readLocalEnv(resolve(web, ".env.local"));
const port = process.env.OUTBOUNDER_DISPATCHER_PORT || localEnv.OUTBOUNDER_DISPATCHER_PORT || "8765";
await requireAvailablePort(port);
const env = { ...localEnv, ...process.env,
  OUTBOUNDER_DISPATCHER_PORT: String(port),
  OUTBOUNDER_DB_PATH: resolve(web, process.env.OUTBOUNDER_DB_PATH || localEnv.OUTBOUNDER_DB_PATH || "../operations/recovered-leads-20261008/leads.sqlite"),
  OUTBOUNDER_CONTROL_TOKEN: randomBytes(32).toString("base64url"), OUTBOUNDER_RECOVER_QUEUE: "1" };
const children = {};
let closing = false;
function report(name, event, detail) {
  console.log(`${new Date().toISOString()} ${name} ${event} ${detail ?? ""}`);
  const status = { supervisorPid: process.pid, closing,
    children: Object.fromEntries(Object.entries(children).map(([key, child]) => [key, { pid: child.pid, restartCount: child.restartCount }])) };
  void writeFile(resolve(runtime, "supervisor-status.json"), JSON.stringify(status, null, 2)).catch(() => {});
}
const python = process.platform === "win32" ? "py" : "python3";
children.dispatcher = superviseProcess(python, [...(process.platform === "win32" ? ["-3"] : []), "dispatcher_sidecar.py"],
  { cwd: repo, env, onEvent: (event, detail) => report("dispatcher", event, detail) });
const require = createRequire(import.meta.url);
children.web = superviseProcess(process.execPath,
  [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", ...process.argv.slice(2)],
  { cwd: web, env, onEvent: (event, detail) => report("web", event, detail) });
async function shutdown() {
  if (closing) return;
  closing = true;
  await Promise.all(Object.values(children).map((child) => child.stop()));
  report("supervisor", "stopped", process.pid);
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
console.log(`Outbounder supervised locally; database stays in this Next.js checkout.`);
