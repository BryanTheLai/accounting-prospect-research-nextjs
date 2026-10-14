import { dbError, openDatabase } from "@/lib/db";
import {
  activatePlaybook,
  createPlaybookDraft,
  listPlaybooks,
  PlaybookError,
  updatePlaybook,
  type PlaybookInput,
} from "@/lib/playbooks";

export const runtime = "nodejs";

function inputError(error: unknown) {
  if (error instanceof PlaybookError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}

export async function GET() {
  let db;
  try {
    db = openDatabase();
    return Response.json(listPlaybooks(db), { headers: { "Cache-Control": "no-store" } });
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;
    if (payload.confirmed !== true) {
      return Response.json({ error: "Confirm the reviewed draft before saving." }, { status: 400 });
    }
    db = openDatabase(false);
    return Response.json(createPlaybookDraft(db, payload as unknown as PlaybookInput), { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    return inputError(error) || dbError(error);
  } finally {
    db?.close();
  }
}

export async function PATCH(request: Request) {
  let db;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;
    if (payload.confirmed !== true) {
      return Response.json({ error: "Confirm the reviewed change before saving." }, { status: 400 });
    }
    db = openDatabase(false);
    if (payload.action === "activate") {
      return Response.json(activatePlaybook(db, payload.id));
    }
    if (payload.action !== "update") {
      return Response.json({ error: "Choose update or activate." }, { status: 400 });
    }
    return Response.json(updatePlaybook(db, payload as unknown as PlaybookInput));
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    return inputError(error) || dbError(error);
  } finally {
    db?.close();
  }
}
