import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { isEmailPreflightFresh } from '../lib/email-preflight-core.mjs';
import { renderEmailTemplatePreview } from '../lib/email-template-preview.mjs';

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('Usage: node scripts/verify-prepared-outreach.mjs <batch-manifest.json>');
const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
const db = new Database(fileURLToPath(new URL('../../operations/recovered-leads-20261008/leads.sqlite', import.meta.url)), { readonly: true, fileMustExist: true });
try {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE campaign_id=?').get(manifest.campaign_id);
  if (!campaign) throw new Error('Prepared campaign missing');
  const template = db.prepare('SELECT * FROM outbound_templates WHERE name=?').get(campaign.default_template_name);
  if (!template) throw new Error('Matching template missing');
  const seen = new Set();
  const domains = new Set();
  for (const record of manifest.records) {
    const lead = db.prepare('SELECT * FROM prospects WHERE lead_id=?').get(record.lead_id);
    const preflight = db.prepare('SELECT * FROM email_preflight WHERE lead_id=?').get(record.lead_id);
    if (!lead || lead.contact_email !== record.email || lead.campaign_id !== manifest.campaign_id) throw new Error(`Staged row mismatch: ${record.company_name}`);
    if (seen.has(record.email) || domains.has(record.root_domain)) throw new Error('Duplicate recipient/domain');
    seen.add(record.email);
    domains.add(record.root_domain);
    if (!preflight || preflight.email !== record.email || preflight.mx_status !== 'mx_present' || !isEmailPreflightFresh(preflight)) throw new Error(`Source/MX checks incomplete: ${record.company_name}`);
    if (renderEmailTemplatePreview(template.subject, lead, () => 0) !== record.subject || renderEmailTemplatePreview(template.body, lead, () => 0) !== record.body) throw new Error(`Frozen copy differs: ${record.company_name}`);
    if (db.prepare("SELECT 1 FROM campaign_sends WHERE (lead_id=? OR lower(trim(recipient_email))=?) AND coalesce(response_msg,'') NOT LIKE '%[DRY-RUN%' UNION SELECT 1 FROM email_suppression WHERE lower(trim(email))=? LIMIT 1").get(record.lead_id, record.email, record.email)) throw new Error(`Prior attempt/suppression: ${record.company_name}`);
  }
  console.log(JSON.stringify({ batch_id: manifest.batch_id, companies: manifest.records.length, unique_recipients: seen.size,
    unique_domains: domains.size, source_and_mx_fresh: manifest.records.length, live_template_renders_match_packet: manifest.records.length,
    campaign_status: campaign.status, public_owner_addresses: manifest.records.filter(record => record.owner_name).length,
    new_campaign_queue_rows: db.prepare('SELECT COUNT(*) n FROM dispatch_queue q JOIN prospects p ON p.lead_id=q.lead_id WHERE p.campaign_id=?').get(manifest.campaign_id).n,
    send_approved: manifest.send_approved, mailbox_existence: 'unverified; published address and domain mail routing checked' }, null, 2));
} finally {
  db.close();
}
