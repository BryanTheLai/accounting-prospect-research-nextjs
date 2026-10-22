// Render one template against one real lead and print it, without sending.
// Verifies spintax resolves and no placeholder is left unfilled.
import Database from "better-sqlite3";
import { render_email_template, validate_company_name } from "../../spintax_engine.mjs";

const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });

const POOLS = ["hydroball_clones", "jobstreet_hiring_pain"];
const ph = POOLS.map(() => "?").join(",");

const lead = db
  .prepare(
    `SELECT p.* FROM prospects p JOIN email_preflight e ON e.lead_id=p.lead_id
      WHERE p.campaign_id IN (${ph})
        AND e.mx_status='mx_present' AND e.source_confirmed=1
        AND NOT EXISTS (SELECT 1 FROM campaign_sends s
                         WHERE lower(trim(s.recipient_email))=lower(trim(p.contact_email))
                           AND coalesce(s.response_msg,'') NOT LIKE '%[DRY-RUN%')
      LIMIT 1`,
  )
  .get(...POOLS);

console.log("lead:", lead.company_name, "->", lead.contact_email);
console.log("name validation:", validate_company_name(lead.company_name));
console.log();

for (const tid of [2, 3, 4]) {
  const t = db.prepare("SELECT name, subject, body FROM outbound_templates WHERE template_id=?").get(tid);
  console.log("=".repeat(78));
  console.log(`TEMPLATE ${tid}: ${t.name}`);
  try {
    const subj = render_email_template(t.subject, lead);
    const body = render_email_template(t.body, lead);
    console.log("SUBJECT:", subj);
    console.log("BODY:");
    console.log(body);
    // Any leftover {{ }} means a required field was missing.
    const leftover = (subj + body).match(/\{\{[^}]+\}\}/g);
    if (leftover) console.log("!! UNFILLED PLACEHOLDERS:", leftover.join(", "));
    else console.log(">>> all placeholders filled");
  } catch (e) {
    console.log("RENDER ERROR:", e.message);
  }
  console.log();
}
db.close();