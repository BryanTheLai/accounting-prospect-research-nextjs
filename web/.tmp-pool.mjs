import Database from "better-sqlite3";

const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });

const POOLS = ["hydroball_clones", "jobstreet_hiring_pain", "mysg_consumer_retail_accounting"];
const ph = POOLS.map(() => "?").join(",");

console.log("=== MY/SG state in the local DB ===");
for (const r of db
  .prepare(
    `SELECT p.campaign_id,
            COUNT(*) n,
            SUM(CASE WHEN e.mx_status='mx_present' THEN 1 ELSE 0 END) mx,
            SUM(CASE WHEN e.source_confirmed=1 THEN 1 ELSE 0 END) conf
       FROM prospects p LEFT JOIN email_preflight e ON e.lead_id=p.lead_id
      WHERE p.campaign_id IN (${ph}) GROUP BY p.campaign_id`,
  )
  .all(...POOLS)) {
  console.log(`  ${r.campaign_id.padEnd(34)} n=${r.n} mx=${r.mx} confirmed=${r.conf}`);
}

const sendable = db
  .prepare(
    `SELECT COUNT(*) c FROM prospects p JOIN email_preflight e ON e.lead_id=p.lead_id
      WHERE p.campaign_id IN (${ph})
        AND e.mx_status='mx_present' AND e.source_confirmed=1
        AND e.source_confirmed_at IS NOT NULL
        AND julianday('now')-julianday(e.source_confirmed_at) <= 30
        AND NOT EXISTS (SELECT 1 FROM email_suppression x
                         WHERE lower(trim(x.email))=lower(trim(p.contact_email)))
        AND NOT EXISTS (SELECT 1 FROM campaign_sends s
                         WHERE lower(trim(s.recipient_email))=lower(trim(p.contact_email))
                           AND coalesce(s.response_msg,'') NOT LIKE '%[DRY-RUN%')`,
  )
  .get(...POOLS).c;
console.log(`\n  VERIFIED SENDABLE: ${sendable}`);

console.log("\n=== first 10 sendable (to eyeball quality) ===");
for (const r of db
  .prepare(
    `SELECT p.company_name, p.contact_email FROM prospects p JOIN email_preflight e ON e.lead_id=p.lead_id
      WHERE p.campaign_id IN (${ph})
        AND e.mx_status='mx_present' AND e.source_confirmed=1
        AND NOT EXISTS (SELECT 1 FROM campaign_sends s
                         WHERE lower(trim(s.recipient_email))=lower(trim(p.contact_email))
                           AND coalesce(s.response_msg,'') NOT LIKE '%[DRY-RUN%')
      LIMIT 10`,
  )
  .all(...POOLS)) {
  console.log(`  ${String(r.company_name).slice(0, 34).padEnd(34)} ${r.contact_email}`);
}

console.log("\n=== mailbox pacing ===");
for (const m of db.prepare("SELECT email,daily_limit,hourly_limit,status FROM mailboxes").all()) {
  console.log(`  ${m.email.padEnd(32)} ${m.daily_limit}/day ${m.hourly_limit}/hr ${m.status}`);
}
const cap = db.prepare("SELECT SUM(daily_limit) t FROM mailboxes").get().t;
console.log(`  COMBINED DAILY: ${cap}`);

console.log("\n=== templates for MY/SG ===");
for (const t of db
  .prepare("SELECT template_id,name FROM outbound_templates WHERE template_id IN (2,3,4,84018,89087)")
  .all()) {
  console.log(`  ${t.template_id}  ${t.name}`);
}
db.close();