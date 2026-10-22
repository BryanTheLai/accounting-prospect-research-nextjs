"""Pipeline helper: preflight, approve, room, and ids for the local sender.

Every subcommand writes the eligible id set to ids.json so the caller never has
to re-derive the dispatcher's rules. Keep these gates identical to
dispatcher_sidecar.py or the dispatcher will silently drop recipients.
"""
import json
import os
import sqlite3
import sys

DB = os.environ.get("OUTBOUNDER_DB_PATH") or sys.argv[1]
CMD = sys.argv[2] if len(sys.argv) > 2 else ""
POOLS = ("hydroball_clones", "jobstreet_hiring_pain", "mysg_consumer_retail_accounting")
PH = ",".join("?" * len(POOLS))
RUNDIR = os.path.dirname(DB)
IDS = os.path.join(RUNDIR, "ids.json")

ELIGIBLE = f"""
  FROM prospects p JOIN email_preflight e ON e.lead_id = p.lead_id
 WHERE p.campaign_id IN ({PH})
   AND p.status = 'Approved for Outreach'
   AND trim(coalesce(p.contact_email,'')) <> ''
   AND e.source_confirmed = 1
   AND e.mx_status = 'mx_present'
   AND e.source_confirmed_at IS NOT NULL
   AND julianday('now') - julianday(e.source_confirmed_at) <= 30
   AND NOT EXISTS (SELECT 1 FROM email_suppression x
                    WHERE lower(trim(x.email)) = lower(trim(p.contact_email)))
   AND NOT EXISTS (SELECT 1 FROM campaign_sends s
                    WHERE lower(trim(s.recipient_email)) = lower(trim(p.contact_email))
                      AND coalesce(s.response_msg,'') NOT LIKE '%[DRY-RUN%')
"""


def connect():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    return db


def do_preflight(db):
    """Stage MY/SG leads that have an address but no preflight row, then flag them."""
    now = "2026-10-15T00:00:00+00:00"
    cur = db.execute(
        f"""INSERT INTO email_preflight
              (lead_id, email, mx_status, mx_hosts, checked_at, source_confirmed, source_confirmed_at)
            SELECT p.lead_id, lower(trim(p.contact_email)), 'not_checked', '[]', ?, 0, NULL
              FROM prospects p
             WHERE p.campaign_id IN ({PH})
               AND trim(coalesce(p.contact_email,'')) <> ''
               AND instr(p.contact_email,'@') > 1
               AND p.lead_id NOT IN (SELECT lead_id FROM email_preflight)
            ON CONFLICT(lead_id) DO NOTHING""",
        (now, *POOLS),
    )
    db.commit()
    print(f"staged {cur.rowcount}")
    for r in db.execute(
        f"""SELECT p.campaign_id,
                   SUM(CASE WHEN e.mx_status='mx_present' THEN 1 ELSE 0 END) mx,
                   SUM(CASE WHEN e.source_confirmed=1 THEN 1 ELSE 0 END) conf
              FROM prospects p LEFT JOIN email_preflight e ON e.lead_id=p.lead_id
             WHERE p.campaign_id IN ({PH}) GROUP BY p.campaign_id""",
        POOLS,
    ):
        print(f"  {r['campaign_id']:34} mx={r['mx']} confirmed={r['conf']}")


def do_approve(db):
    """Approve everything that passes the deliverability gates."""
    cur = db.execute(
        f"""UPDATE prospects
               SET status = 'Approved for Outreach',
                   notes = trim(coalesce(notes,'') || char(10) ||
                              'Auto-approved: MX present and address confirmed published on official site.')
             WHERE campaign_id IN ({PH})
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
        POOLS,
    )
    db.commit()
    print(f"approved {cur.rowcount}")


def do_ids(db):
    rows = db.execute(f"SELECT p.lead_id {ELIGIBLE} ORDER BY p.lead_id", POOLS).fetchall()
    ids = [r["lead_id"] for r in rows]
    with open(IDS, "w", encoding="utf-8") as fh:
        json.dump(ids, fh)
    print(f"eligible: {len(ids)}")


def do_room(db, ceiling):
    """How many more may be sent today, and persist that many ids."""
    sent = db.execute(
        "SELECT COUNT(*) c FROM campaign_sends WHERE date(sent_at)=date('now') "
        "AND status='SENT' AND coalesce(response_msg,'') NOT LIKE '%[DRY-RUN%'"
    ).fetchone()["c"]
    room = max(0, int(ceiling) - sent)
    rows = db.execute(f"SELECT p.lead_id {ELIGIBLE} ORDER BY p.lead_id", POOLS).fetchall()
    ids = [r["lead_id"] for r in rows][:room]
    with open(IDS, "w", encoding="utf-8") as fh:
        json.dump(ids, fh)
    print(f"{room} {len(ids)}")


db = connect()
if CMD == "preflight":
    do_preflight(db)
elif CMD == "approve":
    do_approve(db)
elif CMD == "ids":
    do_ids(db)
elif CMD == "room":
    do_room(db, sys.argv[3] if len(sys.argv) > 3 else 100)
else:
    print(__doc__)
db.close()