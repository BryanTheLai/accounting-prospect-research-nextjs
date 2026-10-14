import { dbError, openDatabase } from "@/lib/db";
import {
  buildYcCsv,
  getFilteredYcRows,
  getYcDirectory,
  ingestYcRows,
  parseYcFilters,
  YcInputError,
} from "@/lib/yc";

export const runtime = "nodejs";

function inputError(error: unknown) {
  if (error instanceof YcInputError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}

export async function GET(request: Request) {
  let db;
  try {
    const url = new URL(request.url);
    const filters = parseYcFilters(url.searchParams);
    db = openDatabase();
    if (url.searchParams.get("format") === "csv") {
      const csv = buildYcCsv(getFilteredYcRows(db, filters));
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=yc-directory.csv",
          "Cache-Control": "no-store",
        },
      });
    }
    return Response.json(getYcDirectory(db, filters), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return inputError(error) || dbError(error);
  } finally {
    db?.close();
  }
}

export async function POST(request: Request) {
  let db;
  try {
    const body: unknown = await request.json();
    const ids = typeof body === "object" && body !== null && "ids" in body ? body.ids : undefined;
    db = openDatabase(false);
    return Response.json(ingestYcRows(db, ids), { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    return inputError(error) || dbError(error);
  } finally {
    db?.close();
  }
}
