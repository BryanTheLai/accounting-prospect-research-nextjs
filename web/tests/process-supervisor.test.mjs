import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { superviseProcess, requireAvailablePort } from "../scripts/process-supervisor.mjs";

test("a foreign listener is rejected regardless of its HTTP health response", async () => {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  try {
    await assert.rejects(requireAvailablePort(port), /occupied/);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
  await requireAvailablePort(port);
});

test("a crashed child restarts, an independent child stays alive, explicit stop prevents restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "outbounder-supervisor-"));
  const marker = join(directory, "attempts.txt");
  const code = `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(marker)},'start\\n');if(fs.readFileSync(${JSON.stringify(marker)},'utf8').split('start').length===2)process.exit(1);setInterval(()=>{},1000);`;
  const worker = superviseProcess(process.execPath, ["-e", code], { restartDelay: 10 });
  const independent = superviseProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { restartDelay: 10 });
  try {
    const deadline = Date.now() + 5000;
    while ((await readFile(marker, "utf8").catch(() => "")).trim().split("\n").length < 2 || !worker.pid) {
      if (Date.now() > deadline) throw new Error("Child did not restart");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(independent.restartCount, 0);
    assert.ok(independent.pid);
    await worker.stop();
    const attempts = await readFile(marker, "utf8");
    assert.equal(attempts.trim().split("\n").length, 2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(worker.pid, null);
    assert.equal(worker.restartCount, 1);
  } finally {
    await worker.stop();
    await independent.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
