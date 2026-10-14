import type Database from "better-sqlite3";

export type MailboxStatus = "ACTIVE" | "COOLDOWN" | "PAUSED" | "ERROR";
export type MailboxProvider = "MICROSOFT" | "GOOGLE" | "ANY" | "OTHER";

export type MailboxInput = {
  email: string;
  senderName: string;
  smtpServer: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword?: string;
  dailyLimit: number;
  hourlyLimit: number;
  providerType: MailboxProvider;
  manualLimits?: boolean;
};

export type MailboxRecord = {
  id: number;
  email: string;
  senderName: string;
  smtpServer: string;
  smtpPort: number;
  dailyLimit: number;
  hourlyLimit: number;
  manualLimits: boolean;
  providerType: MailboxProvider | string;
  status: MailboxStatus | string;
  cooldownUntil: string | null;
  sendsToday: number;
  sendsThisHour: number;
  /** Sends since local midnight, unaffected by a quota reset. Always the truthful number. */
  sendsSinceMidnight: number;
  /** Start of the active daily quota window, or null when the window is plain midnight. */
  quotaWindowStart: string | null;
  credentialConfigured: boolean;
  health: "Available" | "At quota" | "Cooling down" | "Paused" | "Error" | "Unknown";
};

export type SuppressionRecord = { email: string; reason: string; createdAt: string | null };

export class MailboxInputError extends Error {}
export class MailboxNotFoundError extends Error {}
export class MailboxSchemaError extends Error {}

const PROVIDERS = new Set<MailboxProvider>(["MICROSOFT", "GOOGLE", "ANY", "OTHER"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;

function text(value: unknown, label: string, maxLength: number, required = true): string {
  if (typeof value !== "string") throw new MailboxInputError(`${label} must be text.`);
  const result = value.trim();
  if (required && !result) throw new MailboxInputError(`${label} is required.`);
  if (result.length > maxLength) throw new MailboxInputError(`${label} is too long.`);
  return result;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new MailboxInputError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function normalizeMailbox(input: unknown, requirePassword: boolean): MailboxInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new MailboxInputError("Mailbox details are required.");
  const value = input as Record<string, unknown>;
  const email = text(value.email, "Mailbox email", 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new MailboxInputError("Enter a valid mailbox email address.");
  const smtpServer = text(value.smtpServer, "SMTP server", 253).toLowerCase();
  if (!HOST_PATTERN.test(smtpServer)) throw new MailboxInputError("Enter a valid SMTP server hostname.");
  const providerType = text(value.providerType, "Provider", 20).toUpperCase() as MailboxProvider;
  if (!PROVIDERS.has(providerType)) throw new MailboxInputError("Choose a supported provider.");
  const suppliedPassword = value.smtpPassword;
  if (requirePassword && (typeof suppliedPassword !== "string" || suppliedPassword.length === 0)) {
    throw new MailboxInputError("SMTP password is required when adding a mailbox.");
  }
  if (suppliedPassword !== undefined && typeof suppliedPassword !== "string") {
    throw new MailboxInputError("SMTP password must be text.");
  }
  if (typeof suppliedPassword === "string" && suppliedPassword.length > 1000) {
    throw new MailboxInputError("SMTP password is too long.");
  }
  const dailyLimit = integer(value.dailyLimit, "Daily quota", 1, Number.MAX_SAFE_INTEGER);
  const hourlyLimit = integer(value.hourlyLimit, "Hourly quota", 1, Number.MAX_SAFE_INTEGER);
  if (value.manualLimits !== undefined && typeof value.manualLimits !== "boolean") throw new MailboxInputError("Choose manual or recommended warmup limits.");
  if (hourlyLimit > dailyLimit) throw new MailboxInputError("Hourly quota cannot exceed the daily quota.");
  return {
    email,
    senderName: text(value.senderName, "Sender name", 160),
    smtpServer,
    smtpPort: integer(value.smtpPort, "SMTP port", 1, 65535),
    smtpUser: text(value.smtpUser ?? "", "SMTP username", 254, requirePassword),
    ...(suppliedPassword === undefined ? {} : { smtpPassword: suppliedPassword as string }),
    dailyLimit,
    hourlyLimit,
    providerType,
    manualLimits: value.manualLimits !== false,
  };
}

function assertTables(db: Database.Database, required: string[]) {
  const exists = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?");
  const missing = required.filter((name) => !exists.get(name));
  if (missing.length) throw new MailboxSchemaError("Mailbox and suppression tables are unavailable in the local database.");
}

function hasColumn(db: Database.Database, table: string, column: string) {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).some((entry) => entry.name === column);
}

function ensureManualLimitsColumn(db: Database.Database) {
  if (!hasColumn(db, "mailboxes", "manual_limits")) db.exec("ALTER TABLE mailboxes ADD COLUMN manual_limits INTEGER NOT NULL DEFAULT 1");
}

function ensureQuotaResetTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mailbox_quota_resets (
      mailbox_id INTEGER PRIMARY KEY,
      reset_at TEXT NOT NULL,
      reset_by TEXT,
      note TEXT
    )
  `);
}

function quotaResetTableExists(db: Database.Database): boolean {
  return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'mailbox_quota_resets'").get());
}

/**
 * Start of the active daily quota window for a mailbox id, or null for plain midnight.
 *
 * Read-only safe: the listing endpoint opens the database without write permission, so
 * this must never create the table. A missing table simply means no reset has happened.
 */
function quotaWindowStart(db: Database.Database, mailboxId: number): string | null {
  if (!quotaResetTableExists(db)) return null;
  const row = db.prepare("SELECT reset_at FROM mailbox_quota_resets WHERE mailbox_id = ?").get(mailboxId) as
    | { reset_at: string | null }
    | undefined;
  const value = row?.reset_at ?? null;
  if (!value) return null;
  // A reset from a previous day is spent; the window falls back to midnight.
  if (value.slice(0, 10) < new Date().toLocaleDateString("en-CA")) return null;
  return value;
}

function countSends(db: Database.Database, email: string, mailboxId: number): { today: number; hour: number; sinceMidnight: number; windowStart: string | null } {
  const needed = ["status", "sender_email", "sent_at"];
  if (!db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'campaign_sends'").get() ||
      needed.some((column) => !hasColumn(db, "campaign_sends", column))) {
    return { today: 0, hour: 0, sinceMidnight: 0, windowStart: null };
  }
  const dryRunClause = hasColumn(db, "campaign_sends", "response_msg")
    ? "AND COALESCE(response_msg, '') NOT LIKE '%[DRY-RUN%'"
    : "";
  const windowStart = quotaWindowStart(db, mailboxId);
  const stmt = db.prepare(`
    SELECT
      SUM(CASE WHEN date(sent_at) = date('now', 'localtime') THEN 1 ELSE 0 END) AS sinceMidnight,
      SUM(CASE WHEN sent_at >= datetime('now', 'localtime', '-1 hour') THEN 1 ELSE 0 END) AS hour
    FROM campaign_sends
    WHERE status = 'SENT' AND lower(sender_email) = lower(?) ${dryRunClause}
  `);
  const row = stmt.get(email) as { sinceMidnight: number | null; hour: number | null };
  const sinceMidnight = Number(row.sinceMidnight || 0);
  const hour = Number(row.hour || 0);
  let today = sinceMidnight;
  if (windowStart) {
    const scoped = db.prepare(`
      SELECT COUNT(*) AS n FROM campaign_sends
      WHERE status = 'SENT' AND lower(sender_email) = lower(?) ${dryRunClause} AND sent_at >= ?
    `).get(email, windowStart) as { n: number | null };
    today = Number(scoped.n || 0);
  }
  return { today, hour, sinceMidnight, windowStart };
}

/**
 * Start a fresh daily quota window for one mailbox.
 *
 * This never deletes or edits send history: it only moves the window start, so
 * `sendsSinceMidnight`, lifetime totals, bounce counts and deliverability stay truthful.
 * The rolling hourly limit is unaffected on purpose, because it is derived from real
 * send timestamps and is the actual anti-spam protection.
 */
export function resetMailboxQuotaWindow(db: Database.Database, raw: unknown): Record<string, unknown> {
  const mailboxId = parseMailboxId((raw as Record<string, unknown>)?.id);
  ensureQuotaResetTable(db);
  const mailbox = db.prepare("SELECT email FROM mailboxes WHERE mailbox_id = ?").get(mailboxId) as
    | { email: string }
    | undefined;
  if (!mailbox) throw new MailboxNotFoundError("That mailbox no longer exists.");
  const before = countSends(db, mailbox.email, mailboxId);
  const resetAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  db.prepare(`
    INSERT INTO mailbox_quota_resets (mailbox_id, reset_at, reset_by, note)
    VALUES (?, ?, 'operator', 'manual reset from sender controls')
    ON CONFLICT(mailbox_id) DO UPDATE SET
      reset_at = excluded.reset_at, reset_by = excluded.reset_by, note = excluded.note
  `).run(mailboxId, resetAt);
  return {
    email: mailbox.email,
    resetAt,
    sendsBeforeReset: before.today,
    sendsSinceMidnight: before.sinceMidnight,
  };
}

function health(status: string, today: number, dailyLimit: number, hour: number, hourlyLimit: number): MailboxRecord["health"] {
  switch (status.toUpperCase()) {
    case "ERROR": return "Error";
    case "COOLDOWN": return "Cooling down";
    case "PAUSED": return "Paused";
    case "ACTIVE": return today >= dailyLimit || hour >= hourlyLimit ? "At quota" : "Available";
    default: return "Unknown";
  }
}

export function listMailboxes(db: Database.Database): MailboxRecord[] {
  assertTables(db, ["mailboxes", "email_suppression"]);
  const rows = db.prepare(`
    SELECT mailbox_id, email, sender_name, smtp_server, smtp_port, daily_limit, hourly_limit,
      provider_type, status, cooldown_until, smtp_password,
      ${hasColumn(db, "mailboxes", "manual_limits") ? "manual_limits" : "0 AS manual_limits"}
    FROM mailboxes ORDER BY mailbox_id
  `).all() as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const sends = countSends(db, String(row.email), Number(row.mailbox_id));
    const status = String(row.status || "UNKNOWN");
    const dailyLimit = Number(row.daily_limit);
    const hourlyLimit = Number(row.hourly_limit);
    return {
      id: Number(row.mailbox_id),
      email: String(row.email),
      senderName: String(row.sender_name || ""),
      smtpServer: String(row.smtp_server || ""),
      smtpPort: Number(row.smtp_port),
      dailyLimit,
      hourlyLimit,
      manualLimits: Number(row.manual_limits) === 1,
      providerType: String(row.provider_type || "UNKNOWN"),
      status,
      cooldownUntil: row.cooldown_until == null ? null : String(row.cooldown_until),
      sendsToday: sends.today,
      sendsThisHour: sends.hour,
      sendsSinceMidnight: sends.sinceMidnight,
      quotaWindowStart: sends.windowStart,
      credentialConfigured: typeof row.smtp_password === "string" && row.smtp_password.length > 0,
      health: health(status, sends.today, dailyLimit, sends.hour, hourlyLimit),
    };
  });
}

export function listSuppressions(db: Database.Database): SuppressionRecord[] {
  assertTables(db, ["mailboxes", "email_suppression"]);
  return (db.prepare("SELECT email, reason, created_at FROM email_suppression ORDER BY created_at DESC, email").all() as Array<{
    email: string; reason: string; created_at: string | null;
  }>).map((row) => ({ email: row.email, reason: row.reason, createdAt: row.created_at }));
}

export function createMailbox(db: Database.Database, raw: unknown): number {
  assertTables(db, ["mailboxes", "email_suppression"]);
  const mailbox = normalizeMailbox(raw, true);
  ensureManualLimitsColumn(db);
  try {
    const result = db.prepare(`
      INSERT INTO mailboxes (email, sender_name, smtp_server, smtp_port, smtp_user, smtp_password,
        daily_limit, hourly_limit, status, provider_type, manual_limits)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PAUSED', ?, ?)
    `).run(mailbox.email, mailbox.senderName, mailbox.smtpServer, mailbox.smtpPort, mailbox.smtpUser,
      mailbox.smtpPassword, mailbox.dailyLimit, mailbox.hourlyLimit, mailbox.providerType, Number(mailbox.manualLimits));
    return Number(result.lastInsertRowid);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      throw new MailboxInputError("A mailbox with this email already exists.");
    }
    throw error;
  }
}

export function updateMailbox(db: Database.Database, id: number, raw: unknown): void {
  assertTables(db, ["mailboxes", "email_suppression"]);
  const mailbox = normalizeMailbox(raw, false);
  ensureManualLimitsColumn(db);
  const fields = ["email = ?", "sender_name = ?", "smtp_server = ?", "smtp_port = ?"];
  const values: Array<string | number> = [mailbox.email, mailbox.senderName, mailbox.smtpServer, mailbox.smtpPort];
  if (mailbox.smtpUser) { fields.push("smtp_user = ?"); values.push(mailbox.smtpUser); }
  if (mailbox.smtpPassword) { fields.push("smtp_password = ?"); values.push(mailbox.smtpPassword); }
  fields.push("daily_limit = ?", "hourly_limit = ?", "provider_type = ?", "manual_limits = ?");
  values.push(mailbox.dailyLimit, mailbox.hourlyLimit, mailbox.providerType, Number(mailbox.manualLimits), id);
  try {
    const result = db.prepare(`UPDATE mailboxes SET ${fields.join(", ")} WHERE mailbox_id = ?`).run(...values);
    if (result.changes !== 1) throw new MailboxNotFoundError("Mailbox not found.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      throw new MailboxInputError("A mailbox with this email already exists.");
    }
    throw error;
  }
}

export function setMailboxStatus(db: Database.Database, id: number, status: "ACTIVE" | "PAUSED"): void {
  assertTables(db, ["mailboxes", "email_suppression"]);
  const result = db.prepare(`UPDATE mailboxes SET status = ?, cooldown_until = NULL WHERE mailbox_id = ?`).run(status, id);
  if (result.changes !== 1) throw new MailboxNotFoundError("Mailbox not found.");
}

export function deleteMailbox(db: Database.Database, id: number): void {
  assertTables(db, ["mailboxes", "email_suppression"]);
  const result = db.prepare("DELETE FROM mailboxes WHERE mailbox_id = ?").run(id);
  if (result.changes !== 1) throw new MailboxNotFoundError("Mailbox not found.");
}

export function addSuppression(db: Database.Database, raw: unknown): { added: boolean } {
  assertTables(db, ["mailboxes", "email_suppression"]);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new MailboxInputError("Suppression details are required.");
  const value = raw as Record<string, unknown>;
  const email = text(value.email, "Email address", 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new MailboxInputError("Enter a valid email address.");
  const reason = text(value.reason, "Reason", 500);
  return db.transaction(() => {
    const existing = db.prepare("SELECT 1 AS found FROM email_suppression WHERE lower(email) = lower(?)").get(email);
    if (existing) return { added: false };
    const result = db.prepare("INSERT OR IGNORE INTO email_suppression (email, reason) VALUES (?, ?)").run(email, reason);
    return { added: result.changes === 1 };
  })();
}

export function parseMailboxId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new MailboxInputError("Mailbox ID is invalid.");
  return value;
}

export function applyMailboxAction(db: Database.Database, raw: unknown): { result: Record<string, unknown>; status: number } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new MailboxInputError("Request details are required.");
  const body = raw as Record<string, unknown>;
  if (body.confirmed !== true) throw new MailboxInputError("Confirm this change in the mailbox controls before saving.");
  if (body.action === "create") return { result: { id: createMailbox(db, body.mailbox) }, status: 201 };
  if (body.action === "update") {
    updateMailbox(db, parseMailboxId(body.id), body.mailbox);
    return { result: { updated: true }, status: 200 };
  }
  if (body.action === "pause" || body.action === "activate") {
    setMailboxStatus(db, parseMailboxId(body.id), body.action === "pause" ? "PAUSED" : "ACTIVE");
    return { result: { updated: true }, status: 200 };
  }
  if (body.action === "delete") {
    deleteMailbox(db, parseMailboxId(body.id));
    return { result: { deleted: true }, status: 200 };
  }
  if (body.action === "suppress") return { result: addSuppression(db, body.suppression), status: 200 };
  if (body.action === "reset-quota") return { result: { quotaReset: resetMailboxQuotaWindow(db, body) }, status: 200 };
  throw new MailboxInputError("Choose a supported mailbox action.");
}
