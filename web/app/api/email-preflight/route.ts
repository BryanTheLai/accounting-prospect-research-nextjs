import { dbError, openDatabase } from "@/lib/db";
import { resolveMx } from "@/lib/dns-resolver.mjs";
import {
  classifyMxLookup,
  confirmEmailSource,
  ensureEmailPreflightTable,
  getEmailPreflight,
  invalidateEmailPreflight,
  mxStatusLabel,
  MX_STATUSES,
  saveMxCheck,
  validateEmailSyntax,
} from "@/lib/email-preflight-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUERY_CHARS = 120;
const MAX_RESULTS = 50;

export async function GET(request: Request) {
  let db;
  try {
    db = openDatabase();
    const url = new URL(request.url);
    const leadId = url.searchParams.get("leadId");

    if (leadId) {
      const prospect = db.prepare(`
        SELECT lead_id, company_name, contact_email
        FROM prospects WHERE lead_id = ?
      `).get(leadId) as { lead_id: string; company_name: string; contact_email: string | null } | undefined;
      if (!prospect) return Response.json({ error: "Prospect not found" }, { status: 404 });

      const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'email_preflight'").get();
      const record = table ? getEmailPreflight(db, leadId) : null;
      return Response.json({ prospect, preflight: record });
    }

    const query = (url.searchParams.get("q") || "").trim().slice(0, MAX_QUERY_CHARS);
    const rows = db.prepare(`
      SELECT lead_id, company_name, contact_email
      FROM prospects
      WHERE (? = '' OR company_name LIKE ? OR contact_email LIKE ?)
      ORDER BY company_name COLLATE NOCASE
      LIMIT ?
    `).all(query, `%${query}%`, `%${query}%`, MAX_RESULTS) as Array<{
      lead_id: string; company_name: string; contact_email: string | null;
    }>;
    return Response.json({ prospects: rows });
  } catch (error) {
    return dbError(error);
  } finally {
    db?.close();
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "Request body must be an object" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON request" }, { status: 400 });
  }

  const action = body.action;
  const leadId = typeof body.leadId === "string" ? body.leadId : "";
  const exactEmail = typeof body.email === "string" ? body.email : null;
  if (!leadId || exactEmail === null || exactEmail.length > 254) {
    return Response.json({ error: "A lead id and an email address of 254 characters or fewer are required" }, { status: 400 });
  }

  let db;
  try {
    db = openDatabase(false);
    const prospect = db.prepare("SELECT lead_id FROM prospects WHERE lead_id = ?").get(leadId);
    if (!prospect) return Response.json({ error: "Prospect not found" }, { status: 404 });

    if (action === "invalidate") {
      const record = invalidateEmailPreflight(db, leadId, exactEmail);
      return Response.json({ preflight: record, label: mxStatusLabel(record.mx_status) });
    }

    if (action === "check") {
      const syntax = validateEmailSyntax(exactEmail);
      let status = MX_STATUSES.INVALID_SYNTAX;
      let hosts: string[] = [];

      if (syntax.valid) {
        try {
          const records = await resolveMx(syntax.domain);
          const classified = classifyMxLookup(records);
          status = classified.mx_status;
          hosts = classified.hosts;
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : "UNKNOWN";
          const classified = classifyMxLookup([], code);
          status = classified.mx_status;
          hosts = classified.hosts;
        }
      }

      const record = saveMxCheck(db, {
        leadId,
        exactEmail,
        status,
        hosts,
        checkedAt: new Date().toISOString(),
      });
      return Response.json({ preflight: record, label: mxStatusLabel(record.mx_status), syntax });
    }

    if (action === "confirm_source") {
      const confirmationEmail = typeof body.confirmationEmail === "string" ? body.confirmationEmail : "";
      try {
        const record = confirmEmailSource(db, {
          leadId,
          exactEmail,
          confirmationEmail,
          sawPublishedAddress: body.sawPublishedAddress === true,
          confirmedAt: new Date().toISOString(),
        });
        return Response.json({ preflight: record, label: mxStatusLabel(record.mx_status) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Source confirmation was rejected";
        return Response.json({ error: message }, { status: 409 });
      }
    }

    return Response.json({ error: "Choose check, invalidate, or confirm_source" }, { status: 400 });
  } catch (error) {
    return dbError(error);
  } finally {
    db?.close();
  }
}
