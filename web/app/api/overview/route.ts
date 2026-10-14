import { dbError, openDatabase } from "@/lib/db";
import { countLiveSendsToday } from "@/lib/overview";

export const runtime = "nodejs";

export async function GET() {
  let db;
  try {
    db = openDatabase();
    const prospects = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'Ready to Review' THEN 1 ELSE 0 END) AS ready
      FROM prospects
    `).get();
    const campaigns = db.prepare("SELECT COUNT(*) AS total FROM campaigns").get() as { total: number };
    const sentToday = countLiveSendsToday(db);
    return Response.json({ prospects, campaigns, sentToday });
  } catch (error) {
    return dbError(error);
  } finally {
    db?.close();
  }
}
