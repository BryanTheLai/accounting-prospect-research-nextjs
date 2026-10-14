import { dbError, openDatabase } from "@/lib/db";
import { getProspects, parseProspectFilters, ProspectFilterInputError } from "@/lib/prospects";
import { buildProspectCsv, loadProspectExportContacts } from "@/lib/prospect-export";

export const runtime = "nodejs";

export async function GET(request: Request) {
  let db;
  try {
    db = openDatabase();
    const url = new URL(request.url);
    const filters = parseProspectFilters(url.searchParams);
    filters.limit = 500;
    filters.offset = 0;
    const rows = [];
    while (true) {
      const page = getProspects(db, filters);
      rows.push(...page.rows);
      if (!page.hasMore) break;
      filters.offset += filters.limit;
    }
    const contacts = loadProspectExportContacts(db, rows.map((row) => row.id));
    const csv = buildProspectCsv(rows, contacts);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=outbounder-prospects.csv",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ProspectFilterInputError) return Response.json({ error: error.message }, { status: 400 });
    return dbError(error);
  } finally {
    db?.close();
  }
}
