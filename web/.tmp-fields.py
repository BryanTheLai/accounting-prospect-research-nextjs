import sqlite3, sys

db = sqlite3.connect(sys.argv[1])
db.row_factory = sqlite3.Row

POOLS = ("hydroball_clones", "jobstreet_hiring_pain", "mysg_consumer_retail_accounting")
ph = ",".join("?" * len(POOLS))

rows = db.execute(
    f"""
 SELECT p.lead_id, p.company_name, p.contact_email, p.buyer_name, p.buyer_title,
        p.accounting_software, p.root_domain, p.sg_my_wedge
   FROM prospects p JOIN email_preflight e ON e.lead_id=p.lead_id
  WHERE p.campaign_id IN ({ph})
    AND e.mx_status='mx_present' AND e.source_confirmed=1
    AND NOT EXISTS (SELECT 1 FROM campaign_sends s
                     WHERE lower(trim(s.recipient_email))=lower(trim(p.contact_email))
                       AND coalesce(s.response_msg,'') NOT LIKE '%[DRY-RUN%')
  ORDER BY p.campaign_id, p.lead_id""",
    POOLS,
).fetchall()

print("sendable:", len(rows))
print()

# Every template renders {{buyer_name}}. If that is blank the email reads "Hi ,".
blank_buyer = [r for r in rows if not (r["buyer_name"] or "").strip()]
blank_sw = [r for r in rows if not (r["accounting_software"] or "").strip()]

print(f"buyer_name MISSING: {len(blank_buyer)} of {len(rows)}")
print(f"accounting_software MISSING: {len(blank_sw)} of {len(rows)}")
print()
print("=== sample rows ===")
for r in rows[:12]:
    bn = (r["buyer_name"] or "(blank)")[:26]
    bt = (r["buyer_title"] or "(blank)")[:20]
    sw = (r["accounting_software"] or "(blank)")[:16]
    print(f"  {r['company_name'][:30]:30} buyer={bn:26} title={bt:20} sw={sw}")

db.close()