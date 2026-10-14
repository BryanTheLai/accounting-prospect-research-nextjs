import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readLocalEnv } from "./local-env.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(scriptDir, "..");
const repoDir = resolve(webDir, "..");
const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  throw new Error("Usage: node scripts/local.mjs <dev|start> [Next.js arguments]");
}

const localEnvFile = resolve(webDir, ".env.local");
const localEnv = await readLocalEnv(localEnvFile);
const controlPort = process.env.OUTBOUNDER_DISPATCHER_PORT || localEnv.OUTBOUNDER_DISPATCHER_PORT || "8765";
const token = randomBytes(32).toString("base64url");
const configuredDbPath = process.env.OUTBOUNDER_DB_PATH || localEnv.OUTBOUNDER_DB_PATH;
const dbPath = resolve(
  webDir,
   configuredDbPath || "../operations/recovered-leads-20261008/leads.sqlite",
);
const childEnv = {
  ...localEnv,
  ...process.env,
  OUTBOUNDER_DB_PATH: dbPath,
  OUTBOUNDER_CONTROL_TOKEN: token,
  OUTBOUNDER_RECOVER_QUEUE: "1",
};

function startChild(command, args, options) {
  return spawn(command, args, { stdio: "inherit", windowsHide: true, ...options });
}

function waitForSpawn(child, label) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("spawn", resolvePromise);
    child.once("error", (error) => rejectPromise(new Error(`Could not start ${label}: ${error.message}`)));
  });
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => child.once("exit", resolvePromise));
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    waitForExit(child).then(() => true),
    new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), 2000)),
  ]);
  if (!exited && process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    await waitForExit(killer);
  } else if (!exited) {
    child.kill("SIGKILL");
  }
}

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const nextArgs = [nextCli, mode, ...(mode === "dev" ? ["--webpack"] : []), "--hostname", "127.0.0.1", ...process.argv.slice(3)];
let sidecar;
let next;
let shuttingDown = false;

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([stopChild(next), stopChild(sidecar)]);
  process.exit(exitCode);
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));

try {
  const python = process.platform === "win32" ? "py" : "python3";
  const pythonArgs = process.platform === "win32" ? ["-3", "dispatcher_sidecar.py"] : ["dispatcher_sidecar.py"];
  sidecar = startChild(python, pythonArgs, { cwd: repoDir, env: childEnv });
  await waitForSpawn(sidecar, "the local dispatcher service");
  sidecar.once("exit", (code) => {
    if (!shuttingDown) {
      console.error("The local dispatcher service stopped; shutting down Next.js.");
      void shutdown(code ?? 1);
    }
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (sidecar.exitCode !== null || sidecar.signalCode !== null) {
      throw new Error("The local dispatcher service exited before becoming ready");
    }
    try {
      const response = await fetch(`http://127.0.0.1:${controlPort}/ready`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) break;
    } catch {
      // The service is still binding or initializing its local database.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  if (Date.now() >= deadline) throw new Error("The local dispatcher service did not become ready within 30 seconds");

  next = startChild(process.execPath, nextArgs, { cwd: webDir, env: childEnv });
  await waitForSpawn(next, `Next.js ${mode} server`);
  next.once("exit", (code) => void shutdown(code ?? 1));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local app startup failed");
  await Promise.all([stopChild(next), stopChild(sidecar)]);
  process.exit(1);
}
