import sqlite3, sys

db = sqlite3.connect(sys.argv[1])
db.row_factory = sqlite3.Row

POOLS = ("hydroball_clones", "jobstreet_hiring_pain", "mysg_consumer_retail_accounting")
ph = ",".join("?" * len(POOLS))

q = f"""
 SELECT p.campaign_id, p.lead_id, p.company_name, p.contact_email, p.sector
   FROM prospects p JOIN email_preflight e ON e.lead_id=p.lead_id
  WHERE p.campaign_id IN ({ph})
    AND e.mx_status='mx_present' AND e.source_confirmed=1
    AND e.source_confirmed_at IS NOT NULL
    AND julianday('now')-julianday(e.source_confirmed_at) <= 30
    AND NOT EXISTS (SELECT 1 FROM email_suppression x
                     WHERE lower(trim(x.email))=lower(trim(p.contact_email)))
    AND NOT EXISTS (SELECT 1 FROM campaign_sends s
                     WHERE lower(trim(s.recipient_email))=lower(trim(p.contact_email))
                       AND coalesce(s.response_msg,'') NOT LIKE '%[DRY-RUN%')
"""

rows = db.execute(q, POOLS).fetchall()
print("TOTAL SENDABLE:", len(rows))
print()
by = {}
for r in rows:
    by.setdefault(r["campaign_id"], []).append(r)
for cid, rs in by.items():
    print(f"  {cid}: {len(rs)}")
    for r in rs[:3]:
        print(f"      {r['company_name'][:34]:34} {r['contact_email']:32} {(r['sector'] or '')[:28]}")
print()
print("=== sector spread of the sendable set ===")
sec = {}
for r in rows:
    k = (r["sector"] or "(none)")[:40]
    sec[k] = sec.get(k, 0) + 1
for k, v in sorted(sec.items(), key=lambda x: -x[1]):
    print(f"  {k:42} {v}")

print()
print("=== already emailed today (should be 0) ===")
print(" ", db.execute(
    "SELECT COUNT(*) FROM campaign_sends WHERE date(sent_at)=date('now') AND status='SENT'"
).fetchone()[0])

db.close()