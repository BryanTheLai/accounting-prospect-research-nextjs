import { validateEmailSyntax, saveMxCheck, confirmEmailSource, getEmailPreflight, isEmailPreflightFresh } from './email-preflight-core.mjs';

const heldRoles = /support|customerservice|customer.?care|myorder|no.?reply|newsletter|privacy|legal|security|abuse|complaint|escalat|recruit|career|talent|(?:^|[._-])(?:hr|jobs?|pr|cs|ir|dpo)(?:[._-]|$)/i;

export function stageVerifiedAddresses(db, records, { apply = false, now = new Date().toISOString() } = {}) {
  const seen = new Set();
  for (const record of records) {
    const email = String(record.email || '').trim().toLowerCase();
    if (!validateEmailSyntax(email).valid || heldRoles.test(email.split('@')[0])) throw new Error(`Unsuitable email: ${record.lead_id}`);
    if (seen.has(email)) throw new Error('Duplicate recipient in preparation batch');
    seen.add(email);
    if (record.identity_reviewed !== true || record.address_context_reviewed !== true || record.published_address_observed !== true) {
      throw new Error(`Company and exact address source need review: ${record.lead_id}`);
    }
    const source = new URL(record.source_url);
    const root = String(record.root_domain || '').toLowerCase().replace(/^www\./, '');
    const sourceDomain = source.hostname.toLowerCase().replace(/^www\./, '');
    if (source.protocol !== 'https:' || !root || sourceDomain !== root) throw new Error(`Source is not the company site: ${record.lead_id}`);
    const emailDomain = email.split('@')[1];
    if (emailDomain !== root && !emailDomain.endsWith(`.${root}`)) throw new Error('Email domain differs from reviewed company');
    if (!/^[a-f0-9]{64}$/.test(record.source_sha256 || '')) throw new Error('Missing archived source hash');
    if (!Array.isArray(record.mx_hosts) || !record.mx_hosts.length || record.mx_hosts.some(host => !host || host === '.')) throw new Error('Missing mail routing');
    if (!isEmailPreflightFresh({ source_confirmed: 1, checked_at: record.checked_at, source_confirmed_at: record.checked_at }, new Date(now))) {
      throw new Error('Source/MX evidence is stale or invalid');
    }
    const prior = db.prepare("SELECT 1 FROM campaign_sends WHERE (lead_id=? OR lower(trim(recipient_email))=?) AND coalesce(response_msg,'') NOT LIKE '%[DRY-RUN%' UNION SELECT 1 FROM email_suppression WHERE lower(trim(email))=? LIMIT 1").get(record.lead_id, email, email);
    if (prior) throw new Error(`Prior outreach or suppression: ${record.lead_id}`);
    const lead = db.prepare('SELECT * FROM prospects WHERE lead_id=?').get(record.lead_id);
    if (!lead) throw new Error(`Stage the company before its address: ${record.lead_id}`);
    if (!['NEW', 'Ready to Review', 'Target Identified'].includes(lead.status)) throw new Error(`Not a review-stage prospect: ${record.lead_id}`);
    if (lead.root_domain.toLowerCase().replace(/^www\./, '') !== root || lead.company_name !== record.company_name) throw new Error('Company identity changed');
    if (lead.contact_email && lead.contact_email.trim().toLowerCase() !== email) throw new Error('Existing address differs; do not overwrite');
  }
  if (!apply) return { eligible_for_source_staging: records.length, applied: 0, send_approved: 0, emails_sent: 0 };
  return db.transaction(() => {
    let applied = 0;
    for (const record of records) {
      const email = record.email.trim().toLowerCase();
      const lead = db.prepare('SELECT * FROM prospects WHERE lead_id=?').get(record.lead_id);
      const preflight = getEmailPreflight(db, record.lead_id);
      if (lead.contact_email?.trim().toLowerCase() === email && preflight?.email === email && preflight.mx_status === 'mx_present' && isEmailPreflightFresh(preflight, new Date(now))) continue;
      const note = `Published address checked ${record.checked_at}: ${email} at ${record.source_url}; archived SHA256 ${record.source_sha256}. Domain mail routing present; individual mailbox existence unverified. Outreach approval remains separate.`;
      const updated = db.prepare('UPDATE prospects SET contact_email=?,notes=? WHERE lead_id=? AND contact_email IS ? AND status=?').run(email, `${lead.notes || ''}\n${note}`.trim(), record.lead_id, lead.contact_email, lead.status);
      if (updated.changes !== 1) throw new Error('Prospect changed during source staging');
      saveMxCheck(db, { leadId: record.lead_id, exactEmail: email, status: 'mx_present', hosts: record.mx_hosts, checkedAt: record.checked_at });
      confirmEmailSource(db, { leadId: record.lead_id, exactEmail: email, confirmationEmail: email, sawPublishedAddress: true, confirmedAt: now });
      applied++;
    }
    return { eligible_for_source_staging: records.length, applied, send_approved: 0, emails_sent: 0 };
  })();
}
