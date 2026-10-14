"""
Inbound Inbox Monitor, Bounce (NDR) Parser & Stop-On-Reply Engine
Connects to Microsoft 365 IMAP, parses Delivery Status Notifications (550 Bounces),
and detects prospect replies to automatically halt outbound drips and update CRM stages.

Path: inbound_monitor.py
"""

import re
import imaplib
import email
import sqlite3
import time
from email import policy
from email.header import decode_header
from email.utils import getaddresses
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple, Callable

import campaign_database as db
from config import DB_PATH, DEFAULT_IMAP_PORT

OPT_OUT_KEYWORDS = [
    "unsubscribe", "stop", "remove me", "not interested",
    "do not contact", "don't contact", "take me off", "leave me alone"
]

BOUNCE_INDICATORS_SUBJECT = [
    "undeliverable", "delivery status notification", "failure",
    "returned mail", "mail delivery subsystem", "rejected", "bounced"
]

BOUNCE_INDICATORS_FROM = [
    "mailer-daemon", "postmaster", "bounce", "microsoftexchange"
]

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")

def decode_mime_header(header_value: str) -> str:
    """Decodes MIME encoded header strings into plain text."""
    if not header_value:
        return ""
    try:
        decoded_parts = decode_header(header_value)
        text_parts = []
        for content, encoding in decoded_parts:
            if isinstance(content, bytes):
                text_parts.append(content.decode(encoding or "utf-8", errors="replace"))
            else:
                text_parts.append(str(content))
        return "".join(text_parts)
    except Exception:
        return str(header_value)

def extract_body_text(msg) -> str:
    """Extracts plain text body from multipart or single-part email message."""
    body_text = ""
    try:
        if msg.is_multipart():
            for part in msg.walk():
                ctype = part.get_content_type()
                cdispo = str(part.get("Content-Disposition") or "")
                if ctype == "text/plain" and "attachment" not in cdispo:
                    payload = part.get_payload(decode=True)
                    if payload:
                        body_text += payload.decode("utf-8", errors="replace") + "\n"
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                body_text = payload.decode("utf-8", errors="replace")
    except Exception:
        pass
    return body_text

def parse_ndr_bounced_email(subject: str, sender: str, body: str) -> Optional[str]:
    """
    Extracts the failed recipient address from a Delivery Status Notification (DSN / NDR).
    """
    is_ndr = (
        any(ind in subject.lower() for ind in BOUNCE_INDICATORS_SUBJECT) or
        any(ind in sender.lower() for ind in BOUNCE_INDICATORS_FROM)
    )
    if not is_ndr:
        return None

    # Check for RFC 3464 Final-Recipient header in body
    rfc_match = re.search(r"Final-Recipient:\s*rfc822;\s*([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)", body, re.IGNORECASE)
    if rfc_match:
        return rfc_match.group(1).lower().strip()

    # Fallback to finding emails in error report block
    candidates = EMAIL_REGEX.findall(body)
    for c in candidates:
        cl = c.lower().strip()
        if not any(ign in cl for ign in ["postmaster", "mailer-daemon", "microsoft", "outlook", "protection", "outbounder"]):
            return cl

    return None

def process_inbound_message(sender_addr: str, subject: str, body_text: str) -> Dict[str, Any]:
    """
    Analyzes an inbound email to categorize as:
    1. NDR / Hard Bounce (auto-quarantine)
    2. Prospect Opt-Out / Stop (auto-suppress)
    3. Prospect Warm Reply (auto-stop sequence & upgrade CRM status)
    4. Unrelated / Unknown
    """
    sender_clean = sender_addr.lower().strip()
    
    # 1. Check if this is a Bounce / NDR
    bounced_email = parse_ndr_bounced_email(subject, sender_clean, body_text)
    if bounced_email:
        db.suppress_email(bounced_email, reason=f"NDR Bounce: {subject[:70]}")
        with db.get_db_connection() as conn:
            conn.execute(
                "UPDATE prospects SET status = 'Bounced / 550 Invalid' WHERE lower(contact_email) = ?",
                (bounced_email,)
            )
            conn.commit()
        return {
            "type": "BOUNCE",
            "email": bounced_email,
            "action": "QUARANTINED",
            "detail": f"Hard bounce detected. Added {bounced_email} to permanent suppression list."
        }

    # 2. Check if sender matches an active prospect in database
    with db.get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT lead_id, company_name, buyer_name, status FROM prospects WHERE lower(contact_email) = ?",
            (sender_clean,)
        )
        matched_lead = cur.fetchone()

    if matched_lead:
        lead_id, company, buyer, cur_status = matched_lead
        
        # Check for opt-out intent
        body_lower = body_text.lower()
        is_opt_out = any(kw in body_lower for kw in OPT_OUT_KEYWORDS)
        
        if is_opt_out:
            db.suppress_email(sender_clean, reason="Prospect Requested Opt-Out ('stop/unsubscribe')")
            with db.get_db_connection() as conn:
                if lead_id:
                    conn.execute("UPDATE prospects SET status = 'Discarded / DNC' WHERE lead_id = ?", (lead_id,))
                else:
                    conn.execute("UPDATE prospects SET status = 'Discarded / DNC' WHERE lower(contact_email) = ?", (sender_clean,))
                conn.commit()
            return {
                "type": "OPT_OUT",
                "email": sender_clean,
                "company": company,
                "action": "SUPPRESSED",
                "detail": f"Prospect from {company} requested unsubscribe. Added to suppression table."
            }
        else:
            # Positive / Warm Reply
            with db.get_db_connection() as conn:
                if lead_id:
                    conn.execute("UPDATE prospects SET status = 'Replied (Warm)' WHERE lead_id = ?", (lead_id,))
                else:
                    conn.execute("UPDATE prospects SET status = 'Replied (Warm)' WHERE lower(contact_email) = ?", (sender_clean,))
                conn.commit()
            return {
                "type": "REPLY_WARM",
                "email": sender_clean,
                "company": company,
                "buyer": buyer,
                "action": "SEQUENCE_STOPPED",
                "detail": f"🎯 Lead replied from {company} ({buyer})! Outbound sequence stopped. Status updated to 'Replied (Warm)'."
            }

    return {
        "type": "UNRELATED",
        "email": sender_clean,
        "action": "IGNORED",
        "detail": "Message sender not found in active prospect database."
    }

from config import DEFAULT_IMAP_SERVER, DEFAULT_IMAP_PORT, DEFAULT_IMAP_TIMEOUT

def scan_inbox_for_replies_and_bounces(
    mailbox: Dict[str, Any],
    max_check: int = 15,
    timeout: float = DEFAULT_IMAP_TIMEOUT
) -> Dict[str, Any]:
    """
    Connects to the mailbox via IMAP4_SSL and audits recent emails.
    """
    email_addr = mailbox.get("email") or ""
    user = mailbox.get("smtp_user") or email_addr
    password = mailbox.get("smtp_password") or ""
    server = mailbox.get("imap_server", DEFAULT_IMAP_SERVER)
    port = int(mailbox.get("imap_port", DEFAULT_IMAP_PORT))

    if not user or not password:
        return {
            "status": "CONFIG_ERROR",
            "message": "Mailbox credentials not configured.",
            "bounces": [],
            "replies": [],
            "opt_outs": []
        }

    bounces = []
    replies = []
    opt_outs = []

    try:
        mail = imaplib.IMAP4_SSL(server, port)
        mail.sock.settimeout(timeout)
        mail.login(user, password)
        mail.select("INBOX")

        status, messages = mail.search(None, "ALL")
        if status != "OK" or not messages[0]:
            mail.logout()
            return {
                "status": "SUCCESS",
                "message": "Inbox scanned. No new messages found.",
                "bounces": [],
                "replies": [],
                "opt_outs": []
            }

        msg_ids = messages[0].split()
        target_ids = msg_ids[-max_check:] # Check last N messages

        for m_id in reversed(target_ids):
            try:
                res, data = mail.fetch(m_id, "(RFC822)")
                if res != "OK":
                    continue
                raw_email = data[0][1]
                msg = email.message_from_bytes(raw_email)

                raw_from = decode_mime_header(msg.get("From") or "")
                raw_sub = decode_mime_header(msg.get("Subject") or "")
                sender_email = email.utils.parseaddr(raw_from)[1]
                body = extract_body_text(msg)

                result = process_inbound_message(sender_email, raw_sub, body)
                if result["type"] == "BOUNCE":
                    bounces.append(result)
                elif result["type"] == "REPLY_WARM":
                    replies.append(result)
                elif result["type"] == "OPT_OUT":
                    opt_outs.append(result)
            except Exception:
                continue

        mail.logout()
        return {
            "status": "SUCCESS",
            "message": f"Successfully audited {len(target_ids)} recent inbox messages.",
            "bounces": bounces,
            "replies": replies,
            "opt_outs": opt_outs
        }

    except imaplib.IMAP4.error as e:
        return {
            "status": "AUTH_FAILED",
            "message": f"IMAP authentication error: {e}",
            "bounces": [],
            "replies": [],
            "opt_outs": []
        }
    except Exception as e:
        return {
            "status": "CONNECTION_ERROR",
            "message": f"Could not connect to IMAP server ({server}:{port}): {e}",
            "bounces": [],
            "replies": [],
            "opt_outs": []
        }


# The Next.js operator desk uses this bounded scanner. Keep it separate from the
# older Streamlit scanner above: this path is explicitly read-only at the IMAP
# layer, stores no message content, and only mutates the local SQLite CRM.
MAX_INBOUND_MESSAGES = 20
MAX_INBOUND_MESSAGE_BYTES = 128 * 1024
MAX_INBOUND_SCAN_SECONDS = 75.0
INBOUND_IMAP_OPERATION_TIMEOUT = 1.5
IMAP_HOSTS_BY_PROVIDER = {
    "MICROSOFT": "outlook.office365.com",
    "GOOGLE": "imap.gmail.com",
}
EMAIL_RE = re.compile(r"^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]{0,251}[A-Z0-9])?$", re.IGNORECASE)
FINAL_RECIPIENT_RE = re.compile(
    r"Final-Recipient\s*:\s*rfc822\s*;\s*<?([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+)>?",
    re.IGNORECASE,
)
BOUNCE_SUBJECT_MARKERS = (
    "undeliverable", "delivery status notification", "failure", "returned mail",
    "mail delivery subsystem", "rejected", "bounced",
)
BOUNCE_SENDER_MARKERS = ("mailer-daemon", "postmaster", "bounce", "microsoft exchange")
OPT_OUT_RE = re.compile(
    r"\b(?:unsubscribe|remove\s+me(?:\s+from\s+(?:your|the)\s+(?:mailing\s+)?list)?|"
    r"(?:please\s+)?stop\s+(?:emailing|contacting|sending(?:\s+me)?(?:\s+emails?)?)|"
    r"(?:do\s+not|don't)\s+contact\s+me|take\s+me\s+off(?:\s+(?:your|the)\s+(?:mailing\s+)?list)?|"
    r"not\s+interested)\b",
    re.IGNORECASE,
)


class InboundScanError(Exception):
    """Safe, user-facing scan error. Never include server or credential details."""


def imap_host_for_provider(provider_type: str) -> str:
    """Return a known IMAP host or fail closed for ambiguous mailbox providers."""
    provider = str(provider_type or "").strip().upper()
    host = IMAP_HOSTS_BY_PROVIDER.get(provider)
    if not host:
        raise InboundScanError("Inbound scan requires a Microsoft or Google mailbox provider.")
    return host


def _message_plain_text(message: email.message.Message) -> str:
    chunks: list[str] = []
    if message.is_multipart():
        parts = message.walk()
    else:
        parts = (message,)
    for part in parts:
        if part.get_content_type() != "text/plain":
            continue
        disposition = str(part.get("Content-Disposition") or "").casefold()
        if "attachment" in disposition:
            continue
        try:
            payload = part.get_content()
            if isinstance(payload, bytes):
                chunks.append(payload.decode(part.get_content_charset() or "utf-8", errors="replace"))
            elif isinstance(payload, str):
                chunks.append(payload)
        except (LookupError, UnicodeError, AttributeError, TypeError):
            payload = part.get_payload(decode=True)
            if payload:
                chunks.append(payload.decode(part.get_content_charset() or "utf-8", errors="replace"))
    return "\n".join(chunks)[:MAX_INBOUND_MESSAGE_BYTES]


def _non_quoted_text(body: str) -> str:
    """Ignore common quoted-reply blocks to reduce inherited opt-out matches."""
    lines: list[str] = []
    for line in body.splitlines():
        if line.lstrip().startswith(">"):
            continue
        if re.match(r"^\s*-{2,}\s*Original Message\s*-{2,}\s*$", line, re.IGNORECASE):
            break
        if re.match(r"^\s*On .{1,300} wrote:\s*$", line, re.IGNORECASE):
            break
        lines.append(line)
    return "\n".join(lines)


def parse_inbound_message(raw_message: bytes) -> dict[str, str]:
    """Extract only classification inputs; never persist or return raw content."""
    if not isinstance(raw_message, bytes) or len(raw_message) > MAX_INBOUND_MESSAGE_BYTES:
        raise InboundScanError("An inbound message exceeded the safe scan size limit.")
    message = email.message_from_bytes(raw_message, policy=policy.default)
    from_values = [str(value) for value in message.get_all("From", [])]
    sender = next((address.casefold() for _, address in getaddresses(from_values) if EMAIL_RE.fullmatch(address)), "")
    subject = str(message.get("Subject") or "")[:998]
    body = _message_plain_text(message)

    bounce_hint = any(marker in subject.casefold() for marker in BOUNCE_SUBJECT_MARKERS) or any(
        marker in sender for marker in BOUNCE_SENDER_MARKERS
    )
    failed_recipient = ""
    if bounce_hint:
        # RFC 3464 Final-Recipient is authoritative. Do not guess from arbitrary
        # email addresses elsewhere in a bounce body.
        final_recipients = [str(value) for value in message.get_all("Final-Recipient", [])]
        for part in message.walk():
            final_recipients.extend(str(value) for value in part.get_all("Final-Recipient", []))
        candidates = final_recipients + FINAL_RECIPIENT_RE.findall(body)
        for candidate in candidates:
            match = FINAL_RECIPIENT_RE.search(candidate)
            address = (match.group(1) if match else candidate.split(";", 1)[-1]).strip().strip("<>").casefold()
            if EMAIL_RE.fullmatch(address):
                failed_recipient = address
                break

    clean_body = _non_quoted_text(body)
    kind = "BOUNCE" if failed_recipient else "OPT_OUT" if OPT_OUT_RE.search(clean_body) else "REPLY"
    return {"sender": sender, "subject": subject, "body": body, "type": kind, "failed_recipient": failed_recipient}


def _uidnext_from_status(status_data: Any) -> int:
    for item in status_data or []:
        value = item if isinstance(item, bytes) else str(item).encode("ascii", errors="ignore")
        match = re.search(rb"UIDNEXT\s+(\d+)", value, re.IGNORECASE)
        if match:
            return int(match.group(1))
    raise InboundScanError("The mailbox did not provide a usable message cursor.")


def _uidvalidity_from_selection(client: Any, select_data: Any) -> int:
    response = None
    try:
        response = client.response("UIDVALIDITY")
    except Exception:
        response = None
    values = list(select_data or [])
    if isinstance(response, tuple) and len(response) > 1:
        values.extend(response[1] or [])
        if response[0]:
            code = response[0] if isinstance(response[0], bytes) else str(response[0]).encode("ascii", errors="ignore")
            data = b" ".join(
                item if isinstance(item, bytes) else str(item).encode("ascii", errors="ignore")
                for item in response[1] or []
            )
            values.append(code + b" " + data)
    for item in values:
        value = item if isinstance(item, bytes) else str(item).encode("ascii", errors="ignore")
        match = re.search(rb"UIDVALIDITY\s+(\d+)", value, re.IGNORECASE)
        if match:
            return int(match.group(1))
    raise InboundScanError("The mailbox did not provide a usable message cursor.")


def _fetch_size(client: Any, uid: bytes) -> Optional[int]:
    status, rows = client.uid("fetch", uid, "(UID RFC822.SIZE)")
    if status != "OK":
        return None
    for row in rows or []:
        if isinstance(row, tuple):
            line = row[0]
        else:
            line = row
        if isinstance(line, bytes):
            match = re.search(rb"RFC822\.SIZE\s+(\d+)", line, re.IGNORECASE)
            if match:
                return int(match.group(1))
    return None


def _fetch_peek_body(client: Any, uid: bytes) -> Optional[bytes]:
    status, rows = client.uid("fetch", uid, "(BODY.PEEK[])")
    if status != "OK":
        return None
    for row in rows or []:
        if isinstance(row, tuple) and len(row) > 1 and isinstance(row[1], bytes):
            return row[1]
    return None


def _init_scan_table(connection: sqlite3.Connection) -> None:
    connection.execute("""
        CREATE TABLE IF NOT EXISTS inbound_scan_messages (
            mailbox_id INTEGER NOT NULL,
            uid_validity INTEGER NOT NULL,
            uid INTEGER NOT NULL,
            classification TEXT NOT NULL,
            processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (mailbox_id, uid_validity, uid)
        )
    """)


def _has_prior_live_send(connection: sqlite3.Connection, address: str) -> bool:
    return connection.execute("""
        SELECT 1 FROM campaign_sends
        WHERE lower(recipient_email) = ? AND upper(status) = 'SENT'
          AND coalesce(response_msg, '') NOT LIKE '%[DRY-RUN%'
        LIMIT 1
    """, (address,)).fetchone() is not None


def _apply_classification(
    connection: sqlite3.Connection,
    uid_validity: int,
    uid: int,
    parsed: dict[str, str],
    mailbox_id: int,
) -> str:
    sender = parsed["sender"]
    kind = parsed["type"]
    target = parsed["failed_recipient"] if kind == "BOUNCE" else sender
    if not target or not _has_prior_live_send(connection, target):
        kind = "UNRELATED"
        target = ""

    connection.execute("BEGIN IMMEDIATE")
    try:
        exists = connection.execute("""
            SELECT 1 FROM inbound_scan_messages
            WHERE mailbox_id = ? AND uid_validity = ? AND uid = ?
        """, (mailbox_id, uid_validity, uid)).fetchone()
        if exists:
            connection.rollback()
            return "DUPLICATE"

        if target and kind == "BOUNCE":
            connection.execute(
                "INSERT OR IGNORE INTO email_suppression (email, reason) VALUES (?, ?)",
                (target, "Inbound delivery failure (NDR)"),
            )
            connection.execute("""
                UPDATE prospects SET status = 'Bounced / 550 Invalid'
                WHERE lower(contact_email) = ? AND status <> 'Discarded / DNC'
            """, (target,))
        elif target and kind == "OPT_OUT":
            connection.execute(
                "INSERT OR IGNORE INTO email_suppression (email, reason) VALUES (?, ?)",
                (target, "Inbound opt-out request"),
            )
            connection.execute(
                "UPDATE prospects SET status = 'Discarded / DNC' WHERE lower(contact_email) = ?",
                (target,),
            )
        elif target and kind == "REPLY":
            connection.execute("""
                UPDATE prospects SET status = 'Replied (Warm)'
                WHERE lower(contact_email) = ?
                  AND status NOT IN (
                    'Discarded / DNC', 'Bounced / 550 Invalid',
                    'Discovery Call Booked', 'Proposal Sent', 'Closed Won (Retainer Signed)'
                  )
            """, (target,))

        connection.execute("""
            INSERT INTO inbound_scan_messages (mailbox_id, uid_validity, uid, classification)
            VALUES (?, ?, ?, ?)
        """, (mailbox_id, uid_validity, uid, kind))
        connection.commit()
        return kind
    except Exception:
        connection.rollback()
        raise


def scan_mailbox_readonly(
    mailbox: dict[str, Any],
    *,
    max_messages: int = 15,
    database_path: Optional[Path] = None,
    imap_factory: Optional[Callable[..., Any]] = None,
) -> dict[str, int | str]:
    """Manually scan a bounded set of recent messages with EXAMINE and BODY.PEEK."""
    if type(max_messages) is not int or not 1 <= max_messages <= MAX_INBOUND_MESSAGES:
        raise InboundScanError(f"Choose between 1 and {MAX_INBOUND_MESSAGES} recent messages.")
    try:
        mailbox_id = int(mailbox.get("mailbox_id", mailbox.get("id", 0)))
    except (TypeError, ValueError):
        mailbox_id = 0
    if mailbox_id < 1:
        raise InboundScanError("The selected mailbox is invalid.")
    user = str(mailbox.get("smtp_user") or "").strip()
    password = str(mailbox.get("smtp_password") or "")
    if not user or not password:
        raise InboundScanError("The selected mailbox has no saved login credential.")
    provider = str(mailbox.get("provider_type") or "")
    host = imap_host_for_provider(provider)
    factory = imap_factory or imaplib.IMAP4_SSL
    client = None
    deadline = time.monotonic() + MAX_INBOUND_SCAN_SECONDS

    def prepare_imap_operation() -> None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise InboundScanError("The bounded inbound scan reached its time limit; retry to continue.")
        sock = getattr(client, "sock", None)
        if sock is not None:
            sock.settimeout(min(INBOUND_IMAP_OPERATION_TIMEOUT, remaining))

    checked = processed_replies = processed_bounces = processed_opt_outs = unrelated = duplicates = oversized = 0
    db_path = Path(database_path or DB_PATH)
    try:
        client = factory(host, DEFAULT_IMAP_PORT, timeout=INBOUND_IMAP_OPERATION_TIMEOUT)
        prepare_imap_operation()
        status, _ = client.login(user, password)
        if status != "OK":
            raise InboundScanError("Mailbox authentication failed; no message content was changed.")
        prepare_imap_operation()
        status, status_data = client.status("INBOX", "(UIDNEXT)")
        if status != "OK":
            raise InboundScanError("The inbox did not provide a usable message cursor.")
        uid_next = _uidnext_from_status(status_data)
        prepare_imap_operation()
        status, select_data = client.select("INBOX", readonly=True)
        if status != "OK":
            raise InboundScanError("The inbox could not be opened in read-only mode.")
        uid_validity = _uidvalidity_from_selection(client, select_data)
        last_uid = uid_next - 1
        if last_uid < 1:
            return {
                "status": "SUCCESS", "messages_checked": 0, "replies_processed": 0,
                "bounces_processed": 0, "opt_outs_processed": 0, "unrelated": 0,
                "already_processed": 0, "oversized_skipped": 0,
            }

        first_uid = max(1, uid_next - max_messages)
        prepare_imap_operation()
        status, search_data = client.uid("search", None, f"UID {first_uid}:{last_uid}")
        if status != "OK":
            raise InboundScanError("Recent inbox messages could not be listed.")
        uid_values = (search_data or [b""])[0].split()
        selected_uids = uid_values[-max_messages:]

        connection = sqlite3.connect(str(db_path), timeout=5.0)
        connection.execute("PRAGMA busy_timeout = 5000")
        connection.row_factory = sqlite3.Row
        try:
            _init_scan_table(connection)
            required = {"prospects", "campaign_sends", "email_suppression"}
            existing = {
                row[0] for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?)",
                    tuple(required),
                )
            }
            if existing != required:
                raise InboundScanError("Local reply and suppression tables are unavailable.")

            for raw_uid in reversed(selected_uids):
                try:
                    uid = int(raw_uid)
                except (TypeError, ValueError):
                    continue
                prepare_imap_operation()
                size = _fetch_size(client, raw_uid)
                if size is None:
                    continue
                checked += 1
                if size > MAX_INBOUND_MESSAGE_BYTES:
                    connection.execute("BEGIN IMMEDIATE")
                    try:
                        _init_scan_table(connection)
                        already = connection.execute("""
                            SELECT 1 FROM inbound_scan_messages
                            WHERE mailbox_id = ? AND uid_validity = ? AND uid = ?
                        """, (mailbox_id, uid_validity, uid)).fetchone()
                        if already:
                            connection.rollback()
                            duplicates += 1
                        else:
                            connection.execute("""
                                INSERT INTO inbound_scan_messages (mailbox_id, uid_validity, uid, classification)
                                VALUES (?, ?, ?, 'SKIPPED_OVERSIZE')
                            """, (mailbox_id, uid_validity, uid))
                            connection.commit()
                            oversized += 1
                    except Exception:
                        connection.rollback()
                        raise
                    continue
                prepare_imap_operation()
                raw_message = _fetch_peek_body(client, raw_uid)
                if raw_message is None or len(raw_message) > MAX_INBOUND_MESSAGE_BYTES:
                    continue
                parsed = parse_inbound_message(raw_message)
                classification = _apply_classification(connection, uid_validity, uid, parsed, mailbox_id)
                if classification == "DUPLICATE":
                    duplicates += 1
                elif classification == "BOUNCE":
                    processed_bounces += 1
                elif classification == "OPT_OUT":
                    processed_opt_outs += 1
                elif classification == "REPLY":
                    processed_replies += 1
                else:
                    unrelated += 1
        finally:
            connection.close()

        return {
            "status": "SUCCESS", "messages_checked": checked,
            "replies_processed": processed_replies, "bounces_processed": processed_bounces,
            "opt_outs_processed": processed_opt_outs, "unrelated": unrelated,
            "already_processed": duplicates, "oversized_skipped": oversized,
        }
    except InboundScanError:
        raise
    except Exception:
        # Never propagate/log IMAP exceptions: server replies may include account
        # identifiers, command arguments, or other private mailbox details.
        raise InboundScanError("Inbound scan failed. Mailbox credentials and server details were not returned.") from None
    finally:
        if client is not None:
            try:
                sock = getattr(client, "sock", None)
                if sock is not None:
                    sock.settimeout(0.25)
                client.logout()
            except Exception:
                pass
