import { dbError, openDatabase } from "@/lib/db";
import { discoverEmailsForDomain } from "@/lib/email-discovery.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1024) return Response.json({ error: "Request body is too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON request." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Request body must be an object." }, { status: 400 });
  }

  const leadId = (body as Record<string, unknown>).leadId;
  if (typeof leadId !== "string" || !leadId.trim() || leadId.length > 240) {
    return Response.json({ error: "A valid prospect id is required." }, { status: 400 });
  }

  let db;
  try {
    db = openDatabase();
    const prospect = db.prepare(`SELECT lead_id, company_name, root_domain
      FROM prospects WHERE lead_id = ?`).get(leadId.trim()) as {
        lead_id: string;
        company_name: string;
        root_domain: string | null;
      } | undefined;
    if (!prospect) return Response.json({ error: "Prospect not found." }, { status: 404 });
    if (!prospect.root_domain) return Response.json({
      prospect: { leadId: prospect.lead_id, companyName: prospect.company_name },
      status: "invalid_domain",
      pagesCrawled: 0,
      candidates: [],
    });

    const rootDomain = prospect.root_domain;
    db.close();
    db = undefined;
    const result = await discoverEmailsForDomain(rootDomain);
    return Response.json({
      prospect: { leadId: prospect.lead_id, companyName: prospect.company_name },
      ...result,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return dbError(error);
  } finally {
    db?.close();
  }
}
