"""Approve the verified MY/SG sendable set, then report status distribution.

Mirrors exactly what the dispatcher's own auto-approval does: MX present,
source confirmed within 30 days, not suppressed, not previously sent.
"""
import json
import sqlite3
import sys

DB = sys.argv[1]
IDS_FILE = sys.argv[2]

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

ids = json.load(open(IDS_FILE, encoding="utf-8-sig"))
print("candidate leads:", len(ids))
ph = ",".join("?" * len(ids))

print("\n=== status BEFORE ===")
for r in db.execute(f"SELECT status, COUNT(*) n FROM prospects WHERE lead_id IN ({ph}) GROUP BY status", ids):
    print(f"  {r['status']:36} {r['n']}")

cur = db.execute(
    f"""UPDATE prospects
           SET status = 'Approved for Outreach',
               notes = trim(coalesce(notes,'') || char(10) ||
                          'Approved for MY/SG live run: MX present and address confirmed published on official site.')
         WHERE lead_id IN ({ph})
           AND status <> 'Approved for Outreach'
           AND lead_id IN (SELECT e.lead_id FROM email_preflight e
                            WHERE e.source_confirmed = 1
                              AND e.mx_status = 'mx_present'
                              AND e.source_confirmed_at IS NOT NULL
                              AND julianday('now') - julianday(e.source_confirmed_at) <= 30)
           AND NOT EXISTS (SELECT 1 FROM email_suppression x
                            WHERE lower(trim(x.email)) = lower(trim(prospects.contact_email)))
           AND NOT EXISTS (SELECT 1 FROM campaign_sends s
                            WHERE lower(trim(s.recipient_email)) = lower(trim(prospects.contact_email))
                              AND coalesce(s.response_msg,'') NOT LIKE '%[DRY-RUN%')""",
    ids,
)
db.commit()
print(f"\napproved: {cur.rowcount}")

print("\n=== status AFTER ===")
for r in db.execute(f"SELECT status, COUNT(*) n FROM prospects WHERE lead_id IN ({ph}) GROUP BY status", ids):
    print(f"  {r['status']:36} {r['n']}")

print("\n=== final gate check (what the dispatcher will apply) ===")
q = f"""SELECT COUNT(*) c FROM prospects p JOIN email_preflight e ON e.lead_id=p.lead_id
        WHERE p.lead_id IN ({ph})
          AND p.status='Approved for Outreach'
          AND e.source_confirmed=1 AND e.mx_status='mx_present'
          AND e.source_confirmed_at IS NOT NULL
          AND julianday('now')-julianday(e.source_confirmed_at) <= 30
          AND NOT EXISTS (SELECT 1 FROM email_suppression x
                           WHERE lower(trim(x.email))=lower(trim(p.contact_email)))
          AND NOT EXISTS (SELECT 1 FROM campaign_sends s
                           WHERE lower(trim(s.recipient_email))=lower(trim(p.contact_email))
                             AND coalesce(s.response_msg,'') NOT LIKE '%[DRY-RUN%')"""
print("  fully eligible:", db.execute(q, ids).fetchone()["c"], "of", len(ids))

db.close()