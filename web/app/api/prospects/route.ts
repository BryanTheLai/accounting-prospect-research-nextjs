import { dbError, openDatabase, prospectFields } from "@/lib/db";
import { getProspects, parseProspectFilters, ProspectFilterInputError } from "@/lib/prospects";
import { reviewProspects } from "@/lib/prospect-review.mjs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  let db;
  try {
    db = openDatabase();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const prospect = db.prepare(`SELECT ${prospectFields} FROM prospects WHERE lead_id = ?`).get(id);
      return prospect ? Response.json(prospect) : Response.json({ error: "Prospect not found" }, { status: 404 });
    }
    const filters = parseProspectFilters(url.searchParams);
    return Response.json(getProspects(db, filters));
  } catch (error) {
    if (error instanceof ProspectFilterInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return dbError(error);
  } finally {
    db?.close();
  }
}

export async function POST(request: Request) {
  let db;
  try {
    const body = await request.json();
    if (body.action === "review") {
      if (body.confirmed !== true) return Response.json({ error: "Confirm lead review" }, { status: 400 });
      const scope = typeof body.campaignId === "string" ? body.campaignId : "all";
      db = openDatabase(false);
      const result = reviewProspects(db, scope, true);
      return Response.json({ ...result, decisions: undefined });
    }
    const company = String(body.company || "").trim().slice(0, 160);
    if (!company) return Response.json({ error: "Company name is required" }, { status: 400 });
    db = openDatabase(false);
    const existing = db.prepare("SELECT lead_id FROM prospects WHERE company_name = ? COLLATE NOCASE").get(company);
    if (existing) return Response.json({ error: "That company is already in prospects" }, { status: 409 });
    const id = `manual_${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO prospects (lead_id, company_name, root_domain, headquarters, sector, status, quality_score, notes)
      VALUES (?, ?, '', ?, ?, 'Ready to Review', 0, ?)`)
      .run(id, company, String(body.location || "").trim().slice(0, 120), String(body.sector || "").trim().slice(0, 120), "Added from Outbounder");
    return Response.json({ id, company }, { status: 201 });
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
    const id = String(body.id || "");
    const allowed = ["Ready to Review", "Approved for Outreach", "In Sequence (Smartlead)", "Replied (Warm)", "Discovery Call Booked", "Proposal Sent", "Closed Won (Retainer Signed)", "Discovery in progress", "Nurture / Follow-up", "Bounced / 550 Invalid", "Discarded / DNC"];
    if (!id || !allowed.includes(body.status)) return Response.json({ error: "Choose a valid prospect stage" }, { status: 400 });
    db = openDatabase(false);
    const result = db.prepare("UPDATE prospects SET status = ? WHERE lead_id = ?").run(body.status, id);
    return result.changes ? Response.json({ ok: true }) : Response.json({ error: "Prospect not found" }, { status: 404 });
  } catch (error) {
    return dbError(error);
  } finally {
    db?.close();
  }
}
