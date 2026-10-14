"""Durable approved messages; uncertain SMTP submissions never auto-retry."""
import json
from datetime import datetime
import campaign_database as db
from campaign_database import connection_scope


def ensure_tables():
    with connection_scope() as connection:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS dispatch_runs (
                run_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                live INTEGER NOT NULL,
                schedule_override INTEGER NOT NULL DEFAULT 0,
                next_send_at REAL NOT NULL DEFAULT 0,
                wait_reason TEXT NOT NULL DEFAULT 'idle',
                settings TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS dispatch_queue (
                run_id TEXT NOT NULL REFERENCES dispatch_runs(run_id),
                lead_id TEXT NOT NULL,
                email TEXT NOT NULL,
                payload TEXT NOT NULL,
                position INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                PRIMARY KEY (run_id, lead_id),
                UNIQUE (run_id, email)
            );
            CREATE INDEX IF NOT EXISTS idx_dispatch_queue_pending ON dispatch_queue(run_id, status, position);
        """)
        columns = {row[1] for row in connection.execute("PRAGMA table_info(dispatch_runs)")}
        if "wait_reason" not in columns:
            connection.execute("ALTER TABLE dispatch_runs ADD COLUMN wait_reason TEXT NOT NULL DEFAULT 'idle'")


def create_run(run_id, leads, settings, *, live):
    emails = [str(lead.get("contact_email") or lead.get("email") or "").strip().lower() for lead in leads]
    ids = [str(lead.get("lead_id") or email) for lead, email in zip(leads, emails)]
    if len(set(emails)) != len(emails) or len(set(ids)) != len(ids):
        raise ValueError("A durable run requires unique recipient addresses and lead IDs")
    ensure_tables()
    with connection_scope() as connection:
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute("SELECT 1 FROM dispatch_runs WHERE status IN ('ACTIVE','PAUSED') LIMIT 1").fetchone():
            raise RuntimeError("A saved dispatch run is still active or paused")
        connection.execute("INSERT INTO dispatch_runs(run_id,status,live,settings) VALUES (?,'ACTIVE',?,?)",
                           (run_id, int(live), json.dumps(settings)))
        connection.executemany("INSERT INTO dispatch_queue(run_id,lead_id,email,payload,position) VALUES (?,?,?,?,?)",
                               [(run_id, lead_id, email, json.dumps(lead), position)
                                for position, (lead, lead_id, email) in enumerate(zip(leads, ids, emails))])


def update_run(run_id, *, status=None, schedule_override=None, next_send_at=None, wait_reason=None):
    if not run_id:
        return
    fields = {"status": status, "schedule_override": schedule_override, "next_send_at": next_send_at, "wait_reason": wait_reason}
    fields = {key: value for key, value in fields.items() if value is not None}
    if not fields:
        return
    with connection_scope() as connection:
        connection.execute(f"UPDATE dispatch_runs SET {', '.join(key + '=?' for key in fields)} WHERE run_id=?",
                           (*fields.values(), run_id))


def set_item_status(run_id, lead_id, status):
    if not run_id:
        return
    with connection_scope() as connection:
        connection.execute("UPDATE dispatch_queue SET status=? WHERE run_id=? AND lead_id=?",
                           (status, run_id, lead_id))


def recover_run(*, include_paused=False):
    ensure_tables()
    with connection_scope() as connection:
        statuses = "('ACTIVE','PAUSED')" if include_paused else "('ACTIVE')"
        run = connection.execute(f"SELECT * FROM dispatch_runs WHERE status IN {statuses} ORDER BY created_at DESC LIMIT 1").fetchone()
        if not run:
            return None
        quota_slot = db.next_mailbox_slot() if run["wait_reason"] in ("daily_quota", "hourly_quota", "provider_cooldown", "mailbox_unavailable") else None
        run_id = run["run_id"]
        connection.execute("""
            UPDATE dispatch_queue SET status='SENT' WHERE run_id=? AND EXISTS (
                SELECT 1 FROM campaign_sends s WHERE s.run_id=dispatch_queue.run_id
                AND s.lead_id=dispatch_queue.lead_id AND s.status='SENT'
                AND (?=0 OR coalesce(s.response_msg,'') NOT LIKE '%[DRY-RUN%')
            )
        """, (run_id, run["live"]))
        connection.execute("UPDATE dispatch_queue SET status='UNCERTAIN' WHERE run_id=? AND status='IN_FLIGHT'", (run_id,))
        leads = [json.loads(row[0]) for row in connection.execute(
            "SELECT payload FROM dispatch_queue WHERE run_id=? AND status='PENDING' ORDER BY position", (run_id,))]
        settings = json.loads(run["settings"])
        next_send_at = run["next_send_at"]
        wait_reason = run["wait_reason"]
        if quota_slot:
            next_send_at = quota_slot["timestamp"]
            wait_reason = quota_slot["reason"]
        last_send = connection.execute("""
            SELECT sender_email,sent_at FROM campaign_sends WHERE run_id=? AND status='SENT'
            AND (?=0 OR coalesce(response_msg,'') NOT LIKE '%[DRY-RUN%') ORDER BY send_id DESC LIMIT 1
        """, (run_id, run["live"])).fetchone()
        if last_send:
            mailbox = connection.execute("SELECT * FROM mailboxes WHERE lower(email)=?", ((last_send["sender_email"] or "").lower(),)).fetchone()
            minimum = max(60, settings.get("min_delay", 60))
            if mailbox:
                from warmup_ramper import enforce_warmup_limits
                minimum = enforce_warmup_limits(dict(mailbox), default_min_delay=minimum,
                                                default_max_delay=settings.get("max_delay", 120))["effective_min_delay_seconds"]
            spacing = datetime.fromisoformat(last_send["sent_at"]).timestamp() + minimum
            if spacing > next_send_at:
                next_send_at, wait_reason = spacing, "spacing"
        return {"run_id": run_id, "status": run["status"], "live": bool(run["live"]), "schedule_override": bool(run["schedule_override"]),
                "next_send_at": next_send_at, "wait_reason": wait_reason, "settings": settings, "leads": leads}


def run_summary(run_id):
    if not run_id:
        return {"run_id": None, "accepted_count": 0, "uncertain_count": 0, "run_total": 0}
    with connection_scope() as connection:
        row = connection.execute("""
            SELECT COUNT(*) run_total,
                SUM(CASE WHEN status='SENT' THEN 1 ELSE 0 END) accepted_count,
                SUM(CASE WHEN status='UNCERTAIN' THEN 1 ELSE 0 END) uncertain_count
            FROM dispatch_queue WHERE run_id=?
        """, (run_id,)).fetchone()
        return {"run_id": run_id, **{key: int(row[key] or 0) for key in ("run_total", "accepted_count", "uncertain_count")}}
