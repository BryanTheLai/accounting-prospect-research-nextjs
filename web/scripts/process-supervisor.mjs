import { spawn } from "node:child_process";
import { createServer } from "node:net";

export function requireAvailablePort(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`Local sender port ${port} is occupied; set OUTBOUNDER_DISPATCHER_PORT to a free port`)));
    probe.listen(Number(port), "127.0.0.1", () => probe.close((error) => error ? reject(error) : resolve()));
  });
}

export function superviseProcess(command, args, options = {}) {
  const { restartDelay = 2000, onEvent = () => {}, ...spawnOptions } = options;
  let child = null, timer = null, stopped = false, restarts = 0, failures = 0;
  function launch() {
    if (stopped) return;
    const started = Date.now();
    child = spawn(command, args, { stdio: "inherit", windowsHide: true, ...spawnOptions });
    let handled = false;
    child.once("spawn", () => onEvent("started", child.pid));
    function exited(code) {
      if (handled) return;
      handled = true;
      child = null;
      if (stopped) return;
      failures = Date.now() - started > 60000 ? 0 : failures + 1;
      const delay = Math.min(30000, restartDelay * Math.max(1, failures));
      onEvent("restarting", code);
      timer = setTimeout(() => { timer = null; restarts++; launch(); }, delay);
    }
    child.once("exit", exited);
    child.once("error", () => exited("spawn_error"));
  }
  launch();
  return {
    get pid() { return child?.pid || null; },
    get restartCount() { return restarts; },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      const current = child;
      if (!current) return;
      await new Promise((resolve) => {
        current.once("exit", resolve);
        if (process.platform === "win32") {
          const killer = spawn("taskkill", ["/pid", String(current.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
          killer.once("error", () => current.kill());
        } else current.kill("SIGTERM");
      });
      child = null;
    },
  };
}
