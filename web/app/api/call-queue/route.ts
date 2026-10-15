import { dbError, openDatabase } from "@/lib/db";
import { CallQueueFilterError, getCallQueue, parseCallQueueFilters } from "@/lib/call-queue.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let db;
  try {
    const filters = parseCallQueueFilters(new URL(request.url).searchParams);
    db = openDatabase();
    return Response.json(getCallQueue(db, filters));
  } catch (error) {
    if (error instanceof CallQueueFilterError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return dbError(error);
  } finally {
    db?.close();
  }
}
