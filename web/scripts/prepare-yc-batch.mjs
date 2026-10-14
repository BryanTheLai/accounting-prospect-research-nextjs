import { readFile, writeFile, mkdir } from "node:fs/promises";
import https from "node:https";
import Database from "better-sqlite3";
import { discoverEmailsForDomain } from "../lib/email-discovery.mjs";
import { resolveMx } from "../lib/dns-resolver.mjs";
import { validateEmailSyntax, classifyMxLookup } from "../lib/email-preflight-core.mjs";

const dbPath = "../operations/recovered-leads-20261008/leads.sqlite";
const outDir = "../operations/yc-source-reviewed-20261008";
await mkdir(outDir, { recursive: true });
const shortlist = JSON.parse(await readFile("../operations/discovery-shortlist-20261008.json", "utf8"));
const db = new Database(dbPath, { readonly: true });
const attempts = db.prepare("SELECT lead_id, recipient_email FROM campaign_sends WHERE coalesce(response_msg,'') NOT LIKE '%[DRY-RUN%'").all();
const contactedIds = new Set(attempts.map((r) => r.lead_id));
const blocked = new Set(attempts.map((r) => String(r.recipient_email || "").trim().toLowerCase()));
for (const r of db.prepare("SELECT email FROM email_suppression").all()) blocked.add(String(r.email).trim().toLowerCase());
const prospects = new Map(db.prepare("SELECT * FROM prospects").all().map((p) => [p.lead_id, p]));
db.close();

const excluded = /^(?:support|billing|help|no[._-]?reply|newsletter|service|notifications?|automated|mailer|careers?|jobs?|hiring|recruit.*|talent|apply|join.*|legal|privacy|security|complaints?|abuse|press|pr|media|unsubscribe|dmca|compliance|dpo|reviewee|example|test|your.*|name|accessibility|academic|carehub|care|research|cv|dev|events)(?:[._+-]|$)/i;
const roles = new Set(["founder", "founders", "ceo", "cfo", "finance", "accounts", "accounting", "hello", "hi", "hey", "team", "company", "contact", "info", "office", "enquiry", "general", "mail", "admin", "sales", "partnerships", "marketing", "startups", "ask", "email", "inbound", "bd", "gp"]);
function rankEmail(email, buyerName) {
  const local = email.split("@")[0];
  if (excluded.test(local)) return null;
  if (["founder", "founders", "ceo", "cfo", "finance", "accounts", "accounting"].includes(local)) return 0;
  const tokens = String(buyerName || "").toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3);
  if (tokens.some((t) => local === t || local.startsWith(`${t}.`))) return 1;
  if (roles.has(local)) return 2;
  return null;
}

function fetchHtml(url, address, pages) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      headers: { "User-Agent": "OutbounderContactDiscovery/1.0", Accept: "text/html", "Accept-Encoding": "identity" },
      agent: false,
      lookup: (_host, options, callback) => options?.all
        ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4),
    }, (res) => {
      if (res.statusCode !== 200 || !String(res.headers["content-type"]).includes("text/html")) {
        res.resume(); resolve(null); return;
      }
      let size = 0; const chunks = [];
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) { req.destroy(new Error("Page too large")); return; }
        chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => {
        const html = Buffer.concat(chunks).toString("utf8");
        pages.set(String(url), html); resolve(html);
      });
    });
    const timeout = setTimeout(() => req.destroy(new Error("Source fetch timed out")), 6000);
    req.on("close", () => clearTimeout(timeout));
    req.on("error", reject); req.end();
  });
}

let cursor = 0, finished = 0;
const reviewed = [], rejected = [];
async function worker() {
  while (cursor < shortlist.length) {
    const entry = shortlist[cursor++];
    const lead = prospects.get(entry.lead_id);
    if (!lead || contactedIds.has(entry.lead_id) || lead.status !== "Approved for Outreach") continue;
    const pages = new Map();
    try {
      const discovery = await discoverEmailsForDomain(lead.root_domain, {
        fetchHtml: (url, address) => fetchHtml(url, address, pages),
      });
      const candidates = discovery.candidates.flatMap((c) => {
        const rank = rankEmail(c.email, lead.buyer_name);
        if (rank === null || blocked.has(c.email) || !validateEmailSyntax(c.email).valid) return [];
        return [{ ...c, rank }];
      }).sort((a, b) => a.rank - b.rank || a.email.localeCompare(b.email));
      let selected = null;
      for (const candidate of candidates) {
        const sourceUrl = candidate.sourceUrls.find((url) => {
          const html = pages.get(url) || "";
          const offset = html.toLowerCase().indexOf(candidate.email);
          if (offset < 0) return false;
          const context = html.slice(Math.max(0, offset - 160), offset + candidate.email.length + 160);
          return !/placeholder\s*=|example@|sample@/i.test(context);
        });
        if (!sourceUrl) continue;
        const mx = classifyMxLookup(await resolveMx(candidate.email.split("@")[1]));
        if (mx.mx_status !== "mx_present") continue;
        const html = pages.get(sourceUrl);
        const offset = html.toLowerCase().indexOf(candidate.email);
        selected = {
          lead_id: lead.lead_id, company: lead.company_name, campaign_id: lead.campaign_id,
          old_email: lead.contact_email, email: candidate.email,
          buyer_name: lead.buyer_name, rank: candidate.rank, source_url: sourceUrl,
          source_excerpt: html.slice(Math.max(0, offset - 250), offset + candidate.email.length + 250),
          checked_at: new Date().toISOString(), mx_hosts: mx.hosts,
        };
        await writeFile(`${outDir}/${lead.lead_id}.source.html`, html);
        break;
      }
      if (selected) reviewed.push(selected);
      if (!selected) rejected.push({ lead_id: lead.lead_id, reason: "No relevant exact published address with MX" });
    } catch (error) {
      rejected.push({ lead_id: lead.lead_id, reason: error.code || error.message });
    }
    finished++;
    if (finished % 20 === 0) console.log(`${finished} reviewed, ${reviewed.length} source-evidenced never-contacted companies`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
reviewed.sort((a, b) => a.rank - b.rank || a.company.localeCompare(b.company));
const seenEmails = new Set(), seenDomains = new Set();
const unique = reviewed.filter((r) => {
  const domain = r.email.split("@")[1];
  if (seenEmails.has(r.email) || seenDomains.has(domain)) return false;
  seenEmails.add(r.email); seenDomains.add(domain); return true;
});
await writeFile(`${outDir}/reviewed.json`, JSON.stringify(unique, null, 2));
await writeFile(`${outDir}/rejected.json`, JSON.stringify(rejected, null, 2));
console.log(JSON.stringify({ reviewed: finished, source_evidenced_never_contacted: unique.length, rejected: rejected.length }, null, 2));
