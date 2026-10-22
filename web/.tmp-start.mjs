// Start the live MY/SG run against the local dispatcher.
import net from "node:net";
import { readFileSync } from "node:fs";

const PORT = 8801;
const TOKEN = (() => {
  const m = readFileSync(process.argv[2], "utf8").match(/OUTBOUNDER_CONTROL_TOKEN=(.*)/);
  return m ? m[1].trim() : "";
})();

const ids = JSON.parse(readFileSync(process.argv[3], "utf8").trim());

// Angle 3 (Software-Native Ledger Modernization) and Angle 1 (JobStreet hiring
// pain). Angle 3 is true for every one of these leads because we have the
// actual accounting package on file; Angle 1 only fits leads that advertised a
// role, so it is the A/B counterpart rather than the default.
const body = {
  action: "start",
  leadIds: ids,
  campaignId: "all",
  templateAName: process.argv[4],
  templateBName: process.argv[5],
  liveConfirmed: true,
};
console.log(`starting LIVE run: ${ids.length} recipients`);
console.log(`  A = ${body.templateAName}`);
console.log(`  B = ${body.templateBName}`);
console.log("");

const payload = Buffer.from(JSON.stringify(body));

const sock = net.connect({ host: "127.0.0.1", port: PORT, timeout: 120000 }, () => {
  sock.write(
    [
      "POST /start HTTP/1.1",
      "Host: 127.0.0.1:" + PORT,
      `Authorization: Bearer ${TOKEN}`,
      "Content-Type: application/json",
      `Content-Length: ${payload.length}`,
      "Connection: close",
    ].join("\r\n") + "\r\n\r\n",
  );
  sock.write(payload);
});

let buf = "";
sock.on("data", (d) => (buf += d.toString()));
sock.on("end", () => {
  const split = buf.indexOf("\r\n\r\n");
  const status = parseInt(buf.split(" ")[1], 10);
  console.log("HTTP", status);
  try {
    const j = JSON.parse(buf.slice(split + 4));
    const s = j.snapshot || j;
    console.log("  run_id:        ", s.run_id || j.run_id);
    console.log("  run_total:     ", s.run_total);
    console.log("  accepted_count:", s.accepted_count);
    console.log("  queue_pending: ", s.queue_pending);
    console.log("  wait_reason:   ", s.wait_reason);
    console.log("  live_dispatch: ", s.live_dispatch);
    if (j.error) console.log("  ERROR:", j.error);
  } catch {
    console.log(buf.slice(split + 4, split + 600));
  }
});
sock.on("error", (e) => console.log("socket error:", e.message));