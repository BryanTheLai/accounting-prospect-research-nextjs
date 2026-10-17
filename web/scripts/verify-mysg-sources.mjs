/**
 * Confirm MY/SG lead addresses by re-fetching each company's official site and
 * checking the exact address string is published there.
 *
 * verify-and-confirm.mjs only handles addresses that were empty on the lead and
 * filled in by discovery. Every MY/SG lead already has an address, so that
 * script skipped all of them and left source_confirmed = 0 forever. This walks
 * the MY/SG pools directly instead.
 *
 * An address is only confirmed when it literally appears on a page served by the
 * company's own domain. Support, DPO, legal and HR inboxes are never confirmed,
 * even when genuinely published.
 *
 * This does not approve or send; it records a factual observation.
 *
 * Usage: node --experimental-strip-types scripts/verify-mysg-sources.mjs
 */

import Database from "better-sqlite3";
import { confirmEmailSource } from "../lib/email-preflight-core.mjs";

const DB = process.env.OUTBOUNDER_DB_PATH || "/var/lib/outbounder/leads.sqlite";
const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 12000;
const PATHS = ["/", "/contact", "/contact-us", "/about", "/about-us"];
// How long an unconfirmed address keeps being retried before we stop spending
// fetch time on it. Companies add contact pages occasionally, but waiting
// months for one is not worth blocking the daily pipeline.
const RETRY_WINDOW_DAYS = Number(process.env.VERIFY_RETRY_DAYS || 7);
const POOLS = [
  "hydroball_clones",
  "jobstreet_hiring_pain",
  "mysg_consumer_retail_accounting",
];

// Same blocklist as verify-and-confirm.mjs: these are service and legal/HR
// functions, not buyers, so they are never a send target.
const NEVER_LOCAL = new RegExp(
  "(?:^|[._+-])(?:support|customerservice|customercare|help|helpdesk|billing|" +
    "dpo|dpo1|gdpr|ccpa|privacy|compliance|legal|counsel|abuse|" +
    "hr|humanresources|jobs|careers|recruit|talent|hiring|onboarding)(?:$|[._+-])",
  "i",
);

function isNeverConfirm(email) {
  let local = String(email).split("@")[0].trim().toLowerCase();
  const decoded = local
    .replace(/u003e/gi, ".")
    .replace(/u0040/gi, "@")
    .replace(/\(at\)/gi, "@")
    .replace(/\[at\]/gi, "@");
  for (const part of [local, decoded]) {
    if (NEVER_LOCAL.test(part)) return true;
    if (
      /(?:support|helpdesk|customerservice|customercare|recruit|careers|privacy|compliance|billing|abuse)/i.test(
        part,
      )
    )
      return true;
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

async function verifyOne(row) {
  const address = String(row.email || "").trim().toLowerCase();
  const domain = String(row.domain || "").replace(/^www\./, "").toLowerCase();
  const out = { lead_id: row.lead_id, domain, address, ok: false, why: "", source: "" };

  if (!domain || !address.includes("@")) {
    out.why = "no_domain_or_address";
    return out;
  }
  if (isNeverConfirm(address)) {
    out.why = "compliance_or_hr_inbox";
    return out;
  }
  const addrDomain = address.split("@")[1];
  if (addrDomain !== domain && !addrDomain.endsWith(`.${domain}`)) {
    out.why = "address_domain_mismatch";
    return out;
  }

  for (const path of PATHS) {
    const page = await fetchText(`https://${domain}${path}`);
    if (!page) continue;
    try {
      const finalHost = new URL(page.finalUrl).hostname.replace(/^www\./, "").toLowerCase();
      if (finalHost !== domain && !finalHost.endsWith(`.${domain}`)) continue;
    } catch {
      continue;
    }
    if (!page.body.includes(address)) continue;

    out.ok = true;
    out.source = `https://${domain}${path}`;
    out.why = page.body.includes(`mailto:${address}`)
      ? "mailto_link"
      : "published_on_official_page";
    return out;
  }
  out.why = "not_found_on_official_pages";
  return out;
}

const db = new Database(DB);
const placeholders = POOLS.map(() => "?").join(",");

// Only MX-present leads that are still unconfirmed and not blocklisted.
const rows = db
  .prepare(
    `SELECT p.lead_id,
            lower(trim(p.contact_email)) AS email,
            COALESCE(
              NULLIF(lower(trim(p.root_domain)), ''),
              lower(substr(p.contact_email, instr(p.contact_email,'@') + 1))
            ) AS domain
       FROM prospects p
       JOIN email_preflight e ON e.lead_id = p.lead_id
      WHERE p.campaign_id IN (${placeholders})
        AND e.mx_status = 'mx_present'
        AND e.source_confirmed = 0
        AND trim(coalesce(p.contact_email,'')) <> ''
        AND instr(p.contact_email,'@') > 1
        -- Retry budget. Without this, every address we fail to find is
        -- re-fetched on every scheduled cycle forever, which is slow enough to
        -- get the supervisor killed mid-run. Most of these companies simply do
        -- not publish the address on any page we visit, so retrying rarely
        -- helps; we give each a few chances across RETRY_WINDOW_DAYS and then
        -- stop paying for them.
        AND (
          e.source_confirmed_at IS NULL
          OR julianday('now') - julianday(e.source_confirmed_at) <= ${RETRY_WINDOW_DAYS}
        )
      ORDER BY p.lead_id`,
  )
  .all(...POOLS);

console.log(`MY/SG leads to verify: ${rows.length}`);
if (rows.length === 0) process.exit(0);

/**
 * Record that we tried this address and did not confirm it, so the retry window
 * counts down. Deliberately does NOT set source_confirmed: a failed lookup must
 * never look like a confirmation to any downstream gate.
 */
const markAttempted = db.prepare(
  "UPDATE email_preflight SET source_confirmed_at = ? WHERE lead_id = ? AND source_confirmed = 0",
);
const markAttemptedAt = (leadId) => {
  markAttempted.run(attemptedAt, leadId);
};

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < rows.length) {
    const row = rows[cursor++];
    try {
      results.push(await verifyOne(row));
    } catch (err) {
      results.push({ lead_id: row.lead_id, ok: false, why: "error: " + String(err).slice(0, 60) });
    }
    if (results.length % 25 === 0) {
      const ok = results.filter((r) => r.ok).length;
      console.log(`  ...${results.length}/${rows.length} confirmed=${ok}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

let confirmed = 0;
let blocked = 0;
let skipped = 0;
const attemptedAt = new Date().toISOString();
for (const r of results) {
  if (r.ok) {
    const sent = confirmEmailSource(db, {
      leadId: r.lead_id,
      exactEmail: r.address,
      confirmationEmail: r.address,
      sawPublishedAddress: true,
      confirmedAt: new Date().toISOString(),
    });
    if (sent) confirmed++;
    else skipped++;
    console.log(`  OK    ${r.domain}  ${r.address}  ${r.why}`);
  } else if (r.why === "compliance_or_hr_inbox") {
    blocked++;
    console.log(`  BLOCK ${r.domain}  ${r.address}  ${r.why}`);
    markAttemptedAt(r.lead_id);
  } else {
    skipped++;
    console.log(`  SKIP  ${r.domain}  ${r.address}  ${r.why}`);
    // Stamp the attempt so the retry window counts down from now rather than
    // from whenever this lead was first staged.
    markAttemptedAt(r.lead_id);
  }
}

console.log("");
console.log(`confirmed: ${confirmed}`);
console.log(`blocked (service/HR/legal): ${blocked}`);
console.log(`skipped: ${skipped}`);
db.close();