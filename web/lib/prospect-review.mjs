import { isEmailPreflightFresh } from "./email-preflight-freshness.mjs";
import { validateEmailSyntax } from "./email-preflight-core.mjs";
import { classifyEmailTier } from "./email-tier.mjs";
import { isGovernmentLead } from "./prospects.ts";

export function reviewProspects(db, campaignId = "all", apply = false) {
  const hasPreflight = db.prepare("SELECT 1 FROM sqlite_master WHERE name='email_preflight'").get();
  const records = hasPreflight ? new Map(db.prepare("SELECT * FROM email_preflight").all().map((row) => [row.lead_id, row])) : new Map();
  const suppressed = new Set(db.prepare("SELECT lower(trim(email)) email FROM email_suppression").all().map((row) => row.email));
  const contacted = new Set(db.prepare("SELECT lower(trim(recipient_email)) email FROM campaign_sends WHERE coalesce(response_msg,'') NOT LIKE '%[DRY-RUN%'").all().map((row) => row.email));
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='dispatch_queue'").get()) {
    for (const row of db.prepare("SELECT lower(trim(q.email)) email FROM dispatch_queue q JOIN dispatch_runs r ON r.run_id=q.run_id WHERE r.live=1 AND q.status IN ('IN_FLIGHT','UNCERTAIN')").all()) contacted.add(row.email);
  }
  const rows = db.prepare("SELECT p.* FROM prospects p JOIN campaigns c ON c.campaign_id=p.campaign_id WHERE c.status<>'ARCHIVED' AND p.status IN ('NEW','Ready to Review','Target Identified') AND (?='all' OR p.campaign_id=?) ORDER BY p.quality_score DESC").all(campaignId, campaignId);
  const report = { reviewed: rows.length, qualified: 0, approved: 0, held: { fit: 0, source: 0, email: 0, priorContact: 0, government: 0 }, decisions: [] };
  for (const row of rows) {
    const email = String(row.contact_email || "").trim().toLowerCase(), evidence = records.get(row.lead_id);
    let reason = "";
    if (isGovernmentLead({ company: row.company_name, rootDomain: row.root_domain, email, summary: row.company_summary })) reason = "government";
    else if (suppressed.has(email) || contacted.has(email)) reason = "priorContact";
    else if (!(row.quality_score > 80)) reason = "fit";
    else if (!/^https:\/\//i.test(row.proof_link || "")) reason = "source";
    else {
      report.qualified++;
      if (!validateEmailSyntax(email).valid || classifyEmailTier(email, row.buyer_name) === "system" || !evidence || evidence.email.trim().toLowerCase() !== email || evidence.mx_status !== "mx_present" || !isEmailPreflightFresh(evidence)) reason = "email";
    }
    if (reason) report.held[reason]++;
    else report.approved++;
    report.decisions.push({ id: row.lead_id, company: row.company_name, reason: reason || "ready", nextStatus: reason ? row.quality_score > 80 && reason === "email" ? "Ready to Review" : row.status : "Approved for Outreach" });
  }
  if (apply) db.transaction(() => {
    for (const decision of report.decisions) {
      db.prepare("UPDATE prospects SET status=? WHERE lead_id=? AND status IN ('NEW','Ready to Review','Target Identified')").run(decision.nextStatus, decision.id);
    }
  })();
  return report;
}
