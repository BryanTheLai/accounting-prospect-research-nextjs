import type Database from "better-sqlite3";

/** Counts real SENT outcomes for the local calendar day, excluding simulations. */
export function countLiveSendsToday(db: Database.Database): number {
  const result = db.prepare(`
    SELECT COUNT(*) AS total FROM campaign_sends
    WHERE date(sent_at) = date('now', 'localtime')
      AND status = 'SENT'
      AND COALESCE(response_msg, '') NOT LIKE '%[DRY-RUN%'
  `).get() as { total: number };
  return result.total;
}
