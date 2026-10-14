import { dbError, openDatabase } from "@/lib/db";
import {
  ImportInputError,
  MAX_IMPORT_BYTES,
  importCsvRows,
  importXlsxRows,
  listImportCampaigns,
  previewCsvImport,
  previewXlsxImport,
} from "@/lib/csv-import";

export const runtime = "nodejs";

function inputError(error: unknown) {
  if (error instanceof ImportInputError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFile(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value &&
    "name" in value && typeof value.name === "string" && "size" in value && typeof value.size === "number";
}

function validAction(action: FormDataEntryValue | null) {
  return action === "preview" || action === "import";
}

async function postXlsx(request: Request) {
  let db;
  try {
    const body = await request.formData();
    const campaignId = body.get("campaignId");
    const action = body.get("action");
    const file = body.get("file");
    if (typeof campaignId !== "string" || !validAction(action) || !isFile(file)) {
      return Response.json({ error: "Choose a campaign and provide an XLSX file." }, { status: 400 });
    }
    if (action === "import" && body.get("confirmed") !== "true") {
      return Response.json({ error: "Confirm the preview before importing." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return Response.json({ error: "Choose an .xlsx workbook." }, { status: 400 });
    }
    if (file.size > MAX_IMPORT_BYTES) {
      return Response.json({ error: "XLSX files must be 2 MB or smaller." }, { status: 413 });
    }

    const workbook = Buffer.from(await file.arrayBuffer());
    db = openDatabase(action === "import" ? false : true);
    if (action === "preview") {
      return Response.json(await previewXlsxImport(db, workbook, campaignId), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json(await importXlsxRows(db, workbook, campaignId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return inputError(error) || dbError(error);
  } finally {
    db?.close();
  }
}

export async function GET() {
  let db;
  try {
    db = openDatabase();
    return Response.json({ campaigns: listImportCampaigns(db) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return dbError(error);
  } finally {
    db?.close();
  }
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    return postXlsx(request);
  }
  let db;
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) return Response.json({ error: "Request body must be an object." }, { status: 400 });
    if (typeof body.campaignId !== "string" || typeof body.csvText !== "string") {
      return Response.json({ error: "Choose a campaign and provide CSV text." }, { status: 400 });
    }
    if (body.action !== "preview" && body.action !== "import") {
      return Response.json({ error: "Choose preview or import." }, { status: 400 });
    }
    if (body.action === "import" && body.confirmed !== true) {
      return Response.json({ error: "Confirm the preview before importing." }, { status: 400 });
    }

    db = openDatabase(body.action === "import" ? false : true);
    if (body.action === "preview") {
      return Response.json(previewCsvImport(db, body.csvText, body.campaignId), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json(importCsvRows(db, body.csvText, body.campaignId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    return inputError(error) || dbError(error);
  } finally {
    db?.close();
  }
}
