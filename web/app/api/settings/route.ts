import { dbError, openDatabase } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  let db;
  try {
    db = openDatabase();
    const mailboxes = db.prepare("SELECT COUNT(*) AS count FROM mailboxes").get() as { count: number };
    return Response.json({ connected: true, mailboxCount: mailboxes.count });
  } catch (error) {
    return dbError(error);
  } finally {
    db?.close();
  }
}
