"""
Persistent SQLite Logging Layer with WAL Configuration, Multi-Mailbox Pool & Template Management
Path: campaign_database.py
"""
import sqlite3
import time
import random
from contextlib import contextmanager

import re
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any, Set, Tuple
from config import DB_PATH


EMAIL_PREFLIGHT_MAX_AGE = timedelta(days=30)

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10.0)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def connection_scope():
    connection = get_db_connection()
    try:
        with connection:
            yield connection
    finally:
        connection.close()

def init_campaign_tables() -> None:
    """Ensures campaign send history, mailboxes, templates, and suppression tables exist."""
    with connection_scope() as conn:
        # 1. Mailbox Pool
        conn.execute("""
        CREATE TABLE IF NOT EXISTS mailboxes (
            mailbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            sender_name TEXT NOT NULL DEFAULT 'Bryan @ Outbounder',
            smtp_server TEXT NOT NULL DEFAULT 'smtp.office365.com',
            smtp_port INTEGER NOT NULL DEFAULT 587,
            smtp_user TEXT NOT NULL,
            smtp_password TEXT NOT NULL,
            daily_limit INTEGER NOT NULL DEFAULT 50,
            hourly_limit INTEGER NOT NULL DEFAULT 10,
            manual_limits INTEGER NOT NULL DEFAULT 1,
            min_delay_seconds INTEGER,
            max_delay_seconds INTEGER,
            status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'COOLDOWN', 'PAUSED', 'ERROR')),
            provider_type TEXT NOT NULL DEFAULT 'MICROSOFT' CHECK(provider_type IN ('MICROSOFT', 'GOOGLE', 'ANY', 'OTHER')),
            cooldown_until TIMESTAMP,
            last_sent_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)
        if "manual_limits" not in {row[1] for row in conn.execute("PRAGMA table_info(mailboxes)")}:
            conn.execute("ALTER TABLE mailboxes ADD COLUMN manual_limits INTEGER NOT NULL DEFAULT 1")

        # 1b. Manual quota-window resets.
        # The operator can start a fresh daily quota window without editing the saved
        # limit. This stores only the window start; it never deletes or edits send
        # history, so lifetime counts, deliverability stats and the audit trail stay
        # truthful. The rolling hourly limit is deliberately NOT resettable because it
        # is derived from real send timestamps and is the actual anti-spam guard.
        conn.execute("""
        CREATE TABLE IF NOT EXISTS mailbox_quota_resets (
            mailbox_id INTEGER PRIMARY KEY,
            reset_at TEXT NOT NULL,
            reset_by TEXT,
            note TEXT
        );
        """)

        # Ensure provider_type column exists if migrating existing table
        try:
            conn.execute("ALTER TABLE mailboxes ADD COLUMN provider_type TEXT DEFAULT 'MICROSOFT';")
        except sqlite3.OperationalError:
            pass  # Already exists

        # 2. Campaign Sends Log
        conn.execute("""
        CREATE TABLE IF NOT EXISTS campaign_sends (
            send_id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id TEXT NOT NULL,
            recipient_email TEXT NOT NULL,
            company_name TEXT,
            subject TEXT NOT NULL,
            body TEXT,
            sender_email TEXT,
            status TEXT NOT NULL, -- 'SENT', 'DEFERRED', 'FAILED', 'BOUNCED', 'SUPPRESSED'
            smtp_code INTEGER,
            response_msg TEXT,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            duration_delay_sec REAL
        );
        """)

        # Ensure sender_email column exists if migrating existing table
        try:
            conn.execute("ALTER TABLE campaign_sends ADD COLUMN sender_email TEXT;")
        except sqlite3.OperationalError:
            pass  # Already exists

        # Variant attribution is additive so existing local send history remains intact.
        for column, definition in (
            ("run_id", "TEXT"),
            ("variant_name", "TEXT"),
            ("template_id", "INTEGER"),
        ):
            try:
                conn.execute(f"ALTER TABLE campaign_sends ADD COLUMN {column} {definition};")
            except sqlite3.OperationalError:
                pass  # Already exists

        # Persist the selected template per campaign/prospect/template pair so a
        # retry after a dispatcher restart does not silently move that prospect.
        conn.execute("""
        CREATE TABLE IF NOT EXISTS campaign_ab_assignments (
            campaign_id TEXT NOT NULL,
            lead_id TEXT NOT NULL,
            template_pair_key TEXT NOT NULL,
            assigned_template_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (campaign_id, lead_id, template_pair_key)
        );
        """)

        # Per-mailbox pacing overrides are nullable so existing Streamlit global
        # jitter settings continue to apply until an operator saves a mailbox override.
        for column, definition in (
            ("min_delay_seconds", "INTEGER"),
            ("max_delay_seconds", "INTEGER"),
        ):
            try:
                conn.execute(f"ALTER TABLE mailboxes ADD COLUMN {column} {definition};")
            except sqlite3.OperationalError:
                pass  # Already exists

        # 3. Suppression List
        conn.execute("""
        CREATE TABLE IF NOT EXISTS email_suppression (
            email TEXT PRIMARY KEY,
            reason TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # 4. Outbound Templates
        conn.execute("""
        CREATE TABLE IF NOT EXISTS outbound_templates (
            template_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            subject TEXT NOT NULL,
            body TEXT NOT NULL,
            is_default INTEGER DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # YC A/B campaign templates. INSERT OR IGNORE preserves any edits made in Template Studio.
        conn.executemany("""
        INSERT OR IGNORE INTO outbound_templates (name, subject, body, is_default)
        VALUES (?, ?, ?, 0)
        """, [
            (
                "YC A/B — Commercial Burn Cut",
                "bookkeeping for {{company_name}}",
                "Hey {{buyer_name}},\n\nMost YC founders are paying Pilot or traditional accounting firms $1,500 to $2,500/mo for slow closes and junior account managers who turn over every 90 days.\n\nWe run an AI-native accounting firm built specifically for early-stage venture startups:\n- Books closed in 48 hours every month (Stripe, Mercury, Brex, Gusto auto-synced)\n- Flat $800/mo (no revenue tax or transaction markups)\n- Form 1120 tax extensions, 83(b), and Delaware franchise filings handled\n\nWould you be open to a 30 minute call so we can help you focus on building your product instead of worrying about accounting?\n\nBest,\nBryan Lai\nOutbounder",
            ),
            (
                "YC A/B — Conversational Builder",
                "{{company_name}}'s stripe / ledger",
                "Hey {{buyer_name}},\n\nAre you managing your own monthly books and Stripe reconciliation in-house right now, or did you outsource it to a firm?\n\nThis is not a sales pitch, we're building an AI-native accounting firm, and would love it if we could hop on a 30-minute call to help you eliminate your accounting headaches so you can focus on your product.\n\nLet me know if this interests you!\n\nBest,\nBryan Lai\nOutbounder",
            ),
        ])

        # 5. Pluggable Campaign Archetypes
        conn.execute("""
        CREATE TABLE IF NOT EXISTS campaigns (
            campaign_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            tagline TEXT,
            description TEXT,
            target_criteria TEXT,
            sourcing_strategy TEXT,
            agent_prompt_spec TEXT,
            offer_wedge TEXT,
            default_template_name TEXT,
            schedule_timezone TEXT NOT NULL DEFAULT 'Asia/Singapore',
            schedule_start_minute INTEGER NOT NULL DEFAULT 540,
            schedule_end_minute INTEGER NOT NULL DEFAULT 1050,
            schedule_configured INTEGER NOT NULL DEFAULT 0,
            status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'PAUSED', 'ARCHIVED')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        for column, definition in (
            ("schedule_timezone", "TEXT NOT NULL DEFAULT 'Asia/Singapore'"),
            ("schedule_start_minute", "INTEGER NOT NULL DEFAULT 540"),
            ("schedule_end_minute", "INTEGER NOT NULL DEFAULT 1050"),
            ("schedule_configured", "INTEGER NOT NULL DEFAULT 0"),
        ):
            try:
                conn.execute(f"ALTER TABLE campaigns ADD COLUMN {column} {definition};")
            except sqlite3.OperationalError:
                pass  # Already exists

        # Ensure canonical prospects columns exist if table was initialized with a minimal schema
        for col, col_def in (
            ("company_summary", "TEXT"),
            ("buyer_name", "TEXT"),
            ("buyer_title", "TEXT"),
            ("contact_phone", "TEXT"),
            ("sg_my_wedge", "TEXT"),
            ("quality_score", "INTEGER"),
            ("tier", "TEXT"),
            ("notes", "TEXT"),
            ("bro_summary", "TEXT"),
            ("proof_link", "TEXT"),
            ("phone_script", "TEXT"),
            ("headquarters", "TEXT"),
            ("malaysia_facility", "TEXT"),
            ("sector", "TEXT"),
            ("estimated_transactions_mo", "TEXT"),
            ("accounting_software", "TEXT"),
            ("campaign_id", "TEXT DEFAULT 'hydroball_clones'"),
        ):
            try:
                conn.execute(f"ALTER TABLE prospects ADD COLUMN {col} {col_def};")
            except sqlite3.OperationalError:
                pass

        # Indices for high-velocity queries
        conn.execute("CREATE INDEX IF NOT EXISTS idx_campaign_sends_email ON campaign_sends(recipient_email);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_campaign_sends_date ON campaign_sends(sent_at);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_campaign_sends_sender ON campaign_sends(sender_email, sent_at);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_campaign_sends_run_variant ON campaign_sends(run_id, variant_name);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_campaign_ab_assignments_pair ON campaign_ab_assignments(campaign_id, template_pair_key, lead_id);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_mailboxes_status ON mailboxes(status);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);")
        conn.commit()


def get_or_create_campaign_ab_assignments(
    leads: List[Dict[str, Any]],
    variants: List[Dict[str, Any]],
) -> Dict[Tuple[str, str], int]:
    """Return durable template assignments, balancing only newly seen prospects."""
    if len(variants) != 2:
        raise ValueError("A/B assignment requires exactly two variants")
    template_ids = [int(variant["template_id"]) for variant in variants]
    if template_ids[0] == template_ids[1]:
        raise ValueError("A/B assignment requires two different template IDs")
    pair_key = ":".join(str(template_id) for template_id in sorted(template_ids))

    lead_keys: List[Tuple[str, str]] = []
    seen_keys: Set[Tuple[str, str]] = set()
    for lead in leads:
        campaign_id = str(lead.get("campaign_id") or "__uncategorized__").strip() or "__uncategorized__"
        lead_id = str(lead.get("lead_id") or lead.get("contact_email") or lead.get("email") or "").strip()
        if not lead_id:
            raise ValueError("Every A/B prospect needs a stable lead ID or email")
        key = (campaign_id, lead_id)
        if key not in seen_keys:
            seen_keys.add(key)
            lead_keys.append(key)

    if not lead_keys:
        return {}

    init_campaign_tables()
    assignments: Dict[Tuple[str, str], int] = {}
    with connection_scope() as conn:
        # Serialize read/assign/write so concurrent starts cannot create conflicting
        # assignments for the same campaign, prospect, and unordered template pair.
        conn.execute("BEGIN IMMEDIATE")
        campaign_leads: Dict[str, List[str]] = {}
        for campaign_id, lead_id in lead_keys:
            campaign_leads.setdefault(campaign_id, []).append(lead_id)

        for campaign_id, lead_ids in campaign_leads.items():
            for offset in range(0, len(lead_ids), 500):
                chunk = lead_ids[offset:offset + 500]
                placeholders = ",".join("?" for _ in chunk)
                rows = conn.execute(
                    f"""SELECT lead_id, assigned_template_id
                        FROM campaign_ab_assignments
                        WHERE campaign_id = ? AND template_pair_key = ?
                          AND lead_id IN ({placeholders})""",
                    (campaign_id, pair_key, *chunk),
                ).fetchall()
                for row in rows:
                    assigned_template_id = int(row["assigned_template_id"])
                    if assigned_template_id not in template_ids:
                        raise ValueError("A saved A/B assignment does not match its template pair")
                    assignments[(campaign_id, str(row["lead_id"]))] = assigned_template_id

        new_keys = [key for key in lead_keys if key not in assignments]
        new_variants = [variants[0]] * (len(new_keys) // 2) + [variants[1]] * (len(new_keys) // 2)
        if len(new_keys) % 2:
            new_variants.append(random.choice(variants))
        random.shuffle(new_variants)
        random.shuffle(new_keys)

        conn.executemany(
            """INSERT OR IGNORE INTO campaign_ab_assignments
               (campaign_id, lead_id, template_pair_key, assigned_template_id)
               VALUES (?, ?, ?, ?)""",
            [
                (campaign_id, lead_id, pair_key, int(variant["template_id"]))
                for (campaign_id, lead_id), variant in zip(new_keys, new_variants)
            ],
        )
        for key, variant in zip(new_keys, new_variants):
            assignments[key] = int(variant["template_id"])
        conn.commit()
    return assignments


# ==============================================================================
# MULTI-MAILBOX POOL MANAGEMENT
# ==============================================================================

def upsert_mailbox(
    email: str,
    smtp_user: str,
    smtp_password: str,
    sender_name: str = "Bryan @ Outbounder",
    smtp_server: str = "smtp.office365.com",
    smtp_port: int = 587,
    daily_limit: int = 50,
    hourly_limit: int = 10,
    manual_limits: bool = True,
    status: str = "ACTIVE",
    provider_type: Optional[str] = None
) -> int:
    """Inserts or updates a sending mailbox in the pool."""
    init_campaign_tables()
    
    # Auto-infer provider if not provided
    if not provider_type:
        s_lower = smtp_server.lower()
        if "gmail" in s_lower or "google" in s_lower:
            provider_type = "GOOGLE"
        elif "office365" in s_lower or "outlook" in s_lower:
            provider_type = "MICROSOFT"
        else:
            provider_type = "MICROSOFT"

    with connection_scope() as conn:
        cur = conn.cursor()
        cur.execute("""
        INSERT INTO mailboxes 
        (email, smtp_user, smtp_password, sender_name, smtp_server, smtp_port, daily_limit, hourly_limit, manual_limits, status, provider_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
            smtp_user = excluded.smtp_user,
            smtp_password = excluded.smtp_password,
            sender_name = excluded.sender_name,
            smtp_server = excluded.smtp_server,
            smtp_port = excluded.smtp_port,
            daily_limit = excluded.daily_limit,
            hourly_limit = excluded.hourly_limit,
            manual_limits = excluded.manual_limits,
            status = excluded.status,
            provider_type = excluded.provider_type
        """, (email.strip().lower(), smtp_user.strip(), smtp_password.strip(), sender_name.strip(),
              smtp_server.strip(), smtp_port, daily_limit, hourly_limit, int(manual_limits), status, provider_type.strip().upper()))
        conn.commit()
        return cur.lastrowid

def get_all_mailboxes() -> List[Dict[str, Any]]:
    """Returns all configured mailboxes with their live quota metrics."""
    init_campaign_tables()
    with connection_scope() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM mailboxes ORDER BY mailbox_id ASC")
        rows = [dict(r) for r in cur.fetchall()]
        metrics = {row["sender"]: row for row in conn.execute("""
            SELECT lower(sender_email) sender,
                SUM(CASE WHEN date(sent_at)=date('now','localtime') THEN 1 ELSE 0 END) sends_today,
                SUM(CASE WHEN sent_at>=datetime('now','localtime','-1 hour') THEN 1 ELSE 0 END) sends_this_hour
            FROM campaign_sends WHERE status='SENT' AND response_msg NOT LIKE '%[DRY-RUN%'
            GROUP BY lower(sender_email)
        """)}
    for mb in rows:
        counts = metrics.get(mb["email"].strip().lower(), {})
        mb["sends_today"] = counts["sends_today"] if counts else 0
        mb["sends_this_hour"] = counts["sends_this_hour"] if counts else 0
    return rows

def delete_mailbox(mailbox_id: int) -> None:
    init_campaign_tables()
    with connection_scope() as conn:
        conn.execute("DELETE FROM mailboxes WHERE mailbox_id = ?", (mailbox_id,))
        conn.commit()

def update_mailbox_pacing_settings(
    mailbox_id: int,
    daily_limit: int,
    hourly_limit: int,
    min_delay_seconds: Optional[int],
    max_delay_seconds: Optional[int],
    manual_limits: bool = True,
) -> None:
    """Update only quota/pacing fields; never read or modify SMTP credentials."""
    from mailbox_pacing import validate_pacing_update

    request = {
        "mailboxId": mailbox_id,
        "dailyLimit": daily_limit,
        "hourlyLimit": hourly_limit,
        "confirmed": True,
        "manualLimits": manual_limits,
    }
    if min_delay_seconds is None and max_delay_seconds is None:
        request["inheritDelay"] = True
    else:
        request["minDelaySeconds"] = min_delay_seconds
        request["maxDelaySeconds"] = max_delay_seconds
    settings = validate_pacing_update(request)
    init_campaign_tables()
    with connection_scope() as conn:
        cursor = conn.execute(
            """UPDATE mailboxes
               SET daily_limit = ?, hourly_limit = ?,
                    min_delay_seconds = ?, max_delay_seconds = ?, manual_limits = ?
               WHERE mailbox_id = ?""",
            (settings["daily_limit"], settings["hourly_limit"], settings["min_delay_seconds"], settings["max_delay_seconds"], int(settings["manual_limits"]), settings["mailbox_id"]),
        )
        if cursor.rowcount != 1:
            raise ValueError("Mailbox not found")
        conn.commit()

def get_quota_window_start(email: str) -> Optional[str]:
    """Return the start of the active daily quota window for a mailbox.

    Defaults to local midnight. A manual reset moves the window forward so the operator
    can use the full daily allowance again without changing the saved daily limit.
    Sends before the window still exist in history and still count toward lifetime
    totals, bounces and deliverability; they simply stop consuming today's quota.
    """
    init_campaign_tables()
    with connection_scope() as conn:
        row = conn.execute("""
        SELECT q.reset_at FROM mailbox_quota_resets q
        JOIN mailboxes m ON m.mailbox_id = q.mailbox_id
        WHERE lower(m.email) = ?
        """, (email.strip().lower(),)).fetchone()
    reset_at = row[0] if row else None
    if not reset_at:
        return None
    try:
        if datetime.fromisoformat(reset_at) >= datetime.now().replace(hour=0, minute=0, second=0, microsecond=0):
            return reset_at
    except ValueError:
        return None
    return None


def reset_mailbox_quota(email: str, reset_by: str = "operator", note: str = "") -> Dict[str, Any]:
    """Start a new daily quota window for one mailbox.

    Does not delete, edit or mark any send. Only the quota window start moves, so the
    action is reversible by resetting again and leaves an audit row behind.
    """
    init_campaign_tables()
    with connection_scope() as conn:
        row = conn.execute("SELECT mailbox_id FROM mailboxes WHERE lower(email) = ?", (email.strip().lower(),)).fetchone()
        if not row:
            raise ValueError(f"Mailbox not found: {email}")
        mailbox_id = row[0]
        before = conn.execute("""
        SELECT COUNT(*) FROM campaign_sends
        WHERE status = 'SENT' AND lower(sender_email) = ?
          AND date(sent_at) = date('now', 'localtime')
        """, (email.strip().lower(),)).fetchone()[0]
        reset_at = datetime.now().replace(microsecond=0).isoformat(sep=" ")
        conn.execute("""
        INSERT INTO mailbox_quota_resets (mailbox_id, reset_at, reset_by, note)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(mailbox_id) DO UPDATE SET
          reset_at = excluded.reset_at, reset_by = excluded.reset_by, note = excluded.note
        """, (mailbox_id, reset_at, reset_by, note or "manual reset from sender controls"))
    return {"email": email.strip().lower(), "reset_at": reset_at, "sends_before_reset_today": before, "sends_today_after_reset": 0}


def get_mailbox_metrics(email: str) -> Dict[str, int]:
    """Calculates quota-window usage and rolling-hour usage for a mailbox (excluding dry-run).

    ``sends_today`` counts from the active quota window so the daily limit reflects an
    operator reset. ``sends_since_midnight`` always counts from local midnight and is the
    truthful number for reporting; the two differ only after a manual reset.
    """
    init_campaign_tables()
    with connection_scope() as conn:
        cur = conn.cursor()
        window_start = get_quota_window_start(email)
        if window_start:
            cur.execute("""
            SELECT COUNT(*) FROM campaign_sends 
            WHERE status = 'SENT' 
              AND response_msg NOT LIKE '%[DRY-RUN%'
              AND lower(sender_email) = ? 
              AND sent_at >= ?
            """, (email.strip().lower(), window_start))
            sends_today = cur.fetchone()[0]
        else:
            cur.execute("""
            SELECT COUNT(*) FROM campaign_sends 
            WHERE status = 'SENT' 
              AND response_msg NOT LIKE '%[DRY-RUN%'
              AND lower(sender_email) = ? 
              AND date(sent_at) = date('now', 'localtime')
            """, (email.strip().lower(),))
            sends_today = cur.fetchone()[0]

        cur.execute("""
        SELECT COUNT(*) FROM campaign_sends 
        WHERE status = 'SENT' 
          AND response_msg NOT LIKE '%[DRY-RUN%'
          AND lower(sender_email) = ? 
          AND date(sent_at) = date('now', 'localtime')
        """, (email.strip().lower(),))
        sends_since_midnight = cur.fetchone()[0]

        cur.execute("""
        SELECT COUNT(*) FROM campaign_sends 
        WHERE status = 'SENT' 
          AND response_msg NOT LIKE '%[DRY-RUN%'
          AND lower(sender_email) = ? 
          AND sent_at >= datetime('now', 'localtime', '-1 hour')
        """, (email.strip().lower(),))
        sends_hour = cur.fetchone()[0]

        return {"sends_today": sends_today, "sends_this_hour": sends_hour, "sends_since_midnight": sends_since_midnight, "quota_window_start": window_start}

def get_available_mailbox(exclude_ids: Optional[List[int]] = None, preferred_provider: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Selects the next available mailbox using Least-Recently-Used (LRU) rotation
    that satisfies both daily and rolling hourly quotas.
    If preferred_provider is specified (e.g. 'GOOGLE', 'MICROSOFT'), candidates matching
    that provider are evaluated first, falling back to other providers if quota exhausted.
    Auto-recovers mailboxes whose cooldown period has expired.
    """
    init_campaign_tables()
    exclude_ids = exclude_ids or []
    
    with connection_scope() as conn:
        # First, auto-recover expired cooldowns
        conn.execute("""
        UPDATE mailboxes 
        SET status = 'ACTIVE', cooldown_until = NULL 
        WHERE status = 'COOLDOWN' 
          AND cooldown_until <= datetime('now', 'localtime')
        """)
        conn.commit()

        # Query all active mailboxes not in exclusion list
        placeholders = f"AND mailbox_id NOT IN ({','.join(['?']*len(exclude_ids))})" if exclude_ids else ""
        query = f"""
        SELECT * FROM mailboxes 
        WHERE status = 'ACTIVE' {placeholders}
        ORDER BY last_sent_at ASC NULLS FIRST
        """
        cur = conn.cursor()
        cur.execute(query, tuple(exclude_ids))
        candidates = [dict(r) for r in cur.fetchall()]

    if preferred_provider and candidates:
        pref = preferred_provider.strip().upper()
        # Stable sort prioritizing matching provider_type (0 = match, 1 = non-match)
        candidates.sort(key=lambda mb: (0 if (mb.get("provider_type") or "MICROSOFT").upper() == pref else 1))

    for mb in candidates:
        try:
            from warmup_ramper import enforce_warmup_limits
            mb = enforce_warmup_limits(mb)
        except Exception:
            pass
        metrics = get_mailbox_metrics(mb["email"])
        if metrics["sends_today"] < mb["daily_limit"] and metrics["sends_this_hour"] < mb["hourly_limit"]:
            mb["sends_today"] = metrics["sends_today"]
            mb["sends_this_hour"] = metrics["sends_this_hour"]
            return mb
            
    return None

def record_mailbox_success(mailbox_id: int) -> None:
    """Updates last_sent_at timestamp and resets cooldown."""
    with connection_scope() as conn:
        conn.execute("""
        UPDATE mailboxes 
        SET last_sent_at = datetime('now', 'localtime'),
            status = 'ACTIVE',
            cooldown_until = NULL
        WHERE mailbox_id = ?
        """, (mailbox_id,))
        conn.commit()


def next_mailbox_slot() -> Dict[str, Any]:
    from warmup_ramper import enforce_warmup_limits

    now = datetime.now()
    midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=1, microsecond=0)
    slots = []
    for mailbox in get_all_mailboxes():
        if mailbox["status"] not in ("ACTIVE", "COOLDOWN"):
            continue
        limits = enforce_warmup_limits(mailbox)
        opening, reason = now, "mailbox_unavailable"
        if mailbox.get("cooldown_until") and mailbox["status"] == "COOLDOWN":
            opening = max(opening, datetime.fromisoformat(mailbox["cooldown_until"]))
            reason = "provider_cooldown"
        if mailbox["sends_today"] >= limits["daily_limit"]:
            opening, reason = max(opening, midnight), "daily_quota"
        if mailbox["sends_this_hour"] >= limits["hourly_limit"]:
            with connection_scope() as connection:
                row = connection.execute("""
                    SELECT sent_at FROM campaign_sends WHERE status='SENT'
                    AND coalesce(response_msg,'') NOT LIKE '%[DRY-RUN%'
                    AND lower(sender_email)=? AND sent_at>=datetime('now','localtime','-1 hour')
                    ORDER BY sent_at DESC LIMIT 1 OFFSET ?
                """, (mailbox["email"].strip().lower(), limits["hourly_limit"] - 1)).fetchone()
            if row:
                hourly_opening = datetime.fromisoformat(row[0]) + timedelta(hours=1, seconds=1)
                if hourly_opening > opening:
                    opening, reason = hourly_opening, "hourly_quota"
        slots.append({"timestamp": max(now.timestamp() + 1, opening.timestamp()), "reason": reason})
    if not slots:
        return {"timestamp": now.timestamp() + 60, "reason": "mailbox_unavailable"}
    return min(slots, key=lambda slot: slot["timestamp"])

def record_mailbox_cooldown(mailbox_id: int, duration_minutes: int = 15, error_code: Optional[int] = None, error_msg: str = "") -> None:
    """Places a mailbox into temporary cooldown (e.g. on 421/451 deferral)."""
    with connection_scope() as conn:
        conn.execute(f"""
        UPDATE mailboxes 
        SET status = 'COOLDOWN',
            cooldown_until = datetime('now', 'localtime', '+{duration_minutes} minutes')
        WHERE mailbox_id = ?
        """, (mailbox_id,))
        conn.commit()

def record_mailbox_error(mailbox_id: int, error_code: Optional[int] = None, error_msg: str = "") -> None:
    """Deactivates a mailbox on hard authentication failure (e.g. 535)."""
    with connection_scope() as conn:
        conn.execute("""
        UPDATE mailboxes 
        SET status = 'ERROR'
        WHERE mailbox_id = ?
        """, (mailbox_id,))
        conn.commit()

# ==============================================================================
# LOGGING & TRACKING
# ==============================================================================

def log_send_event(
    lead_id: str,
    recipient_email: str,
    company_name: str,
    subject: str,
    status: str,
    smtp_code: Optional[int] = None,
    response_msg: str = "",
    delay_sec: float = 0.0,
    body: str = "",
    sender_email: Optional[str] = None,
    run_id: Optional[str] = None,
    variant_name: Optional[str] = None,
    template_id: Optional[int] = None,
) -> None:
    init_campaign_tables()
    with connection_scope() as conn:
        conn.execute("""
        INSERT INTO campaign_sends 
        (lead_id, recipient_email, company_name, subject, body, sender_email, status, smtp_code, response_msg, sent_at, duration_delay_sec, run_id, variant_name, template_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?, ?, ?, ?)
        """, (lead_id, recipient_email, company_name, subject, body, sender_email, status, smtp_code, response_msg, delay_sec, run_id, variant_name, template_id))
        
        if status == "BOUNCED":
            conn.execute("""
            INSERT OR IGNORE INTO email_suppression (email, reason) 
            VALUES (?, ?)
            """, (recipient_email.strip().lower(), f"Hard Bounce (SMTP {smtp_code}): {response_msg[:100]}"))

        conn.commit()

COMMON_FREEMAIL_DOMAINS: Set[str] = {
    "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "live.com", "msn.com"
}

def get_sends_today_count() -> int:
    """Returns total successful sends for the current calendar date across all mailboxes (excluding dry-run simulations)."""
    init_campaign_tables()
    with connection_scope() as conn:
        cur = conn.cursor()
        cur.execute("""
        SELECT COUNT(*) FROM campaign_sends 
        WHERE status = 'SENT' 
          AND response_msg NOT LIKE '%[DRY-RUN%'
          AND date(sent_at) = date('now', 'localtime')
        """)
        return cur.fetchone()[0]

def get_sends_last_hour_count() -> int:
    """Returns total successful sends in the rolling last 60 minutes across all mailboxes (excluding dry-run simulations)."""
    init_campaign_tables()
    with connection_scope() as conn:
        cur = conn.cursor()
        cur.execute("""
        SELECT COUNT(*) FROM campaign_sends 
        WHERE status = 'SENT' 
          AND response_msg NOT LIKE '%[DRY-RUN%'
          AND sent_at >= datetime('now', 'localtime', '-1 hour')
        """)
        return cur.fetchone()[0]

def is_domain_in_cooldown(domain: str, cooldown_hours: int = 48) -> bool:
    """Checks if ANY email has already been sent to this company domain within cooldown_hours. Freemail domains are exempted."""
    if not domain or "@" in domain or len(domain) < 3:
        return False
    d_clean = domain.strip().lower()
    # Shared public freemail providers represent distinct individual users, not a single corporate domain
    if d_clean in COMMON_FREEMAIL_DOMAINS:
        return False
    init_campaign_tables()
    with connection_scope() as conn:
        cur = conn.cursor()
        cur.execute(f"""
        SELECT COUNT(*) FROM campaign_sends 
        WHERE status = 'SENT' 
          AND response_msg NOT LIKE '%[DRY-RUN%'
          AND lower(recipient_email) LIKE ? 
          AND sent_at >= datetime('now', 'localtime', '-{cooldown_hours} hours')
        """, (f"%@{d_clean}",))
        return cur.fetchone()[0] > 0

def get_suppressed_emails() -> Set[str]:
    init_campaign_tables()
    with connection_scope() as conn:
        cur = conn.cursor()
        cur.execute("SELECT lower(email) FROM email_suppression")
        return {row[0].strip().lower() for row in cur.fetchall() if row[0]}

def suppress_email(email: str, reason: str = "Manual Suppression") -> None:
    """Atomically adds an email to the permanent suppression table."""
    if not email or "@" not in email:
        return
    init_campaign_tables()
    with connection_scope() as conn:
        conn.execute("""
        INSERT OR IGNORE INTO email_suppression (email, reason) 
        VALUES (?, ?)
        """, (email.strip().lower(), reason[:150]))
        conn.commit()

def get_sent_email_set() -> Set[str]:
    """Exclude accepted, suppressed and unresolved live recipients from fresh runs."""
    init_campaign_tables()
    with connection_scope() as conn:
        cur = conn.cursor()
        # Only true live SENT events count as dispatched; DRY-RUN events do not burn the lead
        cur.execute("""
        SELECT DISTINCT lower(recipient_email) 
        FROM campaign_sends 
        WHERE status = 'SENT' 
          AND response_msg NOT LIKE '%[DRY-RUN%'
        """)
        sent = {row[0].strip().lower() for row in cur.fetchall() if row[0]}
        sent.update(get_suppressed_emails())
        sent.update(_unresolved_live_emails(conn))
        return sent


def _unresolved_live_emails(conn) -> Set[str]:
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE name IN ('dispatch_queue','dispatch_runs')")}
    if len(tables) != 2:
        return set()
    return {row[0] for row in conn.execute("""
        SELECT DISTINCT lower(trim(q.email)) FROM dispatch_queue q
        JOIN dispatch_runs r ON r.run_id=q.run_id
        WHERE r.live=1 AND q.status IN ('IN_FLIGHT','UNCERTAIN')
    """)}

def get_email_preflight_map() -> Dict[str, Dict[str, Any]]:
    """Return stored email evidence keyed by lead ID; missing tables fail closed."""
    init_campaign_tables()
    with connection_scope() as conn:
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'email_preflight'"
        ).fetchone()
        if not exists:
            return {}
        rows = conn.execute(
            "SELECT lead_id, email, mx_status, source_confirmed, checked_at, source_confirmed_at FROM email_preflight"
        ).fetchall()
        return {str(row["lead_id"]): dict(row) for row in rows}


def is_email_preflight_fresh(evidence: Dict[str, Any], now: Optional[datetime] = None) -> bool:
    """Require both MX and source evidence to be recent, timezone-aware timestamps."""
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None or current.utcoffset() is None:
        return False
    current = current.astimezone(timezone.utc)

    for field in ("checked_at", "source_confirmed_at"):
        raw_value = evidence.get(field)
        if not isinstance(raw_value, str) or not raw_value.strip():
            return False
        try:
            normalized_value = raw_value.strip().replace("Z", "+00:00")
            normalized_value = re.sub(
                r"(\.\d{6})\d+(?=[+-]\d{2}:\d{2}$)", r"\1", normalized_value
            )
            checked = datetime.fromisoformat(normalized_value)
        except ValueError:
            return False
        if checked.tzinfo is None or checked.utcoffset() is None:
            return False
        checked = checked.astimezone(timezone.utc)
        if checked > current + timedelta(minutes=5) or current - checked > EMAIL_PREFLIGHT_MAX_AGE:
            return False
    return True

def is_live_outreach_ready(lead_id: str, exact_email: str) -> bool:
    """Fail closed unless the current approved prospect has matching, confirmed MX evidence."""
    lead_id = str(lead_id or "").strip()
    exact_email = str(exact_email or "").strip().casefold()
    if not lead_id or not exact_email:
        return False
    init_campaign_tables()
    with connection_scope() as conn:
        preflight_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'email_preflight'"
        ).fetchone()
        prospect_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(prospects)").fetchall()
        }
        if not preflight_exists or not {"lead_id", "status", "contact_email"}.issubset(prospect_columns):
            return False
        row = conn.execute("""
            SELECT p.status, p.contact_email, e.email, e.mx_status, e.source_confirmed,
                e.checked_at, e.source_confirmed_at
            FROM prospects p JOIN email_preflight e ON e.lead_id = p.lead_id
            WHERE p.lead_id = ?
        """, (lead_id,)).fetchone()
        if not row:
            return False
        if str(row["status"] or "").strip().casefold() != "approved for outreach":
            return False
        if str(row["contact_email"] or "").strip().casefold() != exact_email:
            return False
        if str(row["email"] or "").strip().casefold() != exact_email:
            return False
        if str(row["mx_status"] or "").strip().casefold() != "mx_present":
            return False
        if int(row["source_confirmed"] or 0) != 1:
            return False
        if not is_email_preflight_fresh(dict(row)):
            return False
        normalized = exact_email
        if normalized in _unresolved_live_emails(conn):
            return False
        if conn.execute("SELECT 1 FROM email_suppression WHERE lower(email) = ?", (normalized,)).fetchone():
            return False
        if conn.execute("""
            SELECT 1 FROM campaign_sends
            WHERE lower(recipient_email) = ? AND status = 'SENT'
              AND coalesce(response_msg, '') NOT LIKE '%[DRY-RUN%'
            LIMIT 1
        """, (normalized,)).fetchone():
            return False
    return True

def get_recent_send_logs(limit: int = 15) -> List[Dict[str, Any]]:
    init_campaign_tables()
    with connection_scope() as conn:
        cur = conn.cursor()
        cur.execute("""
        SELECT send_id, recipient_email, company_name, subject, sender_email, status, smtp_code, response_msg, sent_at 
        FROM campaign_sends 
        ORDER BY send_id DESC 
        LIMIT ?
        """, (limit,))
        return [dict(row) for row in cur.fetchall()]

# ==============================================================================
# TEMPLATE STUDIO STORAGE
# ==============================================================================

def save_template(name: str, subject: str, body: str, is_default: int = 0) -> int:
    init_campaign_tables()
    with connection_scope() as conn:
        cur = conn.cursor()
        cur.execute("""
        INSERT INTO outbound_templates (name, subject, body, is_default, updated_at)
        VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
        ON CONFLICT(name) DO UPDATE SET
            subject = excluded.subject,
            body = excluded.body,
            is_default = excluded.is_default,
            updated_at = datetime('now', 'localtime')
        """, (name.strip(), subject.strip(), body.strip(), is_default))
        conn.commit()
        return cur.lastrowid

def get_all_templates() -> List[Dict[str, Any]]:
    init_campaign_tables()
    with connection_scope() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM outbound_templates ORDER BY is_default DESC, template_id ASC")
        return [dict(r) for r in cur.fetchall()]

def delete_template(template_id: int) -> None:
    init_campaign_tables()
    with connection_scope() as conn:
        conn.execute("DELETE FROM outbound_templates WHERE template_id = ?", (template_id,))
        conn.commit()

# ==============================================================================
# CAMPAIGN PLAYBOOK & ARCHETYPE MANAGEMENT
# ==============================================================================

DEFAULT_CAMPAIGNS = [
    {
        "campaign_id": "jobstreet_hiring_pain",
        "name": "🔥 JobStreet Hiring Pain (Active Recruitment Reverse-Pitch)",
        "tagline": "Reverse-pitching companies offering RM3,000–RM3,800/mo on JobStreet with RM800/mo done-for-you ledger",
        "description": "Targets companies actively advertising on JobStreet / Indeed for an Accounts Assistant or Clerk in Johor. Solves recruitment headache and saves RM2,700/mo immediately.",
        "target_criteria": "Companies hiring Accounts Assistant, Accounts Clerk, or Bookkeeper in Johor (JB, Senai, Kulai, Pasir Gudang) offering RM2.5k - RM4k salary.",
        "sourcing_strategy": "JobStreet Malaysia & Indeed active postings for Johor accounting roles. Match employer name to SSM registry / Google Maps for MD phone & email.",
        "agent_prompt_spec": "Search JobStreet Malaysia for 'Accounts Assistant' or 'Accounts Clerk' in Johor Bahru / Senai / Pasir Gudang. Extract company name, salary range, location, job URL, and decision-maker contact details.",
        "offer_wedge": "Saw your job post offering RM3.5k/mo on JobStreet. We do the ledger for RM800/mo starting tomorrow with ACCA chartered accountants, zero recruitment wait.",
        "default_template_name": "🔥 Angle 1: Active Job Posting Reverse-Pitch (JobStreet Hiring Pain)",
        "status": "ACTIVE"
    },
    {
        "campaign_id": "hydroball_clones",
        "name": "🏭 Cross-Border Industrial Corridor (Hydroball Clones)",
        "tagline": "Singapore HQ manufacturers & traders with Johor plants (5–15 Malaysian invoices/mo)",
        "description": "Targets Singapore engineering, manufacturing, and distribution firms running secondary facilities across the causeway. Solves cross-border compliance waste.",
        "target_criteria": "Singapore companies with a factory, assembly hub, or warehouse in Senai, Kulai, or Pasir Gudang generating 5 to 20 monthly invoices.",
        "sourcing_strategy": "Federation of Malaysian Manufacturers (FMM) Johor Directory, Singapore Manufacturing Federation (SMF), ACRA registry cross-referenced with SSM.",
        "agent_prompt_spec": "Identify Singapore industrial companies with facilities in Johor. Check estimated monthly transaction volume and pitch done-for-you RM800/mo ledger over full-time resident hire.",
        "offer_wedge": "Eliminate full-time resident accountant overhead for a JB facility with only 10–20 monthly invoices.",
        "default_template_name": "🏭 Angle 2: Cross-Border SG HQ + Johor Factory Arbitrage (The 15-Invoice Wedge)",
        "status": "ACTIVE"
    },
    {
        "campaign_id": "accounting_firm_partners",
        "name": "🤝 Accounting & Audit Firm Subcontracting Desk",
        "tagline": "White-label bookkeeping back-office for boutique Singapore and Johor audit/CPA firms",
        "description": "Targets boutique CPA and corporate secretarial firms facing staff turnover or high SGD labor costs. Provides wholesale RM bookkeeping fulfillment.",
        "target_criteria": "Boutique 1-5 partner audit, tax, or corporate secretarial firms in Singapore and Johor.",
        "sourcing_strategy": "ISCA (Institute of Singapore Chartered Accountants) directory and MIA (Malaysian Institute of Accountants) public firm registry.",
        "agent_prompt_spec": "Identify boutique CPA firms in Singapore. Pitch white-label bookkeeping processing at wholesale RM rates so they can protect profit margins.",
        "offer_wedge": "White-label bookkeeping fulfillment at wholesale RM rates while you bill your SME clients in SGD.",
        "default_template_name": "💻 Angle 3: Software-Native Ledger Modernization (AutoCount / SQL / Xero)",
        "status": "ACTIVE"
    },
    {
        "campaign_id": "lhdn_einvoicing_urgency",
        "name": "⚡ LHDN MyInvois e-Invoicing Compliance Panic",
        "tagline": "B2B distributors and suppliers needing automated XML validation and real-time LHDN submission",
        "description": "Targets Malaysian wholesale, distribution, and manufacturing SMEs struggling with LHDN e-invoicing Phase 2/3 mandates on AutoCount and SQL Accounting.",
        "target_criteria": "Malaysian B2B companies with RM5M–RM25M annual revenue using legacy on-premise accounting software requiring e-invoicing validation.",
        "sourcing_strategy": "SSM company registry, Yellow Pages Malaysia, and AutoCount/SQL customer case studies in industrial hubs (Puchong, Klang, Johor Bahru).",
        "agent_prompt_spec": "Identify Malaysian B2B distributors and trade suppliers in Klang Valley and Johor. Extract finance director or owner contacts, quantify monthly invoice volume, and pitch automated e-invoicing middleware with zero software migration.",
        "offer_wedge": "Plug directly into your existing SQL Account / AutoCount setup and automate LHDN e-invoicing validation without retraining your staff or buying new software.",
        "default_template_name": "💻 Angle 3: Software-Native Ledger Modernization (AutoCount / SQL / Xero)",
        "status": "ACTIVE"
    },
    {
        "campaign_id": "yc_us_expansion",
        "name": "🚀 YC Startups (W20–S25) US Delaware C-Corp Finance Desk",
        "tagline": "Pilot/Kruze replacement, Stripe billing sync, and Oct 15 tax extension catch-up for revenue-making YC companies",
        "description": "Targets active, revenue-generating Y Combinator companies from the last 5 years with team size >= 4 or active hiring. Pitches $800/mo flat dedicated chartered finance desk vs $1.5k/mo Pilot fees, delayed close fatigue, and messy Stripe/Mercury ledgers.",
        "target_criteria": "Active Y Combinator startups (batches 2020 to 2025) with team size >= 4 or active job openings. Excludes non-profits, biotech R&D, and inactive companies.",
        "sourcing_strategy": "Y Combinator public company directory API (yc-oss Algolia sync) filtered for batches W20 to S25, active status, team size >= 4, and direct founder profiles.",
        "agent_prompt_spec": "Ingest YC companies from 2020 to 2026 batches via harvest_yc_5year_master.py and ingest_yc_pipeline.py. Extract verified company profiles, badges, root domains, and pitch dedicated chartered accounting desk.",
        "offer_wedge": "Senior chartered accountants closing your QBO/Xero ledger by the 5th business day for a flat $800/mo with dedicated Slack channel, replacing Pilot turnover and catching up Oct 15 extension books.",
        "default_template_name": "🚀 Angle 4: YC Startups - Pilot / Kruze Fatigue ($800/mo Dedicated Desk)",
        "status": "ACTIVE"
    },
    {
        "campaign_id": "yc_conversational_discovery",
        "name": "💡 YC Startups - Conversational Founder Discovery",
        "tagline": "Founder-to-founder outreach on Stripe/ledger reconciliation pain and in-house vs outsourced books",
        "description": "Direct conversational inquiry asking founders if they manage their own books and Stripe reconciliation in-house or outsourced.",
        "target_criteria": "Seed and Series A YC startups across all sectors (Winter 2026, Summer 2026, 2025).",
        "sourcing_strategy": "Algolia YC directory and launch profiles.",
        "agent_prompt_spec": "Scan recently launched YC startups and initiate brief 30-minute founder discovery calls.",
        "offer_wedge": "Help founders eliminate accounting headaches so they can focus on their product.",
        "default_template_name": "💡 Angle 2: Conversational Builder Approach (Stripe & Ledger In-House vs Outsourced)",
        "status": "ACTIVE"
    }
]

def seed_default_campaigns():
    init_campaign_tables()
    with connection_scope() as conn:
        cur = conn.cursor()
        for c in DEFAULT_CAMPAIGNS:
            cur.execute("""
            INSERT INTO campaigns 
            (campaign_id, name, tagline, description, target_criteria, sourcing_strategy, agent_prompt_spec, offer_wedge, default_template_name, schedule_timezone, schedule_start_minute, schedule_end_minute, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(campaign_id) DO NOTHING
            """, (c["campaign_id"], c["name"], c["tagline"], c["description"], c["target_criteria"],
                  c["sourcing_strategy"], c["agent_prompt_spec"], c["offer_wedge"], c["default_template_name"],
                  "America/Los_Angeles" if c["campaign_id"] in {"yc_us_expansion", "yc_conversational_discovery"} else "Asia/Singapore",
                  540, 1080 if c["campaign_id"] in {"yc_us_expansion", "yc_conversational_discovery"} else 1050, c["status"]))
        conn.commit()

def upsert_campaign(
    campaign_id: str,
    name: str,
    tagline: str = "",
    description: str = "",
    target_criteria: str = "",
    sourcing_strategy: str = "",
    agent_prompt_spec: str = "",
    offer_wedge: str = "",
    default_template_name: str = "",
    status: str = "ACTIVE"
) -> None:
    init_campaign_tables()
    with connection_scope() as conn:
        conn.execute("""
        INSERT INTO campaigns 
        (campaign_id, name, tagline, description, target_criteria, sourcing_strategy, agent_prompt_spec, offer_wedge, default_template_name, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        ON CONFLICT(campaign_id) DO UPDATE SET
            name = excluded.name,
            tagline = excluded.tagline,
            description = excluded.description,
            target_criteria = excluded.target_criteria,
            sourcing_strategy = excluded.sourcing_strategy,
            agent_prompt_spec = excluded.agent_prompt_spec,
            offer_wedge = excluded.offer_wedge,
            default_template_name = excluded.default_template_name,
            status = excluded.status,
            updated_at = datetime('now', 'localtime')
        """, (campaign_id.strip(), name.strip(), tagline.strip(), description.strip(),
              target_criteria.strip(), sourcing_strategy.strip(), agent_prompt_spec.strip(),
              offer_wedge.strip(), default_template_name.strip(), status))
        conn.commit()

def get_all_campaigns() -> List[Dict[str, Any]]:
    seed_default_campaigns()
    with connection_scope() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM campaigns WHERE status<>'ARCHIVED' ORDER BY created_at ASC")
        return [dict(r) for r in cur.fetchall()]

def get_campaign_by_id(campaign_id: str) -> Optional[Dict[str, Any]]:
    seed_default_campaigns()
    with connection_scope() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM campaigns WHERE campaign_id = ?", (campaign_id.strip(),))
        row = cur.fetchone()
        return dict(row) if row else None

def get_campaign_schedule_for_lead(lead_id: str) -> Optional[Dict[str, Any]]:
    """Return the assigned campaign's weekday send window, when one exists."""
    lead_id = str(lead_id or "").strip()
    if not lead_id:
        return None
    init_campaign_tables()
    with connection_scope() as conn:
        row = conn.execute("""
            SELECT c.schedule_timezone, c.schedule_start_minute, c.schedule_end_minute
            FROM prospects p JOIN campaigns c ON c.campaign_id = p.campaign_id
            WHERE p.lead_id = ?
        """, (lead_id,)).fetchone()
        if not row:
            return None
        return {
            "timezone_name": str(row["schedule_timezone"] or "Asia/Singapore"),
            "start_minute": int(row["schedule_start_minute"]),
            "end_minute": int(row["schedule_end_minute"]),
        }

def delete_campaign(campaign_id: str) -> None:
    init_campaign_tables()
    with connection_scope() as conn:
        conn.execute("DELETE FROM campaigns WHERE campaign_id = ?", (campaign_id.strip(),))
        conn.commit()

def assign_lead_to_campaign(lead_id: str, campaign_id: str) -> None:
    init_campaign_tables()
    with connection_scope() as conn:
        conn.execute("UPDATE prospects SET campaign_id = ? WHERE lead_id = ?", (campaign_id.strip(), str(lead_id)))
        conn.commit()

def get_campaign_lead_counts() -> Dict[str, int]:
    """Returns a dictionary mapping campaign_id to total number of assigned prospects."""
    init_campaign_tables()
    with connection_scope() as conn:
        cur = conn.cursor()
        cur.execute("SELECT campaign_id, COUNT(*) FROM prospects GROUP BY campaign_id")
        return {r[0]: r[1] for r in cur.fetchall() if r[0]}

def get_leads_by_campaign(campaign_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieves prospects optionally filtered by campaign_id."""
    init_campaign_tables()
    with connection_scope() as conn:
        cur = conn.cursor()
        if campaign_id and campaign_id.lower() not in ("all", "all campaigns"):
            cur.execute("SELECT * FROM prospects WHERE campaign_id = ? ORDER BY quality_score DESC", (campaign_id.strip(),))
        else:
            cur.execute("SELECT * FROM prospects ORDER BY quality_score DESC")
        return [dict(r) for r in cur.fetchall()]

def ingest_leads_to_campaign(records: List[Dict[str, Any]], campaign_id: str) -> tuple[int, int]:
    """
    Inserts or updates prospects and tags them with the specified campaign_id.
    Returns (inserted_count, updated_count).
    """
    if not records:
        return 0, 0
    init_campaign_tables()
    inserted = 0
    updated = 0
    with connection_scope() as conn:
        cur = conn.cursor()
        for idx, r in enumerate(records):
            lead_id = str(r.get("lead_id") or f"OC-{campaign_id[:3].upper()}-{int(time.time())}-{idx+1:03d}")
            company_name = str(r.get("company_name", "")).strip()
            if not company_name:
                continue

            cur.execute("SELECT lead_id FROM prospects WHERE lead_id = ? OR (company_name = ? AND company_name != '')", (lead_id, company_name))
            existing = cur.fetchone()

            if existing:
                cur.execute("""
                UPDATE prospects SET
                    company_summary = COALESCE(?, company_summary),
                    contact_email = COALESCE(?, contact_email),
                    contact_phone = COALESCE(?, contact_phone),
                    buyer_name = COALESCE(?, buyer_name),
                    buyer_title = COALESCE(?, buyer_title),
                    sector = COALESCE(?, sector),
                    accounting_software = COALESCE(?, accounting_software),
                    sg_my_wedge = COALESCE(?, sg_my_wedge),
                    quality_score = COALESCE(?, quality_score),
                    campaign_id = ?
                WHERE lead_id = ?
                """, (
                    r.get("company_summary"), r.get("contact_email"), r.get("contact_phone"),
                    r.get("buyer_name"), r.get("buyer_title"), r.get("sector"),
                    r.get("accounting_software"), r.get("sg_my_wedge"), r.get("quality_score"),
                    campaign_id, existing[0]
                ))
                updated += 1
            else:
                cur.execute("""
                INSERT INTO prospects (
                    lead_id, company_name, company_summary, root_domain, headquarters,
                    malaysia_facility, sector, estimated_transactions_mo, accounting_software,
                    buyer_name, buyer_title, contact_email, contact_phone, sg_my_wedge,
                    quality_score, tier, status, notes, bro_summary, proof_link, phone_script, campaign_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    lead_id, company_name,
                    r.get("company_summary", ""),
                    r.get("root_domain", ""),
                    r.get("headquarters", "Malaysia"),
                    r.get("malaysia_facility", "Johor"),
                    r.get("sector", "B2B Services"),
                    r.get("estimated_transactions_mo", "10-20 tx/mo"),
                    r.get("accounting_software", "AutoCount / SQL Account"),
                    r.get("buyer_name", "Managing Director"),
                    r.get("buyer_title", "Director"),
                    r.get("contact_email", ""),
                    r.get("contact_phone", ""),
                    r.get("sg_my_wedge", ""),
                    int(r.get("quality_score", 85)),
                    r.get("tier", "Tier A"),
                    r.get("status", "Ready to Review"),
                    r.get("notes", f"Ingested into {campaign_id}"),
                    r.get("bro_summary", r.get("company_summary", "")),
                    r.get("proof_link", ""),
                    r.get("phone_script", ""),
                    campaign_id
                ))
                inserted += 1
        conn.commit()
    return inserted, updated

# ==============================================================================
# TELEPHONY PERSISTENCE & CALL DISPOSITION ENGINE
# ==============================================================================

CALL_DISPOSITIONS = [
    ("CONNECTED_MEETING_BOOKED", "Meeting Booked", 100, "Discovery call locked in calendar"),
    ("CONNECTED_CALLBACK", "Callback Requested", 70, "Prospect asked to call at specific time"),
    ("CONNECTED_NOT_INTERESTED", "Not Interested", 10, "Direct rejection / timing mismatch"),
    ("CONNECTED_WRONG_PERSON", "Wrong Person", 5, "Left company or wrong contact"),
    ("GATEKEEPER_BLOCKED", "Gatekeeper Blocked", 15, "Receptionist refused transfer"),
    ("GATEKEEPER_TRANSFERRED", "Gatekeeper Transferred", 40, "Transferred to desk/voicemail"),
    ("NO_ANSWER_VOICEMAIL", "Voicemail Left", 25, "Left 20s Voss voicemail"),
    ("NO_ANSWER_RING_OUT", "Ring Out / No Answer", 10, "Rang with no pickup"),
    ("BUSY", "Busy Tone", 10, "Line currently engaged"),
    ("BAD_NUMBER", "Disconnected / Invalid", 0, "Number out of service"),
]

def init_telephony_tables() -> None:
    """Initializes call_logs and updates prospects schema with telephony tracking columns."""
    with connection_scope() as conn:
        # 1. Call Logs Audit Trail
        conn.execute("""
        CREATE TABLE IF NOT EXISTS call_logs (
            call_id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id TEXT NOT NULL,
            caller_name TEXT NOT NULL DEFAULT 'Bryan',
            target_phone TEXT NOT NULL,
            target_name TEXT,
            company_name TEXT,
            campaign_id TEXT,
            disposition TEXT NOT NULL,
            duration_seconds INTEGER DEFAULT 0,
            call_notes TEXT,
            next_followup_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (lead_id) REFERENCES prospects(lead_id)
        );
        """)

        # 2. Add Telephony Telemetry Columns to Prospects
        for col_def in [
            ("phone_e164", "TEXT"),
            ("lead_timezone", "TEXT DEFAULT 'Asia/Kuala_Lumpur'"),
            ("call_attempts_count", "INTEGER DEFAULT 0"),
            ("last_called_at", "TIMESTAMP"),
            ("last_disposition", "TEXT")
        ]:
            try:
                conn.execute(f"ALTER TABLE prospects ADD COLUMN {col_def[0]} {col_def[1]};")
            except sqlite3.OperationalError:
                pass  # Column already exists

        # Indices for rapid telemetry queries
        conn.execute("CREATE INDEX IF NOT EXISTS idx_call_logs_lead ON call_logs(lead_id);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_call_logs_date ON call_logs(created_at);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_call_logs_disposition ON call_logs(disposition);")
        conn.commit()

def log_call_disposition(
    lead_id: str,
    target_phone: str,
    target_name: str,
    company_name: str,
    campaign_id: str,
    disposition: str,
    duration_seconds: int = 0,
    notes: str = "",
    next_followup_at: Optional[str] = None
) -> int:
    """Records a call attempt in call_logs and updates lead's aggregate phone status."""
    init_telephony_tables()
    now_iso = datetime.now(timezone.utc).isoformat()

    with connection_scope() as conn:
        cur = conn.execute("""
        INSERT INTO call_logs (
            lead_id, target_phone, target_name, company_name, campaign_id,
            disposition, duration_seconds, call_notes, next_followup_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            lead_id, target_phone, target_name, company_name, campaign_id,
            disposition, duration_seconds, notes, next_followup_at, now_iso
        ))
        call_id = cur.lastrowid

        # Map disposition to CRM stage progression
        crm_stage = None
        if disposition == "CONNECTED_MEETING_BOOKED":
            crm_stage = "Discovery Call Booked"
        elif disposition in ("CONNECTED_CALLBACK", "NO_ANSWER_VOICEMAIL"):
            crm_stage = "Nurture / Follow-up"
        elif disposition == "CONNECTED_NOT_INTERESTED":
            crm_stage = "Discarded / DNC"

        if crm_stage:
            conn.execute("""
            UPDATE prospects SET
                call_attempts_count = coalesce(call_attempts_count, 0) + 1,
                last_called_at = ?,
                last_disposition = ?,
                status = ?
            WHERE lead_id = ?
            """, (now_iso, disposition, crm_stage, lead_id))
        else:
            conn.execute("""
            UPDATE prospects SET
                call_attempts_count = coalesce(call_attempts_count, 0) + 1,
                last_called_at = ?,
                last_disposition = ?
            WHERE lead_id = ?
            """, (now_iso, disposition, lead_id))

        conn.commit()
        return call_id

def get_telephony_stats_today() -> Dict[str, Any]:
    """Returns today's dialing metrics, connect rate, and conversion ratios."""
    init_telephony_tables()
    today_start = datetime.now(timezone.utc).strftime("%Y-%m-%d 00:00:00")
    with connection_scope() as conn:
        rows = conn.execute("""
        SELECT disposition, count(*) as cnt, sum(duration_seconds) as total_dur
        FROM call_logs
        WHERE created_at >= ?
        GROUP BY disposition
        """, (today_start,)).fetchall()

    dials_today = sum(r["cnt"] for r in rows)
    connects = sum(r["cnt"] for r in rows if r["disposition"].startswith("CONNECTED_"))
    meetings = sum(r["cnt"] for r in rows if r["disposition"] == "CONNECTED_MEETING_BOOKED")
    gatekeeper_blocks = sum(r["cnt"] for r in rows if r["disposition"] == "GATEKEEPER_BLOCKED")

    connect_rate = round((connects / dials_today * 100), 1) if dials_today > 0 else 0.0
    meeting_rate = round((meetings / connects * 100), 1) if connects > 0 else 0.0

    return {
        "dials_today": dials_today,
        "connects_today": connects,
        "meetings_booked_today": meetings,
        "gatekeeper_blocks": gatekeeper_blocks,
        "connect_rate_pct": connect_rate,
        "meeting_conversion_pct": meeting_rate,
        "breakdown": {r["disposition"]: r["cnt"] for r in rows}
    }

def get_lead_call_history(lead_id: str) -> List[Dict[str, Any]]:
    """Returns all historical call attempts for a given lead."""
    init_telephony_tables()
    with connection_scope() as conn:
        rows = conn.execute("""
        SELECT call_id, caller_name, target_phone, disposition, duration_seconds, call_notes, created_at
        FROM call_logs
        WHERE lead_id = ?
        ORDER BY created_at DESC
        """, (lead_id,)).fetchall()
        return [dict(r) for r in rows]

def get_email_stats_summary() -> Dict[str, Any]:
    """Returns comprehensive lifetime and today's email telemetry metrics."""
    init_campaign_tables()
    today_start = datetime.now().strftime("%Y-%m-%d 00:00:00")
    with connection_scope() as conn:
        cur = conn.cursor()

        # 1. Sends Today (Live vs Dry-run)
        cur.execute("""
        SELECT COUNT(*) FROM campaign_sends 
        WHERE status = 'SENT' 
          AND response_msg NOT LIKE '%[DRY-RUN%'
          AND sent_at >= ?
        """, (today_start,))
        sent_today = cur.fetchone()[0]

        # 2. Total Lifetime Live Sends
        cur.execute("""
        SELECT COUNT(*) FROM campaign_sends 
        WHERE status = 'SENT' 
          AND response_msg NOT LIKE '%[DRY-RUN%'
        """)
        sent_total = cur.fetchone()[0]

        # 3. Dry-Run Simulated Sends
        cur.execute("""
        SELECT COUNT(*) FROM campaign_sends 
        WHERE response_msg LIKE '%[DRY-RUN%'
        """)
        dry_run_total = cur.fetchone()[0]

        # 4. Total Bounces & Suppressed
        cur.execute("SELECT COUNT(*) FROM campaign_sends WHERE status = 'BOUNCED'")
        bounces_total = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM email_suppression")
        suppression_total = cur.fetchone()[0]

        # 5. Replies & Inbound Leads (from prospects status)
        cur.execute("""
        SELECT COUNT(*) FROM prospects 
        WHERE status IN ('Replied (Warm)', 'Discovery Call Booked')
        """)
        replies_total = cur.fetchone()[0]

        # 6. Active Mailbox Pool Capacity
        cur.execute("SELECT COUNT(*), SUM(daily_limit) FROM mailboxes WHERE status = 'ACTIVE'")
        mb_row = cur.fetchone()
        active_mailboxes = mb_row[0] or 0
        pool_daily_capacity = mb_row[1] or 0

        # Deliverability & Reply Rates
        deliverability_rate = round(((sent_total - bounces_total) / max(1, sent_total) * 100), 1) if sent_total > 0 else 100.0
        reply_rate = round((replies_total / max(1, sent_total) * 100), 1) if sent_total > 0 else 0.0

        return {
            "sent_today": sent_today,
            "sent_total": sent_total,
            "dry_run_total": dry_run_total,
            "bounces_total": bounces_total,
            "suppression_total": suppression_total,
            "replies_total": replies_total,
            "active_mailboxes": active_mailboxes,
            "pool_daily_capacity": pool_daily_capacity,
            "deliverability_rate_pct": deliverability_rate,
            "reply_rate_pct": reply_rate
        }


