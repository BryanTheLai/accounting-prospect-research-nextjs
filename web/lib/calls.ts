import type Database from "better-sqlite3";

export const CALL_DISPOSITIONS = [
  { code: "CONNECTED_MEETING_BOOKED", label: "Meeting booked" },
  { code: "CONNECTED_CALLBACK", label: "Callback requested" },
  { code: "CONNECTED_NOT_INTERESTED", label: "Not interested" },
  { code: "CONNECTED_WRONG_PERSON", label: "Wrong person" },
  { code: "GATEKEEPER_BLOCKED", label: "Gatekeeper blocked" },
  { code: "GATEKEEPER_TRANSFERRED", label: "Gatekeeper transferred" },
  { code: "NO_ANSWER_VOICEMAIL", label: "Voicemail left" },
  { code: "NO_ANSWER_RING_OUT", label: "Ring out / no answer" },
  { code: "BUSY", label: "Busy tone" },
  { code: "BAD_NUMBER", label: "Disconnected / invalid number" },
] as const;

export type CallDisposition = (typeof CALL_DISPOSITIONS)[number]["code"];
const dispositionCodes = new Set<string>(CALL_DISPOSITIONS.map((item) => item.code));

export class CallInputError extends Error {}

export type SaveCallInput = {
  leadId: string;
  disposition: CallDisposition;
  notes: string;
  nextFollowupAt: string | null;
  durationSeconds: number;
};

export function parseCallInput(body: unknown): SaveCallInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CallInputError("Request body must be an object.");
  }
  const input = body as Record<string, unknown>;
  const leadId = typeof input.leadId === "string" ? input.leadId.trim() : "";
  const disposition = typeof input.disposition === "string" ? input.disposition : "";
  if (!leadId || leadId.length > 240 || !dispositionCodes.has(disposition)) {
    throw new CallInputError("Choose a valid prospect and call outcome.");
  }

  if (input.notes !== undefined && typeof input.notes !== "string") {
    throw new CallInputError("Call notes must be text.");
  }
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (notes.length > 1000) throw new CallInputError("Call notes must be 1,000 characters or fewer.");

  let nextFollowupAt: string | null = null;
  if (input.nextFollowupAt !== undefined && input.nextFollowupAt !== null && input.nextFollowupAt !== "") {
    if (typeof input.nextFollowupAt !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(input.nextFollowupAt) || !Number.isFinite(Date.parse(input.nextFollowupAt))) {
      throw new CallInputError("Enter a valid follow-up date and time.");
    }
    nextFollowupAt = new Date(input.nextFollowupAt).toISOString();
  }

  const duration = input.durationSeconds === undefined ? 0 : Number(input.durationSeconds);
  if (!Number.isInteger(duration) || duration < 0 || duration > 3600) {
    throw new CallInputError("Call duration must be a whole number from 0 to 3,600 seconds.");
  }

  return {
    leadId,
    disposition: disposition as CallDisposition,
    notes,
    nextFollowupAt,
    durationSeconds: duration,
  };
}

export function ensureCallTables(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS call_logs (
    call_id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id TEXT NOT NULL,
    caller_name TEXT NOT NULL DEFAULT 'Bryan',
    target_phone TEXT NOT NULL DEFAULT '',
    target_name TEXT,
    company_name TEXT,
    campaign_id TEXT,
    disposition TEXT NOT NULL,
    duration_seconds INTEGER DEFAULT 0,
    call_notes TEXT,
    next_followup_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  const leadColumns = new Set((db.pragma("table_info(prospects)") as { name: string }[]).map((column) => column.name));
  for (const [name, sqlType] of [["call_attempts_count", "INTEGER DEFAULT 0"], ["last_called_at", "TIMESTAMP"], ["last_disposition", "TEXT"]]) {
    if (!leadColumns.has(name)) db.exec(`ALTER TABLE prospects ADD COLUMN ${name} ${sqlType}`);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_call_logs_lead_created ON call_logs(lead_id, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_call_logs_campaign_created ON call_logs(campaign_id, created_at)");
}

export function saveCallOutcome(db: Database.Database, input: SaveCallInput, now = new Date()) {
  ensureCallTables(db);
  const nowIso = now.toISOString();
  return db.transaction(() => {
    const lead = db.prepare(`SELECT lead_id, company_name, buyer_name, campaign_id, contact_phone
      FROM prospects WHERE lead_id = ?`).get(input.leadId) as {
        lead_id: string; company_name: string; buyer_name: string | null;
        campaign_id: string | null; contact_phone: string | null;
      } | undefined;
    if (!lead) return null;

    const result = db.prepare(`INSERT INTO call_logs (
      lead_id, target_phone, target_name, company_name, campaign_id, disposition,
      duration_seconds, call_notes, next_followup_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      lead.lead_id, lead.contact_phone || "", lead.buyer_name || "", lead.company_name,
      lead.campaign_id || "", input.disposition, input.durationSeconds,
      input.notes, input.nextFollowupAt, nowIso,
    );

    const nextStatus = input.disposition === "CONNECTED_MEETING_BOOKED" ? "Discovery Call Booked"
      : input.disposition === "CONNECTED_CALLBACK" || input.disposition === "NO_ANSWER_VOICEMAIL" ? "Nurture / Follow-up"
      : input.disposition === "CONNECTED_NOT_INTERESTED" ? "Discarded / DNC" : null;
    db.prepare(`UPDATE prospects SET call_attempts_count = coalesce(call_attempts_count, 0) + 1,
      last_called_at = ?, last_disposition = ?, status = coalesce(?, status) WHERE lead_id = ?`)
      .run(nowIso, input.disposition, nextStatus, lead.lead_id);
    return Number(result.lastInsertRowid);
  })();
}

export type CallDashboard = {
  campaignId: string;
  metrics: {
    dialsToday: number;
    connectsToday: number;
    meetingsBookedToday: number;
    gatekeeperBlocks: number;
    connectRatePct: number;
    meetingConversionPct: number;
  };
  recentCalls: Array<{
    callId: number;
    leadId: string;
    company: string;
    targetName: string | null;
    disposition: CallDisposition;
    durationSeconds: number;
    notes: string | null;
    nextFollowupAt: string | null;
    createdAt: string;
  }>;
};

export function getCallDashboard(db: Database.Database, campaignId: string, now = new Date()): CallDashboard {
  const hasCallLogs = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'call_logs'").get());
  if (!hasCallLogs) return emptyCallDashboard(campaignId);

  const scoped = campaignId === "all" ? "" : " AND campaign_id = @campaignId";
  const params = { campaignId, today: now.toISOString() };
  const rows = db.prepare(`SELECT disposition, COUNT(*) AS count
    FROM call_logs WHERE date(created_at) = date(@today)${scoped}
    GROUP BY disposition`).all(params) as Array<{ disposition: string; count: number }>;
  const breakdown = new Map(rows.map((row) => [row.disposition, Number(row.count)]));
  const dialsToday = rows.reduce((sum, row) => sum + Number(row.count), 0);
  const connectsToday = rows.reduce((sum, row) => sum + (row.disposition.startsWith("CONNECTED_") ? Number(row.count) : 0), 0);
  const meetingsBookedToday = breakdown.get("CONNECTED_MEETING_BOOKED") || 0;
  const gatekeeperBlocks = breakdown.get("GATEKEEPER_BLOCKED") || 0;
  const recentCalls = db.prepare(`SELECT call_id AS callId, lead_id AS leadId,
      coalesce(company_name, '') AS company, target_name AS targetName,
      disposition, coalesce(duration_seconds, 0) AS durationSeconds,
      call_notes AS notes, next_followup_at AS nextFollowupAt, created_at AS createdAt
    FROM call_logs WHERE 1 = 1${scoped}
    ORDER BY datetime(created_at) DESC, call_id DESC LIMIT 12`).all(params) as CallDashboard["recentCalls"];

  return {
    campaignId,
    metrics: {
      dialsToday,
      connectsToday,
      meetingsBookedToday,
      gatekeeperBlocks,
      connectRatePct: dialsToday ? Math.round((connectsToday / dialsToday) * 1000) / 10 : 0,
      meetingConversionPct: connectsToday ? Math.round((meetingsBookedToday / connectsToday) * 1000) / 10 : 0,
    },
    recentCalls,
  };
}

function emptyCallDashboard(campaignId: string): CallDashboard {
  return {
    campaignId,
    metrics: { dialsToday: 0, connectsToday: 0, meetingsBookedToday: 0, gatekeeperBlocks: 0, connectRatePct: 0, meetingConversionPct: 0 },
    recentCalls: [],
  };
}
