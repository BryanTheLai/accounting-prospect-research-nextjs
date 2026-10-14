"""Deliver one immutable, explicitly approved YC batch with durable send receipts.

The operator authorized a one-batch warmup override: 20/day, followed by
an explicit instruction to finish the remaining approved batch within an hour,
immediate schedule override, using the working Bryanlai sender. No shared
warmup settings or mailbox ages are changed. An uncertain SMTP outcome stops
the job and is never retried automatically.
"""
import argparse
import json
import os
import smtplib
import ssl
import time
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
STATE = ROOT / "operations" / "yc-approved-2026-10-05"
os.environ["OUTBOUNDER_DB_PATH"] = str(ROOT.parent / "accounting-prospect-research" / "leads.db")

from campaign_database import (get_all_mailboxes, get_db_connection,
    get_mailbox_metrics, get_sent_email_set, is_domain_in_cooldown,
    is_live_outreach_ready, log_send_event, record_mailbox_success)
from campaign_dispatcher import build_outbound_mime_message
from gov_shield import is_government_affiliated
from spintax_engine import render_email_template


def save_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def event(kind, **fields):
    row = {"at": datetime.now().astimezone().isoformat(), "event": kind, **fields}
    with (STATE / "receipts.jsonl").open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(row, ensure_ascii=False) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    print(json.dumps(row, ensure_ascii=True), flush=True)


def prepare():
    STATE.mkdir(parents=True, exist_ok=True)
    target = STATE / "approved-messages.json"
    if target.exists():
        raise RuntimeError("Approved manifest already exists; do not overwrite")
    sent = get_sent_email_set()
    with get_db_connection() as conn:
        rows = conn.execute("""SELECT p.*, a.assigned_template_id,
            t.name AS template_name, t.subject AS template_subject, t.body AS template_body
            FROM campaign_ab_assignments a JOIN prospects p ON p.lead_id=a.lead_id
            JOIN outbound_templates t ON t.template_id=a.assigned_template_id
            WHERE a.template_pair_key='88:89' ORDER BY p.lead_id""").fetchall()
    messages = []
    for row in rows:
        lead = dict(row)
        email = lead["contact_email"].strip().lower()
        if email in sent:
            continue
        if not is_live_outreach_ready(lead["lead_id"], email):
            raise RuntimeError("Recipient preflight failed")
        subject = render_email_template(lead["template_subject"], lead)
        body = render_email_template(lead["template_body"], lead)
        if "{{" in subject + body or "48 hours" in body.lower():
            raise RuntimeError("Unresolved placeholder or removed claim present")
        messages.append({"lead_id": lead["lead_id"], "email": email,
            "company": lead["company_name"], "root_domain": lead["root_domain"],
            "subject": subject, "body": body, "template_id": lead["assigned_template_id"],
            "variant_name": lead["template_name"]})
    if len(rows) != 20 or len(messages) != 13:
        raise RuntimeError("Approved cohort differs from 20 total / 13 unsent")
    batch = {"run_id": "yc-approved-2026-10-05-primary-13", "date": "2026-10-05",
        "sender": "bryanlai@openclose-desk.com", "daily_limit": 20,
        "hourly_limit": 4, "interval_seconds": 910,
        "authorization": "User approved these exact 13 corrected A/B messages and explicitly authorized accelerating remaining sends to 20 today.",
        "messages": messages}
    save_json(target, batch)
    print(json.dumps({"prepared": len(messages), "total_cohort": len(rows),
        "variants": {str(t): sum(m["template_id"] == t for m in messages) for t in (88,89)}}))


def run():
    batch = json.loads((STATE / "approved-messages.json").read_text(encoding="utf-8"))
    lock = STATE / "runner.lock"
    with lock.open("x") as stream:
        stream.write(str(os.getpid()))
    try:
        existing = []
        receipts = STATE / "receipts.jsonl"
        if receipts.exists():
            existing = [json.loads(line) for line in receipts.read_text(encoding="utf-8").splitlines()]
        resolved = {r["lead_id"] for r in existing if r["event"] == "accepted"}
        if any(r["event"] == "intent" and r["lead_id"] not in resolved for r in existing):
            raise RuntimeError("Prior uncertain SMTP attempt requires reconciliation")
        event("started", pending=len(batch["messages"]))
        last_send = max((datetime.fromisoformat(r["at"]).timestamp()
            for r in existing if r["event"] == "accepted"), default=0.0)
        for message in batch["messages"]:
            if message["lead_id"] in resolved:
                if message["email"] not in get_sent_email_set():
                    raise RuntimeError("Accepted receipt requires send-log reconciliation before resuming")
                event("skipped_receipted", lead_id=message["lead_id"])
                continue
            while True:
                if (STATE / "STOP").exists():
                    raise RuntimeError("Operator stop file exists")
                if datetime.now().strftime("%Y-%m-%d") != batch["date"]:
                    raise RuntimeError("Today-only authorization expired")
                if batch.get("deadline") and time.time() >= batch["deadline"]:
                    raise RuntimeError("Authorized one-hour deadline expired")
                app = json.load(urlopen("http://127.0.0.1:3000/api/dispatch?summary=1", timeout=5))
                if app["snapshot"]["is_running"]:
                    raise RuntimeError("Another app dispatcher is running")
                if message["email"] in get_sent_email_set():
                    event("skipped_already_sent_or_suppressed", lead_id=message["lead_id"])
                    break
                metrics = get_mailbox_metrics(batch["sender"])
                if metrics["sends_today"] >= batch["daily_limit"]:
                    raise RuntimeError("Authorized daily ceiling reached")
                if metrics["sends_this_hour"] >= batch["hourly_limit"] or time.time() < last_send + batch["interval_seconds"]:
                    time.sleep(5)
                    continue
                if not is_live_outreach_ready(message["lead_id"], message["email"]):
                    raise RuntimeError("Recipient preflight changed")
                government, _ = is_government_affiliated(company_name=message["company"],
                    root_domain=message["root_domain"], contact_email=message["email"])
                if government or is_domain_in_cooldown(message["email"].split("@")[1]):
                    raise RuntimeError("Recipient suppression / domain cooldown guard")
                mailbox = next(m for m in get_all_mailboxes() if m["email"].lower() == batch["sender"])
                if mailbox["status"] != "ACTIVE":
                    raise RuntimeError("Approved sender is not active")
                mime = build_outbound_mime_message(mailbox["sender_name"], batch["sender"],
                    message["email"], message["subject"], message["body"], mailbox["provider_type"])
                with smtplib.SMTP(mailbox["smtp_server"], mailbox["smtp_port"], timeout=30) as server:
                    server.ehlo()
                    server.starttls(context=ssl.create_default_context())
                    server.ehlo()
                    server.login(mailbox["smtp_user"], mailbox["smtp_password"])
                    event("intent", lead_id=message["lead_id"], message_id=mime["Message-ID"])
                    refused = server.sendmail(batch["sender"], [message["email"]], mime.as_string())
                    if refused:
                        raise RuntimeError("Recipient refused")
                    event("accepted", lead_id=message["lead_id"], message_id=mime["Message-ID"])
                    log_send_event(message["lead_id"], message["email"], message["company"],
                        message["subject"], "SENT", 250, "250 Microsoft SMTP accepted; operator-approved one-batch warmup/schedule override",
                        body=message["body"], sender_email=batch["sender"], run_id=batch["run_id"],
                        variant_name=message["variant_name"], template_id=message["template_id"])
                    record_mailbox_success(mailbox["mailbox_id"])
                    last_send = time.time()
                break
        event("completed", sends_today=get_mailbox_metrics(batch["sender"])["sends_today"])
    except Exception as error:
        event("stopped_error", error_type=type(error).__name__)
        raise
    finally:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("prepare", "send-approved"))
    args = parser.parse_args()
    if args.action == "prepare":
        prepare()
    else:
        run()
