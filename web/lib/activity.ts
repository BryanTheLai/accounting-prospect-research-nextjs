import type Database from "better-sqlite3";

export type ActivityCounts = {
  sent: number;
  dryRun: number;
  bounced: number;
  deferred: number;
  failedSuppressed: number;
  other: number;
  total: number;
};

export type ActivityEvent = {
  sentAt: string | null;
  company: string | null;
  subject: string | null;
  variant: string | null;
  status: string;
  dryRun: boolean;
};

export type ActivityReport = {
  counts: ActivityCounts;
  statusBreakdown: Array<{ status: string; count: number }>;
  recentEvents: ActivityEvent[];
  suppressionCount: number;
  daily: Array<ActivityCounts & { date: string }>;
};

const EMPTY_COUNTS: ActivityCounts = {
  sent: 0,
  dryRun: 0,
  bounced: 0,
  deferred: 0,
  failedSuppressed: 0,
  other: 0,
  total: 0,
};

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function columnsFor(db: Database.Database, table: string): Set<string> {
  return new Set((db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name));
}

function count(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function redactAddresses(value: unknown): string | null {
  if (value == null) return null;
  return String(value).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted address]");
}

function buildStatusCounts(db: Database.Database, sendColumns: Set<string>) {
  if (!sendColumns.has("status")) {
    return { counts: { ...EMPTY_COUNTS }, statusBreakdown: [] as ActivityReport["statusBreakdown"] };
  }

  const responseExpression = sendColumns.has("response_msg")
    ? "COALESCE(response_msg, '') LIKE '%[DRY-RUN%'"
    : "0";
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count,
      SUM(CASE WHEN ${responseExpression} THEN 1 ELSE 0 END) AS dry_run_count
    FROM campaign_sends
    GROUP BY status
    ORDER BY status
  `).all() as Array<{ status: string | null; count: number; dry_run_count: number | null }>;

  const counts = { ...EMPTY_COUNTS };
  const statusBreakdown = rows.map((row) => ({
    status: redactAddresses(row.status) || "UNKNOWN",
    count: count(row.count),
  }));

  for (const row of rows) {
    const status = String(row.status || "UNKNOWN").toUpperCase();
    const total = count(row.count);
    const dryRun = Math.min(total, count(row.dry_run_count));
    counts.total += total;

    if (status === "SENT") {
      counts.dryRun += dryRun;
      counts.sent += total - dryRun;
    } else if (status === "BOUNCED") {
      counts.bounced += total;
    } else if (status === "DEFERRED" || status.startsWith("DEFERRED_")) {
      counts.deferred += total;
    } else if (["FAILED", "SUPPRESSED", "AUTH_ERROR", "SENDER_AUTH_ERROR", "RENDER_ERROR", "ERROR", "REPUTATION_BLOCK"].includes(status)) {
      counts.failedSuppressed += total;
    } else {
      counts.other += total;
    }
  }

  return { counts, statusBreakdown };
}

function buildRecentEvents(db: Database.Database, sendColumns: Set<string>): ActivityEvent[] {
  if (!sendColumns.has("status")) return [];

  const sentAt = sendColumns.has("sent_at") ? "sent_at" : "NULL";
  const company = sendColumns.has("company_name") ? "company_name" : "NULL";
  const subject = sendColumns.has("subject") ? "subject" : "NULL";
  const variant = sendColumns.has("variant_name") ? "variant_name" : "NULL";
  const dryRun = sendColumns.has("response_msg")
    ? "(status = 'SENT' AND COALESCE(response_msg, '') LIKE '%[DRY-RUN%')"
    : "0";
  const orderBy = sendColumns.has("sent_at") ? "sent_at DESC" : "rowid DESC";

  const rows = db.prepare(`
    SELECT ${sentAt} AS sent_at, ${company} AS company_name, ${subject} AS subject,
      ${variant} AS variant_name, status, ${dryRun} AS is_dry_run
    FROM campaign_sends
    ORDER BY ${orderBy}, rowid DESC
    LIMIT 100
  `).all() as Array<{
    sent_at: string | null;
    company_name: string | null;
    subject: string | null;
    variant_name: string | null;
    status: string | null;
    is_dry_run: number;
  }>;

  return rows.map((row) => ({
    sentAt: row.sent_at == null ? null : String(row.sent_at),
    company: redactAddresses(row.company_name),
    subject: redactAddresses(row.subject),
    variant: redactAddresses(row.variant_name),
    status: redactAddresses(row.status) || "UNKNOWN",
    dryRun: count(row.is_dry_run) === 1,
  }));
}

export function getOutboundActivity(db: Database.Database): ActivityReport {
  const hasSends = tableExists(db, "campaign_sends");
  const sendColumns = hasSends ? columnsFor(db, "campaign_sends") : new Set<string>();
  const { counts, statusBreakdown } = hasSends
    ? buildStatusCounts(db, sendColumns)
    : { counts: { ...EMPTY_COUNTS }, statusBreakdown: [] };
  const recentEvents = hasSends ? buildRecentEvents(db, sendColumns) : [];

  const suppressionCount = tableExists(db, "email_suppression")
    ? count((db.prepare("SELECT COUNT(*) AS count FROM email_suppression").get() as { count: number }).count)
    : 0;

  const daily: ActivityReport["daily"] = [];
  if (sendColumns.has("sent_at") && sendColumns.has("status")) {
    const today = (db.prepare("SELECT date('now','localtime') day").get() as { day: string }).day;
    for (let offset = 29; offset >= 0; offset--) {
      const date = new Date(`${today}T12:00:00`); date.setDate(date.getDate() - offset);
      daily.push({ ...EMPTY_COUNTS, date: `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` });
    }
    const byDay = new Map(daily.map((day) => [day.date, day]));
    const dry = sendColumns.has("response_msg") ? "coalesce(response_msg,'') LIKE '%[DRY-RUN%'" : "0";
    const rows = db.prepare(`SELECT date(sent_at) day,status,COUNT(*) n,SUM(CASE WHEN ${dry} THEN 1 ELSE 0 END) dry FROM campaign_sends WHERE date(sent_at)>=date('now','localtime','-29 days') AND date(sent_at)<=date('now','localtime') GROUP BY date(sent_at),status`).all() as Array<{day:string;status:string;n:number;dry:number}>;
    for (const row of rows) {
      const day = byDay.get(row.day); if (!day) continue;
      const status = String(row.status || 'UNKNOWN').toUpperCase();
      day.total += row.n;
      if (status === "SENT") { day.sent += row.n-row.dry; day.dryRun += row.dry; }
      else if (status === "BOUNCED") day.bounced += row.n;
      else if (status.startsWith("DEFERRED")) day.deferred += row.n;
      else if (["FAILED","SUPPRESSED","AUTH_ERROR","SENDER_AUTH_ERROR","RENDER_ERROR","ERROR","REPUTATION_BLOCK"].includes(status)) day.failedSuppressed += row.n;
      else day.other += row.n;
    }
  }

  return {
    counts,
    statusBreakdown,
    recentEvents,
    suppressionCount,
    daily,
  };
}
