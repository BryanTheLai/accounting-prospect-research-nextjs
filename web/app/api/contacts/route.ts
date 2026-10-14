import { dbError, openDatabase } from "@/lib/db";
import { ContactInputError, parseContactUpdate, updateProspectContact } from "@/lib/contacts";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request." }, { status: 400 });
  }

  let input;
  try {
    input = parseContactUpdate(parsed);
  } catch (error) {
    return Response.json({ error: error instanceof ContactInputError ? error.message : "Invalid contact update." }, { status: 400 });
  }

  let db;
  try {
    db = openDatabase(false);
    const result = updateProspectContact(db, input);
    if (!result) return Response.json({ error: "Prospect not found." }, { status: 404 });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return dbError(error);
  } finally {
    db?.close();
  }
}
