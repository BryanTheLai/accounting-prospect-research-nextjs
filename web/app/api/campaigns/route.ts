import { dbError, openDatabase } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  let db;
  try {
    db = openDatabase();
    const campaigns = db.prepare(`
      SELECT c.campaign_id AS id, c.name, c.tagline, c.status, c.created_at AS createdAt,
        c.target_criteria AS audience,
        c.schedule_timezone AS scheduleTimezone,
        c.schedule_start_minute AS scheduleStartMinute,
        c.schedule_end_minute AS scheduleEndMinute,
        CASE WHEN c.description IN ('Outbounder Desk draft','Outbounder draft') THEN 1 ELSE 0 END AS draft,
        COUNT(p.lead_id) AS prospects
      FROM campaigns c LEFT JOIN prospects p ON p.campaign_id = c.campaign_id
      WHERE c.status<>'ARCHIVED'
      GROUP BY c.campaign_id ORDER BY c.created_at DESC
    `).all() as Record<string, unknown>[];
    return Response.json({ campaigns: campaigns.map((campaign) => ({ ...campaign, draft: campaign.draft === 1 })) });
  } catch (error) {
    return dbError(error);
  } finally {
    db?.close();
  }
}

export async function POST(request: Request) {
  let db;
  try {
    const body = await request.json();
    const name = String(body.name || "").trim().slice(0, 140);
    const audience = String(body.audience || "").trim().slice(0, 240);
    if (!name) return Response.json({ error: "Campaign name is required" }, { status: 400 });
    db = openDatabase(false);
    const id = `desk_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    db.prepare(`INSERT INTO campaigns (campaign_id, name, tagline, description, target_criteria, status)
      VALUES (?, ?, ?, 'Outbounder draft', ?, 'PAUSED')`)
      .run(id, name, audience || "Audience to define", audience);
    return Response.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    return dbError(error);
  } finally {
    db?.close();
  }
}

export async function PATCH(request: Request) {
  let db;
  try {
    const body = await request.json();
    const id = String(body.id || "").trim();
    const timezone = String(body.scheduleTimezone || "").trim();
    const startMinute = Number(body.scheduleStartMinute);
    const endMinute = Number(body.scheduleEndMinute);
    if (!id) return Response.json({ error: "Campaign id is required" }, { status: 400 });
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date()); }
    catch { return Response.json({ error: "Choose a valid IANA time zone" }, { status: 400 }); }
    if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute) || startMinute < 0 || endMinute > 1440 || startMinute >= endMinute) {
      return Response.json({ error: "Choose a valid local send window" }, { status: 400 });
    }
    db = openDatabase(false);
    const result = db.prepare(`UPDATE campaigns SET schedule_timezone = ?, schedule_start_minute = ?,
      schedule_end_minute = ?, schedule_configured = 1, updated_at = datetime('now', 'localtime')
      WHERE campaign_id = ?`).run(timezone, startMinute, endMinute, id);
    return result.changes ? Response.json({ ok: true }) : Response.json({ error: "Campaign not found" }, { status: 404 });
  } catch (error) {
    return dbError(error);
  } finally {
    db?.close();
  }
}
