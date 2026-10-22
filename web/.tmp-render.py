"""Render each candidate template against one real lead and print it.

No sending here. This proves the spintax resolves and that every placeholder
has a value, so we never put "Hi ," in front of a real Managing Director.
"""
import sqlite3
import sys

sys.path.insert(0, r"C:\Users\wbrya\OneDrive\Documents\GitHub\accounting-prospect-research-nextjs")
from spintax_engine import render_email_template, validate_company_name

db = sqlite3.connect(sys.argv[1])
db.row_factory = sqlite3.Row

POOLS = ("hydroball_clones", "jobstreet_hiring_pain")
ph = ",".join("?" * len(POOLS))

lead = db.execute(
    f"""SELECT p.* FROM prospects p JOIN email_preflight e ON e.lead_id=p.lead_id
         WHERE p.campaign_id IN ({ph})
           AND e.mx_status='mx_present' AND e.source_confirmed=1
           AND NOT EXISTS (SELECT 1 FROM campaign_sends s
                            WHERE lower(trim(s.recipient_email))=lower(trim(p.contact_email))
                              AND coalesce(s.response_msg,'') NOT LIKE '%[DRY-RUN%')
         LIMIT 1""",
    POOLS,
).fetchone()

as_dict = dict(lead)
print("lead:", as_dict["company_name"], "->", as_dict["contact_email"])
print("buyer:", as_dict.get("buyer_name"), "|", as_dict.get("buyer_title"))
print("software:", as_dict.get("accounting_software"))
print("name validation:", validate_company_name(as_dict["company_name"]))
print()

for tid in (2, 3, 4):
    t = db.execute("SELECT name, subject, body FROM outbound_templates WHERE template_id=?", (tid,)).fetchone()
    print("=" * 78)
    print(f"TEMPLATE {tid}: {t['name']}")
    try:
        subj = render_email_template(t["subject"], as_dict)
        body = render_email_template(t["body"], as_dict)
        print("SUBJECT:", subj)
        print("-" * 78)
        print(body)
        blob = subj + body
        leftover = [x for x in ("{{", "}}") if x in blob]
        print("-" * 78)
        if leftover:
            print("!! UNFILLED PLACEHOLDER BRACES PRESENT")
        else:
            print(">>> all placeholders filled")
    except Exception as exc:
        print("RENDER ERROR:", type(exc).__name__, exc)
    print()

db.close()