/**
 * Confirm staged discovery candidates by re-fetching each official site and
 * checking the exact address string is actually published on it.
 *
 * Only an address that is literally present on the company's own site gets
 * source_confirmed = 1. Anything unverified, ambiguous, or served from a
 * non-official host is left at 0 for a human to look at.
 *
 * This does NOT approve a prospect or start a send; it only records the
 * factual observation that the address appears on the official site.
 *
 * Usage: node --experimental-strip-types scripts/verify-and-confirm.mjs
 */

import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";
import { confirmEmailSource } from "../lib/email-preflight-core.mjs";

const DB = process.env.OUTBOUNDER_DB_PATH || "/var/lib/outbounder/leads.sqlite";
const RESULTS = process.env.DISCOVERY_RESULTS || "/root/discovery-results.json";
const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 12000;
const PATHS = ["/", "/contact", "/contact-us", "/about", "/about-us"];

const rows = JSON.parse(await readFile(RESULTS, "utf8"))
  .filter((r) => (r.discovery?.candidates?.length ?? 0) > 0 && r.lead_id);

const db = new Database(DB);
const dbSafe = new Database(DB, { readonly: true });

// Only consider addresses we staged and that still need confirmation.
const staged = dbSafe
  .prepare(
    `SELECT p.lead_id, p.company_name, e.email, e.mx_status
       FROM prospects p
       JOIN email_preflight e ON e.lead_id = p.lead_id
      WHERE e.source_confirmed = 0
        AND trim(coalesce(p.contact_email, '')) = ''`,
  )
  .all();
dbSafe.close();

const byLead = new Map(staged.map((r) => [r.lead_id, r]));
const targets = rows.filter((r) => byLead.has(r.lead_id));
console.log(`candidates to verify: ${targets.length}`);

// Never confirm a support, compliance, privacy or recruiting inbox, even when
// the address is genuinely published on the official site. These are service
// and legal/HR functions, not buyers.
// Matched anywhere in the local part, so regional prefixes and Cloudflare
// address obfuscation ("u003esupport@", "sg-dpo@") are caught too.
const NEVER_LOCAL = new RegExp(
  "(?:^|[._+-])(?:support|customerservice|customercare|help|helpdesk|billing|" +
  "dpo|dpo1|gdpr|ccpa|privacy|compliance|legal|counsel|abuse|" +
  "hr|humanresources|jobs|careers|recruit|talent|hiring|onboarding)(?:$|[._+-])",
  "i",
);

function isNeverConfirm(email) {
  let local = String(email).split("@")[0].trim().toLowerCase();
  // Some sites obfuscate the local part as "u003esupport" / "u0040domain".
  const decoded = local
    .replace(/u003e/gi, ".")
    .replace(/u0040/gi, "@")
    .replace(/\(at\)/gi, "@")
    .replace(/\[at\]/gi, "@");
  for (const part of [local, decoded]) {
    if (NEVER_LOCAL.test(part)) return true;
    // Catch compound roles with no delimiter, e.g. "apisupport", "sghelpdesk".
    if (/(?:support|helpdesk|helpdesk|customerservice|customercare|recruit|careers|privacy|compliance|billing|abuse)/i.test(part)) {
      return true;
    }
  }
  return /^(?:dpo|gdpr|ccpa|hr|talent)$/i.test(local);
}

async function fetchText(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "OutbounderSourceCheck/1.0", Accept: "text/html" },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html")) return null;
    return { body: (await res.text()).toLowerCase(), finalUrl: res.url };
  } catch {
    return null;
  }
}

async function verifyOne(entry) {
  const meta = byLead.get(entry.lead_id);
  const domain = String(entry.root_domain || "").replace(/^www\./, "").toLowerCase();
  const address = String(meta.email || "").toLowerCase();
  const result = { lead_id: entry.lead_id, domain, address, ok: false, why: "", source: "" };

  if (!domain || !address.includes("@")) { result.why = "no_domain_or_address"; return result; }
  if (isNeverConfirm(address)) { result.why = "compliance_or_hr_inbox"; return result; }
  // The address must belong to the company's own domain.
  const addrDomain = address.split("@")[1];
  if (addrDomain !== domain && !addrDomain.endsWith(`.${domain}`)) {
    result.why = "address_domain_mismatch";
    return result;
  }

  for (const path of PATHS) {
    const page = await fetchText(`https://${domain}${path}`);
    if (!page) continue;
    // Require the literal address on a page served by that domain.
    try {
      const finalHost = new URL(page.finalUrl).hostname.replace(/^www\./, "").toLowerCase();
      if (finalHost !== domain && !finalHost.endsWith(`.${domain}`)) continue;
    } catch { continue; }
    if (!page.body.includes(address)) continue;

    // A mailto: link is stronger evidence than a bare string in a footer script.
    const mailto = page.body.includes(`mailto:${address}`);
    result.ok = true;
    result.source = `https://${domain}${path}`;
    result.why = mailto ? "mailto_link" : "published_on_official_page";
    return result;
  }
  result.why = "not_found_on_official_pages";
  return result;
}

const out = new Array(targets.length);
let cursor = 0;
let done = 0;

async function worker() {
  while (true) {
    const i = cursor;
    if (i >= targets.length) return;
    cursor += 1;
    out[i] = await verifyOne(targets[i]);
    done += 1;
    if (done % 10 === 0 || done === targets.length) {
      console.log(`  ${done}/${targets.length} checked (${out.filter((r) => r?.ok).length} found on official site)`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

const confirmed = out.filter((r) => r?.ok);
const rejected = out.filter((r) => r && !r.ok);

const nowIso = () => new Date().toISOString();
const confirm = db.transaction((rec) => {
  for (const r of rec) {
    const meta = byLead.get(r.lead_id);
    // confirmEmailSource requires an mx_present row for this exact address.
    // Only verify candidates whose MX check already passed; anything else is
    // left for a human to re-check.
    if (meta?.mx_status !== "mx_present") continue;
    confirmEmailSource(db, {
      leadId: r.lead_id,
      exactEmail: r.address,
      confirmationEmail: r.address,
      sawPublishedAddress: true,
      confirmedAt: nowIso(),
    });
  }
});
confirm(confirmed);

const actuallyConfirmed = db
  .prepare("SELECT COUNT(*) AS c FROM email_preflight WHERE source_confirmed = 1")
  .get().c;

console.log("");
console.log(`verified on official site: ${confirmed.length}`);
console.log(`left for human review:     ${rejected.length}`);
console.log(`source_confirmed total:    ${actuallyConfirmed}`);
const tally = {};
for (const r of rejected) tally[r.why] = (tally[r.why] || 0) + 1;
console.log("not-verified reasons:", tally);
console.log("");
for (const r of confirmed.slice(0, 15)) {
  console.log(`  OK   ${r.domain.padEnd(26)} ${r.address.padEnd(38)} ${r.why}`);
}
console.log("...");
for (const r of rejected.slice(0, 10)) {
  console.log(`  SKIP ${r.domain.padEnd(26)} ${r.address.padEnd(38)} ${r.why}`);
}

db.close();