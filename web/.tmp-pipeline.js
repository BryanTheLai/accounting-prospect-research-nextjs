// Start a live run against the local dispatcher using ids.json.
//
// Reads the control token from the env file directly rather than taking it as
// an argument: the token is base64 and ends in '=', which shells mangle when
// passing it through.
import net from "node:net";
import { readFileSync } from "node:fs";

const ENV_FILE = process.argv[2];
const IDS = process.argv[3];
const TPL_A = process.argv[4];
const TPL_B = process.argv[5];
const PORT = 8801;

const envTxt = readFileSync(ENV_FILE, "utf8");
const m = envTxt.match(/OUTBOUNDER_CONTROL_TOKEN=(.*)/);
const TOKEN = m ? m[1].trim() : "";
if (!TOKEN) {
  console.log("no control token in", ENV_FILE);
  process.exit(1);
}

const ids = JSON.parse(readFileSync(IDS, "utf8").replace(/^﻿/, "").trim());
if (ids.length === 0) {
  console.log("no eligible ids");
  process.exit(0);
}

const body = {
  action: "start",
  leadIds: ids,
  campaignId: "all",
  templateAName: TPL_A,
  templateBName: TPL_B,
  liveConfirmed: true,
};
console.log(`starting LIVE run: ${ids.length} recipients`);

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
  const status = parseInt(buf.split(" ")[1], 10);
  console.log("HTTP", status);
  try {
    const j = JSON.parse(buf.slice(buf.indexOf("\r\n\r\n") + 4));
    const s = j.snapshot || j;
    console.log("  run_id:", s.run_id, "run_total:", s.run_total, "queue:", s.queue_pending);
    if (j.error) console.log("  ERROR:", j.error);
  } catch {
    console.log(buf.slice(0, 400));
  }
});
sock.on("error", (e) => console.log("socket error:", e.message));