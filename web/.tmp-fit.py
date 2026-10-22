import sqlite3, sys

db = sqlite3.connect(sys.argv[1])
db.row_factory = sqlite3.Row

cols = [r[1] for r in db.execute("PRAGMA table_info(prospects)")]
print("prospects columns:", ", ".join(cols))
print()

POOLS = ("hydroball_clones", "jobstreet_hiring_pain", "mysg_consumer_retail_accounting")
ph = ",".join("?" * len(POOLS))

# Pick whichever of these exist, so this works across schema versions.
def col(names):
    for n in names:
        if n in cols:
            return n
    return None

hiring = col(["is_hiring", "hiring"])
malay = col(["has_malaysia_facility", "malaysia_facility", "hq_malaysia"])
sector = col(["sector", "industry", "company_sector"])

sel = ["p.campaign_id", "COUNT(*) n"]
if hiring:
    sel.append(f"SUM(CASE WHEN coalesce(p.{hiring},0)=1 THEN 1 ELSE 0 END) hiring")
if malay:
    sel.append(f"SUM(CASE WHEN coalesce(p.{malay},0)=1 THEN 1 ELSE 0 END) malaysia_facility")
if sector:
    sel.append(f"SUM(CASE WHEN lower(coalesce(p.{sector},'')) LIKE '%manufactur%' THEN 1 ELSE 0 END) mfg")

print("=== confirmed leads by pool ===")
for r in db.execute(
    f"""SELECT {', '.join(sel)} FROM prospects p
        JOIN email_preflight e ON e.lead_id=p.lead_id
       WHERE p.campaign_id IN ({ph})
         AND e.mx_status='mx_present' AND e.source_confirmed=1
       GROUP BY p.campaign_id""",
    POOLS,
):
    print("  " + "  ".join(f"{k}={r[k]}" for k in r.keys()))

if sector:
    print("\n=== sectors of the confirmed set ===")
    for r in db.execute(
        f"""SELECT coalesce(p.{sector},'(none)') s, COUNT(*) n
              FROM prospects p JOIN email_preflight e ON e.lead_id=p.lead_id
             WHERE p.campaign_id IN ({ph})
               AND e.mx_status='mx_present' AND e.source_confirmed=1
             GROUP BY s ORDER BY n DESC LIMIT 15""",
        POOLS,
    ):
        print(f"  {r['s'][:44]:44} {r['n']}")

print("\n=== a few confirmed leads in full ===")
q = f"""SELECT p.lead_id, p.company_name, p.contact_email
         FROM prospects p JOIN email_preflight e ON e.lead_id=p.lead_id
        WHERE p.campaign_id IN ({ph})
          AND e.mx_status='mx_present' AND e.source_confirmed=1 LIMIT 6"""
for r in db.execute(q, POOLS):
    print(f"  {r['company_name'][:36]:36} {r['contact_email']}")

db.close()