import { dbError, openDatabase } from "@/lib/db";
import { getOutboundActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let db;
  try {
    // openDatabase() defaults to read-only. This reporting endpoint never mutates
    // campaign history, mailbox state, suppression rows, or the prospect database.
    db = openDatabase();
    return Response.json(getOutboundActivity(db), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return dbError(error);
  } finally {
    db?.close();
  }
}
