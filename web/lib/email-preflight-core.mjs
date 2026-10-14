import { domainToASCII } from "node:url";
export { isEmailPreflightFresh } from "./email-preflight-freshness.mjs";

export const MX_STATUSES = Object.freeze({
  NOT_CHECKED: "not_checked",
  PRESENT: "mx_present",
  MISSING: "no_mx",
  INVALID_SYNTAX: "invalid_syntax",
  LOOKUP_ERROR: "lookup_error",
});

export const MX_PRESENT_LABEL = "MX present; mailbox existence unverified";

const noRecordCodes = new Set(["ENODATA", "ENOTFOUND"]);
const localPartPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const labelPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/** Syntax validation only. This function never performs DNS or mailbox probes. */
export function validateEmailSyntax(value) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    return { valid: false, domain: "", reason: "Enter an email address without surrounding spaces." };
  }
  if (value.length > 254) {
    return { valid: false, domain: "", reason: "Email addresses must be 254 characters or fewer." };
  }

  const firstAt = value.indexOf("@");
  if (firstAt <= 0 || firstAt !== value.lastIndexOf("@")) {
    return { valid: false, domain: "", reason: "Enter one local part and one domain separated by @." };
  }

  const local = value.slice(0, firstAt);
  const domainInput = value.slice(firstAt + 1);
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..") || !localPartPattern.test(local)) {
    return { valid: false, domain: "", reason: "The email address has an invalid local part." };
  }

  const domain = domainToASCII(domainInput).toLowerCase();
  if (!domain || domain.length > 253 || domain.endsWith(".")) {
    return { valid: false, domain: "", reason: "Enter a valid DNS domain." };
  }
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => label.length > 63 || !labelPattern.test(label))) {
    return { valid: false, domain: "", reason: "The domain must contain valid DNS labels." };
  }

  return { valid: true, domain, reason: "Syntax looks valid." };
}

/** Classifies only DNS MX lookup outcomes; it makes no SMTP or RCPT request. */
export function classifyMxLookup(records, errorCode = "") {
  if (errorCode) {
    if (noRecordCodes.has(errorCode)) return { mx_status: MX_STATUSES.MISSING, hosts: [] };
    return { mx_status: MX_STATUSES.LOOKUP_ERROR, hosts: [] };
  }

  const hosts = Array.isArray(records)
    ? records
        .map((record) => typeof record?.exchange === "string" ? record.exchange.replace(/\.$/, "") : "")
        .filter(Boolean)
    : [];
  return hosts.length
    ? { mx_status: MX_STATUSES.PRESENT, hosts }
    : { mx_status: MX_STATUSES.MISSING, hosts: [] };
}

export function mxStatusLabel(status) {
  switch (status) {
    case MX_STATUSES.PRESENT:
      return MX_PRESENT_LABEL;
    case MX_STATUSES.MISSING:
      return "No MX record found; mailbox existence unverified";
    case MX_STATUSES.INVALID_SYNTAX:
      return "Invalid email syntax; MX lookup not run";
    case MX_STATUSES.LOOKUP_ERROR:
      return "MX lookup failed; mailbox existence unverified";
    default:
      return "Not checked; mailbox existence unverified";
  }
}

/** Creates the additive preflight table. Call only on an explicitly writable DB. */
export function ensureEmailPreflightTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_preflight (
      lead_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      mx_status TEXT NOT NULL CHECK (mx_status IN ('not_checked', 'mx_present', 'no_mx', 'invalid_syntax', 'lookup_error')),
      mx_hosts TEXT NOT NULL DEFAULT '[]',
      checked_at TEXT NOT NULL,
      source_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (source_confirmed IN (0, 1)),
      source_confirmed_at TEXT
    )
  `);
}

export function getEmailPreflight(db, leadId) {
  return db.prepare(`
    SELECT lead_id, email, mx_status, mx_hosts, checked_at,
      source_confirmed, source_confirmed_at
    FROM email_preflight WHERE lead_id = ?
  `).get(leadId) || null;
}

/**
 * Stores the current exact address for a lead. Any address change clears the
 * former check and source attestation because this table is keyed by lead_id.
 */
export function invalidateEmailPreflight(db, leadId, exactEmail) {
  if (typeof exactEmail !== "string" || exactEmail.length > 254) {
    throw new Error("Email must be a string no longer than 254 characters.");
  }
  ensureEmailPreflightTable(db);
  db.prepare(`
    INSERT INTO email_preflight
      (lead_id, email, mx_status, mx_hosts, checked_at, source_confirmed, source_confirmed_at)
    VALUES (?, ?, 'not_checked', '[]', '', 0, NULL)
    ON CONFLICT(lead_id) DO UPDATE SET
      email = excluded.email,
      mx_status = 'not_checked',
      mx_hosts = '[]',
      checked_at = '',
      source_confirmed = 0,
      source_confirmed_at = NULL
  `).run(leadId, exactEmail);
  return getEmailPreflight(db, leadId);
}

export function saveMxCheck(db, { leadId, exactEmail, status, hosts, checkedAt }) {
  if (!Object.values(MX_STATUSES).includes(status) || status === MX_STATUSES.NOT_CHECKED) {
    throw new Error("A DNS check must have a completed MX status.");
  }
  ensureEmailPreflightTable(db);
  return db.transaction(() => {
    const prior = getEmailPreflight(db, leadId);
    const preserveConfirmation = prior?.email === exactEmail &&
      prior.mx_status === MX_STATUSES.PRESENT && status === MX_STATUSES.PRESENT &&
      Number(prior.source_confirmed) === 1;

    db.prepare(`
      INSERT INTO email_preflight
        (lead_id, email, mx_status, mx_hosts, checked_at, source_confirmed, source_confirmed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(lead_id) DO UPDATE SET
        email = excluded.email,
        mx_status = excluded.mx_status,
        mx_hosts = excluded.mx_hosts,
        checked_at = excluded.checked_at,
        source_confirmed = excluded.source_confirmed,
        source_confirmed_at = excluded.source_confirmed_at
    `).run(
      leadId,
      exactEmail,
      status,
      JSON.stringify(hosts),
      checkedAt,
      preserveConfirmation ? 1 : 0,
      preserveConfirmation ? prior.source_confirmed_at : null,
    );
    return getEmailPreflight(db, leadId);
  })();
}

export function confirmEmailSource(db, { leadId, exactEmail, confirmationEmail, sawPublishedAddress, confirmedAt }) {
  ensureEmailPreflightTable(db);
  if (sawPublishedAddress !== true || confirmationEmail !== exactEmail) {
    throw new Error("Confirm that you saw this exact email address published by the company.");
  }
  const current = getEmailPreflight(db, leadId);
  if (!current || current.email !== exactEmail || current.mx_status !== MX_STATUSES.PRESENT) {
    throw new Error("Run an MX-present check for this exact address before source confirmation.");
  }
  const result = db.prepare(`
    UPDATE email_preflight
    SET source_confirmed = 1, source_confirmed_at = ?
    WHERE lead_id = ? AND email = ? AND mx_status = 'mx_present'
  `).run(confirmedAt, leadId, exactEmail);
  if (result.changes !== 1) {
    throw new Error("This email changed during confirmation. Run the MX check again.");
  }
  return getEmailPreflight(db, leadId);
}
