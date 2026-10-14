import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requireAvailablePort } from "./process-supervisor.mjs";

const repo = resolve("..");
const output = resolve(repo, "operations/full-ui-qc-20261008");
await mkdir(output, { recursive: true });
await requireAvailablePort(3001);
await requireAvailablePort(18766);
const python = process.platform === "win32" ? "py" : "python3";
const args = process.platform === "win32" ? ["-3"] : [];
const env = { ...process.env, OUTBOUNDER_DB_PATH: resolve(output, "fixture.sqlite"),
  OUTBOUNDER_DISPATCHER_PORT: "18766", OUTBOUNDER_CONTROL_TOKEN: "full-ui-qc-fixture-only",
  ENABLE_LIVE_DISPATCH: "false", OUTBOUNDER_RECOVER_QUEUE: "0", SMTP_USER: "", SMTP_PASSWORD: "" };
const setup = spawnSync(python, [...args, "-c", `
import os,sqlite3
from pathlib import Path
source=Path('operations/recovered-leads-20261008/leads.sqlite').resolve()
target=Path(os.environ['OUTBOUNDER_DB_PATH'])
assert target != source and target.parent.name=='full-ui-qc-20261008'
with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as src,sqlite3.connect(':memory:') as clean:
 src.backup(clean)
 clean.execute('PRAGMA secure_delete=ON')
 clean.execute("UPDATE mailboxes SET smtp_server='smtp.invalid',smtp_user='fixture-login',smtp_password='fixture-only'")
 clean.execute("UPDATE dispatch_runs SET status='STOPPED',live=0")
 clean.execute("CREATE TABLE IF NOT EXISTS ui_qc_fixture(marker TEXT)")
 clean.execute("DELETE FROM ui_qc_fixture")
 clean.execute("INSERT INTO ui_qc_fixture VALUES ('full-ui-qc-fixture-only')")
 clean.commit()
 clean.execute('VACUUM')
 with sqlite3.connect(target) as dst: clean.backup(dst)
`], { cwd: repo, env, encoding: "utf8" });
if (setup.status !== 0) throw new Error(setup.stderr);
const require = createRequire(import.meta.url);
const children = [spawn(python, [...args, "dispatcher_sidecar.py"], { cwd: repo, env, stdio: "inherit" }),
  spawn(process.execPath, [require.resolve("next/dist/bin/next"), ...(env.OUTBOUNDER_BUILD_DIR ? ["start"] : ["dev", "--webpack"]), "--hostname", "127.0.0.1", "--port", "3001"], { env, stdio: "inherit" })];
await writeFile(resolve(output, "fixture-processes.json"), JSON.stringify({ parent: process.pid, children: children.map((child) => child.pid), ports: [3001,18766] }, null, 2));
for (const child of children) child.once("error", (error) => console.error(error.message));
function stop() { for (const child of children) child.kill(); process.exit(); }
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
