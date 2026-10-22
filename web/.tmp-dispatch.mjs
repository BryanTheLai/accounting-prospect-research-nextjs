// Talk to the local dispatcher: snapshot, templates, and the sendable MY/SG ids.
import net from "node:net";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const PORT = 8801;
const TOKEN = (() => {
  const txt = readFileSync(process.argv[2], "utf8");
  const m = txt.match(/OUTBOUNDER_CONTROL_TOKEN=(.*)/);
  return m ? m[1].trim() : "";
})();

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const sock = net.connect({ host: "127.0.0.1", port: PORT, timeout: 20000 }, () => {
      const headers = [
        `${method} ${path} HTTP/1.1`,
        "Host: 127.0.0.1:" + PORT,
        `Authorization: Bearer ${TOKEN}`,
        "Connection: close",
      ];
      if (payload) {
        headers.push("Content-Type: application/json");
        headers.push(`Content-Length: ${payload.length}`);
      }
      sock.write(headers.join("\r\n") + "\r\n\r\n");
      if (payload) sock.write(payload);
    });
    let buf = "";
    sock.on("data", (d) => (buf += d.toString()));
    sock.on("end", () => {
      const split = buf.indexOf("\r\n\r\n");
      const head = buf.slice(0, split);
      const raw = buf.slice(split + 4);
      const status = parseInt(head.split(" ")[1], 10);
      let parsed = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {}
      resolve({ status, body: parsed });
    });
    sock.on("error", reject);
    sock.on("timeout", () => {
      sock.destroy();
      reject(new Error("timeout"));
    });
  });
}

const mode = process.argv[3] || "summary";

if (mode === "summary") {
  const r = await request("GET", "/status?summary=1");
  const s = r.body?.snapshot || r.body;
  console.log("HTTP", r.status);
  for (const k of [
    "is_running", "run_id", "run_total", "accepted_count", "uncertain_count",
    "sent_today", "queue_pending", "wait_reason", "live_dispatch",
    "biz_start_hour", "biz_end_hour", "today",
  ]) {
    console.log(`  ${k.padEnd(18)} ${s?.[k]}`);
  }
  if (r.body?.mailboxes) {
    console.log("\n  mailboxes:");
    for (const m of r.body.mailboxes) {
      console.log(`    ${m.email} ${m.sent_today ?? "?"}/${m.daily_limit} today, ${m.sent_this_hour ?? "?"}/${m.hourly_limit} this hour`);
    }
  }
} else if (mode === "templates") {
  const r = await request("GET", "/api/dispatch?templates=1");
  console.log(JSON.stringify(r.body, null, 2).slice(0, 3000));
} else if (mode === "ids") {
  // Read the sendable set straight from the DB the dispatcher is using.
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(process.argv[4], { readonly: true });
  const POOLS = ["hydroball_clones", "jobstreet_hiring_pain", "mysg_consumer_retail_accounting"];
  const ph = POOLS.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT p.lead_id FROM prospects p JOIN email_preflight e ON e.lead_id=p.lead_id
        WHERE p.campaign_id IN (${ph})
          AND e.mx_status='mx_present' AND e.source_confirmed=1
          AND e.source_confirmed_at IS NOT NULL
          AND julianday('now')-julianday(e.source_confirmed_at) <= 30
          AND NOT EXISTS (SELECT 1 FROM email_suppression x
                           WHERE lower(trim(x.email))=lower(trim(p.contact_email)))
          AND NOT EXISTS (SELECT 1 FROM campaign_sends s
                           WHERE lower(trim(s.recipient_email))=lower(trim(p.contact_email))
                             AND coalesce(s.response_msg,'') NOT LIKE '%[DRY-RUN%')
        ORDER BY p.lead_id`,
    )
    .all(...POOLS);
  console.log(JSON.stringify(rows.map((r) => r.lead_id)));
  db.close();
}