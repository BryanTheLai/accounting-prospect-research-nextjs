import { readFile, writeFile } from "node:fs/promises";
import Database from "better-sqlite3";
import { saveMxCheck, confirmEmailSource, isEmailPreflightFresh } from "../lib/email-preflight-core.mjs";
import { renderEmailTemplatePreview } from "../lib/email-template-preview.mjs";

const dir = "../operations/yc-source-reviewed-20261008";
const db = new Database("../operations/recovered-leads-20261008/leads.sqlite");
db.pragma("busy_timeout = 5000");
await db.backup(`${dir}/before-enrichment-${Date.now()}.sqlite`);
const evidence = JSON.parse(await readFile(`${dir}/context-reviewed.json`, "utf8"));
const originalIds = ["yc_alex_com", "yc_agentmail", "yc_besimple_ai", "yc_anglera", "yc_betterbasket", "yc_avent"];
for (const r of evidence) {
  const html = await readFile(`${dir}/${r.lead_id}.source.html`, "utf8");
  if (!html.toLowerCase().includes(r.email)) throw new Error(`Missing exact source: ${r.lead_id}`);
  if (!r.mx_hosts.length) throw new Error(`Missing MX evidence: ${r.lead_id}`);
}
const now = new Date().toISOString();
const neverContacted = (id, email) => !db.prepare(`
  SELECT 1 FROM campaign_sends WHERE (lead_id = ? OR lower(trim(recipient_email)) = ?)
  AND coalesce(response_msg, '') NOT LIKE '%[DRY-RUN%' LIMIT 1
`).get(id, email) && !db.prepare("SELECT 1 FROM email_suppression WHERE lower(trim(email)) = ?").get(email);
db.transaction(() => {
  for (const r of evidence) {
    const lead = db.prepare("SELECT * FROM prospects WHERE lead_id = ?").get(r.lead_id);
    if (!lead || lead.status !== "Approved for Outreach" || lead.campaign_id !== "yc_us_expansion") throw new Error(`Prospect changed: ${r.lead_id}`);
    if (lead.contact_email !== r.old_email && lead.contact_email !== r.email) throw new Error(`Email changed since discovery: ${r.lead_id}`);
    if (!neverContacted(r.lead_id, r.email)) throw new Error(`Prior contact/suppression: ${r.lead_id}`);
    const note = `Published email source reviewed ${now}: ${r.email} at ${r.source_url}. Exact page archived in operations/yc-source-reviewed-20261008/${r.lead_id}.source.html. Mailbox existence is not verified.`;
    if (lead.contact_email !== r.email) {
      db.prepare("UPDATE prospects SET contact_email = ?, notes = ? WHERE lead_id = ? AND contact_email = ?")
        .run(r.email, `${lead.notes || ""}\n${note}`.trim(), r.lead_id, r.old_email);
    }
    saveMxCheck(db, { leadId: r.lead_id, exactEmail: r.email, status: "mx_present", hosts: r.mx_hosts, checkedAt: r.checked_at });
    confirmEmailSource(db, { leadId: r.lead_id, exactEmail: r.email, confirmationEmail: r.email, sawPublishedAddress: true, confirmedAt: now });
  }
})();
const uncontactedOriginalIds = originalIds.filter((id) => {
  const lead = db.prepare("SELECT contact_email FROM prospects WHERE lead_id = ?").get(id);
  return lead && neverContacted(id, lead.contact_email.toLowerCase());
});
const ids = [...uncontactedOriginalIds, ...evidence.slice(0, 100 - uncontactedOriginalIds.length).map((r) => r.lead_id)];
if (ids.length !== 100 || new Set(ids).size !== 100) throw new Error("Expected 100 distinct leads");
const templates = db.prepare("SELECT * FROM outbound_templates WHERE template_id IN (88, 89) ORDER BY template_id").all();
if (templates.length !== 2) throw new Error("Missing saved YC A/B pair");
const prior = new Map(db.prepare("SELECT lead_id, assigned_template_id FROM campaign_ab_assignments WHERE campaign_id = 'yc_us_expansion' AND template_pair_key = '88:89'").all().map((r) => [r.lead_id, r.assigned_template_id]));
let index = 0;
db.transaction(() => {
  for (const id of ids) {
    if (prior.has(id)) continue;
    const templateId = index++ % 2 ? 89 : 88;
    db.prepare("INSERT INTO campaign_ab_assignments (campaign_id, lead_id, template_pair_key, assigned_template_id) VALUES ('yc_us_expansion', ?, '88:89', ?)").run(id, templateId);
    prior.set(id, templateId);
  }
})();
const batch = [];
const seenEmails = new Set(), seenDomains = new Set();
for (const id of ids) {
  const lead = db.prepare("SELECT * FROM prospects WHERE lead_id = ?").get(id);
  const email = lead.contact_email.trim().toLowerCase();
  if (!neverContacted(id, email)) throw new Error(`Previously contacted: ${id}`);
  const domain = email.split("@")[1];
  if (seenEmails.has(email) || seenDomains.has(domain)) throw new Error(`Duplicate recipient/domain: ${id}`);
  seenEmails.add(email); seenDomains.add(domain);
  const preflight = db.prepare("SELECT * FROM email_preflight WHERE lead_id = ?").get(id);
  if (preflight.email !== lead.contact_email || preflight.mx_status !== "mx_present" || !isEmailPreflightFresh(preflight)) throw new Error(`Not ready: ${id}`);
  const template = templates.find((t) => t.template_id === prior.get(id));
  const subject = renderEmailTemplatePreview(template.subject, lead, () => 0);
  const body = renderEmailTemplatePreview(template.body, lead, () => 0);
  if (/[{}]/.test(subject + body) || !subject.trim() || !body.trim()) throw new Error(`Invalid render: ${id}`);
  batch.push({ lead_id: id, company: lead.company_name, email, template_id: template.template_id, variant: template.name, subject, body });
}
const payload = { action: "start", leadIds: ids, campaignId: "yc_us_expansion", templateAName: templates[0].name, templateBName: templates[1].name, liveConfirmed: true };
await writeFile(`${dir}/batch-100.json`, JSON.stringify(batch, null, 2));
await writeFile(`${dir}/start-payload.json`, JSON.stringify(payload, null, 2));
const preview = ["# YC outreach — 100 exact messages", "", "Senders: bryanlai@openclose-desk.com and bryan@openclose-desk.com", "", ...batch.flatMap((r, i) => [`## ${i + 1}. ${r.company}`, `To: ${r.email}`, `Variant: ${r.variant}`, `Subject: ${r.subject}`, "", r.body, ""])].join("\n");
await writeFile(`${dir}/batch-preview.md`, preview);
console.log(JSON.stringify({ enriched_source_confirmed: evidence.length, total_ready_expected: evidence.length + uncontactedOriginalIds.length, batch: batch.length, unique_addresses: seenEmails.size, unique_domains: seenDomains.size, variant_counts: Object.fromEntries(templates.map((t) => [t.template_id, batch.filter((r) => r.template_id === t.template_id).length])) }, null, 2));
db.close();
