"""
In-Process Background Campaign Dispatcher with Multi-Mailbox Pool Rotation & Failover
Path: campaign_dispatcher.py
"""
import os
import math
import time
import random
import smtplib
import threading
import base64
import uuid
import struct
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from typing import Dict, Any, List, Optional, Tuple
from dotenv import load_dotenv

load_dotenv()

from spintax_engine import render_email_template, validate_company_name
from campaign_schedule import CampaignSchedule, is_within_campaign_hours, next_campaign_opening
from campaign_database import (
    log_send_event,
    get_sends_today_count,
    get_sends_last_hour_count,
    is_domain_in_cooldown,
    get_recent_send_logs,
    get_sent_email_set,
    get_available_mailbox,
    get_mailbox_metrics,
    record_mailbox_success,
    record_mailbox_cooldown,
    record_mailbox_error,
    get_all_mailboxes,
    get_all_campaigns,
    get_campaign_schedule_for_lead,
    get_or_create_campaign_ab_assignments,
    init_campaign_tables,
    is_live_outreach_ready,
)
from config import (
    DOMAIN_COOLDOWN_HOURS,
    ENABLE_LIVE_DISPATCH_DEFAULT,
    CONSECUTIVE_DEFERRAL_CIRCUIT_BREAKER,
    is_live_dispatch_enabled,
    set_live_dispatch_enabled
)
from warmup_ramper import enforce_warmup_limits
from gov_shield import is_government_affiliated
from email_verifier import detect_domain_esp
import dispatch_queue
from campaign_database import next_mailbox_slot

@contextmanager
def _smtp_session(host, port):
    session = smtplib.SMTP(host, port, timeout=25)
    server = session.__enter__()
    try:
        yield server
    finally:
        try:
            session.__exit__(None, None, None)
        except (smtplib.SMTPException, OSError):
            session.close()


def _campaign_schedule_closed_message(schedule: Optional[Dict[str, Any]]) -> Optional[str]:
    if not schedule:
        return None
    campaign_schedule = CampaignSchedule(
        timezone_name=str(schedule.get("timezone_name") or schedule.get("schedule_timezone") or ""),
        start_minute=int(schedule.get("start_minute", schedule.get("schedule_start_minute"))),
        end_minute=int(schedule.get("end_minute", schedule.get("schedule_end_minute"))),
    )
    now = datetime.now(timezone.utc)
    if is_within_campaign_hours(campaign_schedule, now):
        return None
    opening = next_campaign_opening(campaign_schedule, now)
    local_now = now.astimezone(campaign_schedule.timezone)
    return f"Outside campaign hours ({local_now.strftime('%a %H:%M %Z')}); opens {opening.strftime('%a %Y-%m-%d %H:%M %Z')}."

def calculate_human_delay(min_delay: float = 90.0, max_delay: float = 240.0) -> float:
    """
    Simulates human inter-arrival delays using a smooth bounded Beta distribution
    (alpha=2.5, beta=3.0) with Gaussian micro-jitter. Eliminates boundary spike
    clustering at 90s/240s while strictly enforcing bounds.
    """
    span = max(1.0, max_delay - min_delay)
    val = min_delay + random.betavariate(2.5, 3.0) * span
    micro_noise = random.gauss(0, 2.0)
    final_delay = max(min_delay, min(max_delay, val + micro_noise))
    return round(final_delay, 1)

def generate_outlook_thread_index() -> str:
    """Generates authentic 22-byte base64 binary Thread-Index header for Microsoft Outlook."""
    now_ft = int((datetime.now(timezone.utc).timestamp() + 11644473600) * 10000000)
    ft_bytes = struct.pack(">Q", now_ft)[2:]  # 6 bytes timestamp
    guid_bytes = uuid.uuid4().bytes            # 16 bytes GUID
    return base64.b64encode(ft_bytes + guid_bytes).decode("ascii")

def build_outbound_mime_message(
    sender_name: str,
    from_email: str,
    recipient_email: str,
    subject: str,
    body: str,
    provider_type: str = "MICROSOFT"
) -> EmailMessage:
    """
    Constructs an authentic MIME message formatted specifically to match
    the declared ESP provider (Microsoft 365 vs Google Workspace),
    eliminating standard Python smtplib bot signatures (no fake multipart wrapper,
    no base64 encoding on pure text, authentic Outlook Thread-Index).
    """
    msg = EmailMessage()
    # Single-part plain text: avoid base64 tell (use 7bit for ASCII or quoted-printable for UTF-8)
    cte = "7bit" if all(ord(c) < 128 for c in body) else "quoted-printable"
    msg.set_content(body, subtype="plain", charset="utf-8", cte=cte)

    msg["From"] = f"{sender_name} <{from_email}>"
    msg["To"] = recipient_email
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    
    domain_part = from_email.split("@")[-1] if "@" in from_email else "openclose-desk.com"
    msg["Message-ID"] = make_msgid(domain=domain_part)

    p_type = (provider_type or "MICROSOFT").upper()
    if p_type == "MICROSOFT":
        # Authentic Outlook / Exchange Online desktop client headers
        msg["X-Mailer"] = "Microsoft Outlook 16.0"
        msg["Thread-Topic"] = subject
        msg["Thread-Index"] = generate_outlook_thread_index()
        msg["X-Priority"] = "3"
        msg["Accept-Language"] = "en-US, en"
        msg["Content-Language"] = "en-US"
    elif p_type == "GOOGLE":
        # Google Workspace webmail clients send clean RFC 5322 headers without X-Mailer.
        # Adding a fake X-Mailer to a Google Workspace relay is an automated bot tell.
        pass
    else:
        # Standard clean corporate MTA
        msg["X-Priority"] = "3"

    return msg

class CampaignDispatcher:
    def __init__(self):
        init_campaign_tables()
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._schedule_override_event = threading.Event()
        self._limits_changed_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._run_id: Optional[str] = None

        self.state: Dict[str, Any] = {
            "is_running": False,
            "is_paused": False,
            "status_text": "Idle",
            "daily_limit": 100,
            "hourly_limit": 30,
            "min_delay": 60,
            "max_delay": 120,
            "business_hours_only": True,
            "schedule_override_active": False,
            "biz_start_hour": 9,
            "biz_end_hour": 17,
            "biz_end_min": 30,
            "schedule_timezone": "Asia/Singapore",
            "schedule_start_minute": 9 * 60,
            "schedule_end_minute": 17 * 60 + 30,
            "sent_today": 0,
            "sent_this_hour": 0,
            "queue_pending": 0,
            "current_lead_name": "",
            "current_lead_email": "",
            "active_sender_email": "",
            "next_send_timestamp": 0.0,
            "last_error": None,
            "wait_reason": "idle",
            "live_dispatch": is_live_dispatch_enabled()
        }

    def set_live_dispatch(self, enabled: bool):
        with self._lock:
            self.state["live_dispatch"] = bool(enabled)
            set_live_dispatch_enabled(bool(enabled))

    def update_settings(self, daily_limit: int, hourly_limit: int, min_delay: int, max_delay: int, biz_hours: bool, live_dispatch: Optional[bool] = None):
        with self._lock:
            self.state["daily_limit"] = daily_limit
            self.state["hourly_limit"] = hourly_limit
            self.state["min_delay"] = max(60, min_delay)
            self.state["max_delay"] = max(min_delay + 30, max_delay)
            self.state["business_hours_only"] = biz_hours
            if live_dispatch is not None:
                self.state["live_dispatch"] = bool(live_dispatch)
                set_live_dispatch_enabled(bool(live_dispatch))

    def is_within_business_hours(self, schedule: Optional[Dict[str, Any]] = None) -> Tuple[bool, str]:
        """Apply one campaign's weekday window in its configured IANA timezone."""
        values = schedule or {
            "timezone_name": self.state["schedule_timezone"],
            "start_minute": self.state["schedule_start_minute"],
            "end_minute": self.state["schedule_end_minute"],
        }
        campaign_schedule = CampaignSchedule(
            timezone_name=str(values.get("timezone_name") or values.get("schedule_timezone") or ""),
            start_minute=int(values.get("start_minute", values.get("schedule_start_minute"))),
            end_minute=int(values.get("end_minute", values.get("schedule_end_minute"))),
        )
        now = datetime.now(timezone.utc)
        if is_within_campaign_hours(campaign_schedule, now):
            return True, "Within campaign business hours."
        opening = next_campaign_opening(campaign_schedule, now)
        local_now = now.astimezone(campaign_schedule.timezone)
        return False, f"Outside campaign hours ({local_now.strftime('%a %H:%M %Z')}); opens {opening.strftime('%a %Y-%m-%d %H:%M %Z')}."

    def _schedule_closed_message(self, schedule: Optional[Dict[str, Any]]) -> Optional[str]:
        if self._schedule_override_event.is_set():
            return None
        return _campaign_schedule_closed_message(schedule)

    def override_current_schedule(self) -> None:
        with self._lock:
            if not self.state["is_running"]:
                raise RuntimeError("There is no active dispatch run")
            if self.state["is_paused"]:
                raise RuntimeError("Resume the paused run before overriding its schedule")
            if self.state["queue_pending"] < 1:
                raise RuntimeError("There are no pending recipients in the active run")
            if self._schedule_override_event.is_set():
                return
            self._schedule_override_event.set()
            self.state["schedule_override_active"] = True
            self.state["status_text"] = "Active (campaign schedule overridden for this run)"
            if self.state["wait_reason"] == "schedule":
                self.state["next_send_timestamp"] = 0
                self.state["wait_reason"] = "recovering"
                dispatch_queue.update_run(self._run_id, next_send_at=0, wait_reason="recovering")
            dispatch_queue.update_run(self._run_id, schedule_override=True)

    def start_campaign(self, leads: List[Dict[str, Any]], subject_tmpl: str, body_tmpl: str, variants: Optional[List[Dict[str, Any]]] = None, schedule: Optional[Dict[str, Any]] = None):
        with self._lock:
            if self.state["is_running"]:
                return None
            if self._thread is not None and self._thread.is_alive():
                raise RuntimeError("The previous sender is still finishing; wait before starting another run")

            sent_emails = get_sent_email_set()
            campaign_schedules = {}
            for campaign in get_all_campaigns():
                campaign_id = str(campaign.get("campaign_id") or "")
                if not campaign_id:
                    continue
                campaign_schedule = {
                    "timezone_name": str(campaign.get("schedule_timezone") or "Asia/Singapore"),
                    "start_minute": int(campaign.get("schedule_start_minute", 9 * 60)),
                    "end_minute": int(campaign.get("schedule_end_minute", 17 * 60 + 30)),
                }
                CampaignSchedule(**campaign_schedule)
                campaign_schedules[campaign_id] = campaign_schedule
            run_schedule = schedule or {
                "timezone_name": "Asia/Singapore",
                "start_minute": 9 * 60,
                "end_minute": 17 * 60 + 30,
            }
            CampaignSchedule(
                timezone_name=run_schedule["timezone_name"],
                start_minute=run_schedule["start_minute"],
                end_minute=run_schedule["end_minute"],
            )
            pending_leads = []
            for l in leads:
                em = (l.get("contact_email") or l.get("email", "")).strip().lower()
                c_name = l.get("company_name", "")
                r_dom = l.get("root_domain", "")
                if not em or em in sent_emails:
                    continue
                is_gov, _ = is_government_affiliated(company_name=c_name, root_domain=r_dom, contact_email=em)
                if is_gov:
                    continue
                queued_lead = dict(l)
                campaign_id = str(queued_lead.get("campaign_id") or "")
                lead_schedule = queued_lead.get("_campaign_schedule")
                if not isinstance(lead_schedule, dict):
                    lead_schedule = campaign_schedules.get(campaign_id) or schedule or run_schedule
                if isinstance(lead_schedule, dict):
                    normalized_schedule = {
                        "timezone_name": str(lead_schedule.get("timezone_name") or lead_schedule.get("schedule_timezone") or ""),
                        "start_minute": int(lead_schedule.get("start_minute", lead_schedule.get("schedule_start_minute"))),
                        "end_minute": int(lead_schedule.get("end_minute", lead_schedule.get("schedule_end_minute"))),
                    }
                    CampaignSchedule(**normalized_schedule)
                    queued_lead["_campaign_schedule"] = normalized_schedule
                pending_leads.append(queued_lead)

            variant_counts = None
            if variants:
                if len(variants) != 2 or len(pending_leads) < 1:
                    raise ValueError("A/B runs require two variants and at least one eligible recipient")
                saved_assignments = get_or_create_campaign_ab_assignments(pending_leads, variants)
                variants_by_template_id = {int(variant["template_id"]): variant for variant in variants}
                run_id = str(uuid.uuid4())
                variant_counts = {variant["name"]: 0 for variant in variants}
                for lead in pending_leads:
                    campaign_id = str(lead.get("campaign_id") or "__uncategorized__").strip() or "__uncategorized__"
                    lead_id = str(lead.get("lead_id") or lead.get("contact_email") or lead.get("email") or "").strip()
                    template_id = saved_assignments.get((campaign_id, lead_id))
                    variant = variants_by_template_id.get(template_id)
                    if variant is None:
                        raise RuntimeError("Could not load the saved A/B template assignment")
                    lead["_ab_run_id"] = run_id
                    lead["_ab_variant_name"] = variant["name"]
                    lead["_ab_template_id"] = int(variant["template_id"])
                    lead["_ab_subject_tmpl"] = variant["subject"]
                    lead["_ab_body_tmpl"] = variant["body"]
                    variant_counts[variant["name"]] += 1
                random.shuffle(pending_leads)

            run_id = pending_leads[0].get("_ab_run_id") if pending_leads else None
            run_id = run_id or str(uuid.uuid4())
            for lead in pending_leads:
                lead["_ab_run_id"] = run_id
                lead["_queued_subject"] = render_email_template(lead.get("_ab_subject_tmpl", subject_tmpl), lead)
                lead["_queued_body"] = render_email_template(lead.get("_ab_body_tmpl", body_tmpl), lead)
            settings = {key: self.state[key] for key in (
                "min_delay", "max_delay", "business_hours_only", "schedule_timezone", "schedule_start_minute", "schedule_end_minute"
            )}
            settings.update(schedule_timezone=run_schedule["timezone_name"],
                            schedule_start_minute=run_schedule["start_minute"],
                            schedule_end_minute=run_schedule["end_minute"])
            dispatch_queue.create_run(run_id, pending_leads, settings, live=is_live_dispatch_enabled())
            self._run_id = run_id
            self._stop_event.clear()
            self._pause_event.set()
            self._schedule_override_event.clear()
            self.state["schedule_override_active"] = False
            self.state["is_running"] = True
            self.state["is_paused"] = False
            self.state["queue_pending"] = len(pending_leads)
            self.state["schedule_timezone"] = run_schedule["timezone_name"]
            self.state["schedule_start_minute"] = run_schedule["start_minute"]
            self.state["schedule_end_minute"] = run_schedule["end_minute"]
            self.state["status_text"] = "Active"
            self.state["last_error"] = None

            self._thread = threading.Thread(
                target=self._run_worker,
                args=(pending_leads, subject_tmpl, body_tmpl),
                daemon=True,
                name="ColdEmailWorkerThread"
            )
            self._thread.start()
            return variant_counts

    def pause_campaign(self):
        recover_worker = False
        with self._lock:
            if not self.state["is_running"]:
                return
            if self.state["is_paused"]:
                self._pause_event.set()
                self.state["is_paused"] = False
                self.state["status_text"] = "Active"
                dispatch_queue.update_run(self._run_id, status="ACTIVE")
                recover_worker = bool(self._thread and not self._thread.is_alive())
            else:
                self._pause_event.clear()
                self.state["is_paused"] = True
                self.state["status_text"] = "Paused"
                dispatch_queue.update_run(self._run_id, status="PAUSED")
        if recover_worker:
            self.recover_saved_campaign()

    def stop_campaign(self):
        with self._lock:
            self._stop_event.set()
            self._pause_event.set()
            self.state["is_running"] = False
            self.state["is_paused"] = False
            self.state["queue_pending"] = 0
            self.state["status_text"] = "Stopped (Emergency)"
            self.state["next_send_timestamp"] = 0.0
            self.state["wait_reason"] = "stopped"
            dispatch_queue.update_run(self._run_id, status="STOPPED", next_send_at=0)
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=30)
            if self._thread.is_alive():
                raise RuntimeError("The previous SMTP attempt is still finishing; wait before starting another run")

    def recover_saved_campaign(self):
        saved = dispatch_queue.recover_run(include_paused=True)
        if not saved:
            return False
        self._run_id = saved["run_id"]
        self.state.update(saved["settings"])
        self.set_live_dispatch(saved["live"])
        self.state.update(is_running=True, is_paused=saved["status"] == "PAUSED",
                          queue_pending=len(saved["leads"]), next_send_timestamp=saved["next_send_at"],
                          schedule_override_active=saved["schedule_override"], wait_reason=saved["wait_reason"], last_error=None)
        if saved["schedule_override"]:
            self._schedule_override_event.set()
        if saved["status"] != "PAUSED":
            self._pause_event.set()
        self._thread = threading.Thread(target=self._run_worker,
                                       args=(saved["leads"], "", ""), daemon=True,
                                       name="RecoveredEmailWorkerThread")
        self._thread.start()
        return True

    def _run_worker(self, leads, subject_tmpl, body_tmpl):
        try:
            self._worker_loop(leads, subject_tmpl, body_tmpl)
        except Exception:
            if self._stop_event.is_set():
                dispatch_queue.update_run(self._run_id, status="STOPPED")
                return
            with self._lock:
                self.state.update(is_running=True, is_paused=True, last_error="Worker failed; saved queue retained",
                                  wait_reason="worker_error", next_send_timestamp=0)
            self._pause_event.clear()
            dispatch_queue.update_run(self._run_id, status="PAUSED")

    def _wait_until(self, reason, timestamp):
        with self._lock:
            self.state.update(wait_reason=reason, next_send_timestamp=timestamp)
        dispatch_queue.update_run(self._run_id, next_send_at=timestamp, wait_reason=reason)
        while time.time() < timestamp and not self._stop_event.is_set():
            if reason in ("daily_quota", "hourly_quota", "mailbox_unavailable", "provider_cooldown") and self._limits_changed_event.is_set():
                self._limits_changed_event.clear()
                break
            if reason == "schedule" and self._schedule_override_event.is_set():
                break
            self._stop_event.wait(min(0.5, max(0, timestamp - time.time())))

    def mailbox_limits_changed(self):
        self._limits_changed_event.set()

    def _queue_item_status(self, lead_id, status):
        dispatch_queue.set_item_status(self._run_id, lead_id, status)

    def get_snapshot(self) -> Dict[str, Any]:
        with self._lock:
            snap = dict(self.state)
            snap["sent_today"] = get_sends_today_count()
            snap["sent_this_hour"] = get_sends_last_hour_count()
            snap.update(dispatch_queue.run_summary(self._run_id))
            return snap

    def _worker_loop(self, leads: List[Dict[str, Any]], subject_tmpl: str, body_tmpl: str):
        queue = list(leads)
        lead_deferral_counts: Dict[str, int] = {}
        if queue and self.state["next_send_timestamp"] > time.time():
            reason = self.state["wait_reason"]
            self._wait_until(reason if reason in ("hourly_quota", "daily_quota", "provider_cooldown", "schedule") else "spacing",
                             self.state["next_send_timestamp"])

        while queue and not self._stop_event.is_set():
            self._pause_event.wait()
            if self._stop_event.is_set():
                break

            lead = queue[0]
            # 1. Business Hours Gatekeeper
            lead_schedule = lead.get("_campaign_schedule")
            schedule_to_enforce = lead_schedule or ({
                "timezone_name": self.state["schedule_timezone"],
                "start_minute": self.state["schedule_start_minute"],
                "end_minute": self.state["schedule_end_minute"],
            } if self.state["business_hours_only"] else None)
            if schedule_to_enforce:
                reason = self._schedule_closed_message(schedule_to_enforce)
                if reason:
                    with self._lock:
                        self.state["status_text"] = f"Sleeping: {reason}"
                    opening = next_campaign_opening(CampaignSchedule(**schedule_to_enforce), datetime.now(timezone.utc))
                    self._wait_until("schedule", opening.timestamp())
                    continue

            recipient_email = (lead.get("contact_email") or lead.get("email", "")).strip()
            company_name = lead.get("company_name", "Valued Partner")
            lead_id = str(lead.get("lead_id", recipient_email))

            def log_event(*args, **kwargs):
                kwargs.setdefault("run_id", lead.get("_ab_run_id"))
                kwargs.setdefault("variant_name", lead.get("_ab_variant_name"))
                kwargs.setdefault("template_id", lead.get("_ab_template_id"))
                log_send_event(*args, **kwargs)
                if len(args) > 4 and args[4] in ("SENT", "BOUNCED", "FAILED", "SUPPRESSED", "DEFERRED_MAX_RETRIES"):
                    self._queue_item_status(lead_id, args[4])

            try:
                validate_company_name(company_name)
            except ValueError as e:
                log_event(lead_id, recipient_email, company_name, "RENDER_ERROR", "FAILED", response_msg=str(e))
                queue.pop(0)
                continue

            if not recipient_email or "@" not in recipient_email:
                self._queue_item_status(lead_id, "INVALID")
                queue.pop(0)
                continue

            # Detect recipient ESP for intelligent routing (Google vs Microsoft)
            target_esp = detect_domain_esp(recipient_email)

            # 2. Multi-Mailbox Pool Selection with ESP matching, Quota Gating & Warmup Ceiling
            mailbox = get_available_mailbox(preferred_provider=target_esp)
            if mailbox:
                mailbox = enforce_warmup_limits(
                    mailbox,
                    default_min_delay=self.state["min_delay"],
                    default_max_delay=self.state["max_delay"],
                )
                metrics = get_mailbox_metrics(mailbox["email"])
                if metrics["sends_today"] >= mailbox["daily_limit"] or metrics["sends_this_hour"] >= mailbox["hourly_limit"]:
                    mailbox = None

            if not mailbox:
                # Check if we have env fallback when pool is empty
                env_user = os.getenv("SMTP_USER", "")
                env_pass = os.getenv("SMTP_PASSWORD", "")
                if env_user and env_pass:
                    # Synthetic mailbox from .env
                    raw_mb = {
                        "mailbox_id": 0,
                        "email": env_user,
                        "smtp_server": os.getenv("SMTP_SERVER", "smtp.office365.com"),
                        "smtp_port": int(os.getenv("SMTP_PORT", 587)),
                        "smtp_user": env_user,
                        "smtp_password": env_pass,
                        "sender_name": os.getenv("SENDER_NAME", "Bryan @ Outbounder"),
                        "daily_limit": self.state["daily_limit"],
                        "hourly_limit": self.state["hourly_limit"],
                        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                    }
                    mailbox = enforce_warmup_limits(
                        raw_mb,
                        default_min_delay=self.state["min_delay"],
                        default_max_delay=self.state["max_delay"],
                    )
                    metrics = get_mailbox_metrics(env_user)
                    if metrics["sends_today"] >= mailbox["daily_limit"] or metrics["sends_this_hour"] >= mailbox["hourly_limit"]:
                        mailbox = None
                if not mailbox:
                    with self._lock:
                        self.state["status_text"] = "All mailboxes at hourly/daily quota or cooling down. Waiting 5m..."
                    slot = next_mailbox_slot()
                    self._wait_until(slot["reason"], slot["timestamp"])
                    continue

            recipient_domain = recipient_email.split("@")[-1].lower()

            # 3. Government & Public Sector Entity Shield
            is_gov, gov_reason = is_government_affiliated(
                company_name=company_name,
                root_domain=lead.get("root_domain") or recipient_domain,
                contact_email=recipient_email
            )
            if is_gov:
                log_event(lead_id, recipient_email, company_name, "Government shield", "SUPPRESSED", response_msg=f"Government shield: {gov_reason}")
                queue.pop(0)
                continue

            # 4. 48-Hour Domain Cooldown Guard (Freemail domains exempted)
            if is_domain_in_cooldown(recipient_domain, DOMAIN_COOLDOWN_HOURS):
                log_event(lead_id, recipient_email, company_name, "Domain cooldown", "SUPPRESSED", response_msg=f"Domain @{recipient_domain} in 48h cooldown")
                queue.pop(0)
                continue

            with self._lock:
                self.state["current_lead_name"] = company_name
                self.state["current_lead_email"] = recipient_email
                self.state["active_sender_email"] = mailbox["email"]
                self.state["status_text"] = f"Sending from {mailbox['email']} to {company_name}..."

            # 4. Spintax Rendering
            try:
                subject = lead.get("_queued_subject") or render_email_template(lead.get("_ab_subject_tmpl", subject_tmpl), lead)
                body = lead.get("_queued_body") or render_email_template(lead.get("_ab_body_tmpl", body_tmpl), lead)
            except Exception as e:
                log_event(lead_id, recipient_email, company_name, "RENDER_ERROR", "FAILED", response_msg=str(e))
                queue.pop(0)
                continue

            # 5. Authenticated Dispatch with Dynamic Failover (Guarded by Live Send Safety Gate)
            send_success = False
            exclude_mailbox_ids = []
            schedule_closed = False

            # Safety Gate: If live dispatch is disabled, record dry-run 250 OK and do not connect to SMTP
            # The environment gate is authoritative; a stale in-memory toggle must never enable SMTP.
            live_dispatch_enabled = is_live_dispatch_enabled()
            if not live_dispatch_enabled:
                send_success = True
                if mailbox.get("mailbox_id", 0) > 0:
                    record_mailbox_success(mailbox["mailbox_id"])
                log_event(lead_id, recipient_email, company_name, subject, "SENT", 250, "[DRY-RUN SAFETY SHIELD] Simulated send accepted (Live sending gated)", body=body, sender_email=mailbox["email"])
                queue.pop(0)
            elif not is_live_outreach_ready(lead_id, recipient_email):
                send_success = True
                log_event(
                    lead_id,
                    recipient_email,
                    company_name,
                    subject,
                    "SUPPRESSED",
                    "PREFLIGHT_BLOCKED",
                    response_msg="Live send blocked: current email lacks matching, approved MX/source preflight, or is suppressed/already sent.",
                    sender_email=mailbox["email"],
                )
                queue.pop(0)

            while mailbox and not send_success and not self._stop_event.is_set():
                lead_schedule = lead.get("_campaign_schedule")
                schedule_to_enforce = lead_schedule or ({
                    "timezone_name": self.state["schedule_timezone"],
                    "start_minute": self.state["schedule_start_minute"],
                    "end_minute": self.state["schedule_end_minute"],
                } if self.state["business_hours_only"] else None)
                if schedule_to_enforce:
                    reason = self._schedule_closed_message(schedule_to_enforce)
                    if reason:
                        with self._lock:
                            self.state["status_text"] = f"Sleeping: {reason}"
                        schedule_closed = True
                        break
                try:
                    accepted_by_smtp = False
                    with _smtp_session(mailbox["smtp_server"], mailbox["smtp_port"]) as server:
                        server.ehlo()
                        server.starttls()
                        server.ehlo()
                        server.login(mailbox["smtp_user"], mailbox["smtp_password"])

                        # Inbound scans can move a queued prospect out of the
                        # approved stage while this worker waits or authenticates.
                        # Recheck durable eligibility at the last point before
                        # sendmail so replies and opt-outs stop this recipient.
                        if not is_live_outreach_ready(lead_id, recipient_email):
                            log_event(
                                lead_id,
                                recipient_email,
                                company_name,
                                subject,
                                "SUPPRESSED",
                                "INBOUND_OR_ELIGIBILITY_CHANGED",
                                response_msg="Recipient no longer passes current live-send eligibility; skipped before SMTP send.",
                                sender_email=mailbox["email"],
                            )
                            send_success = True
                            queue.pop(0)
                            break

                        # SMTP authentication can cross the end of the window. Recheck
                        # immediately before the message leaves this process.
                        if schedule_to_enforce:
                            reason = self._schedule_closed_message(schedule_to_enforce)
                            if reason:
                                with self._lock:
                                    self.state["status_text"] = f"Sleeping: {reason}"
                                schedule_closed = True
                                break

                        msg = build_outbound_mime_message(
                            sender_name=mailbox["sender_name"],
                            from_email=mailbox["email"],
                            recipient_email=recipient_email,
                            subject=subject,
                            body=body,
                            provider_type=mailbox.get("provider_type", "MICROSOFT")
                        )

                        with self._lock:
                            if self._stop_event.is_set() or not self._pause_event.is_set():
                                schedule_closed = True
                                break
                            self._queue_item_status(lead_id, "IN_FLIGHT")
                            self.state.update(wait_reason="sending", next_send_timestamp=0)
                        server.sendmail(mailbox["email"], [recipient_email], msg.as_string())
                        accepted_by_smtp = True
                        log_event(lead_id, recipient_email, company_name, subject, "SENT", 250, "250 Message accepted", body=body, sender_email=mailbox["email"])
                        send_success = True
                        queue.pop(0)
                        if mailbox.get("mailbox_id", 0) > 0:
                            record_mailbox_success(mailbox["mailbox_id"])

                except smtplib.SMTPResponseException as e:
                    if accepted_by_smtp:
                        if not send_success:
                            raise
                        break
                    code, msg_err = e.smtp_code, e.smtp_error.decode("utf-8", errors="ignore")
                    if not 400 <= code < 600:
                        self._queue_item_status(lead_id, "UNCERTAIN")
                        log_event(lead_id, recipient_email, company_name, subject, "ERROR", code,
                                  "SMTP response was not a definite acceptance or rejection; held for review", sender_email=mailbox["email"])
                        queue.pop(0)
                        break
                    self._queue_item_status(lead_id, "PENDING")
                    
                    # 4xx Rate Limit / Deferral: Place mailbox in 15m cooldown, failover to next mailbox!
                    if 400 <= code < 500:
                        if mailbox.get("mailbox_id", 0) > 0:
                            record_mailbox_cooldown(mailbox["mailbox_id"], duration_minutes=15, error_code=code, error_msg=msg_err)
                            exclude_mailbox_ids.append(mailbox["mailbox_id"])
                        log_event(lead_id, recipient_email, company_name, subject, "DEFERRED", code, f"{msg_err} (Mailbox cooldown)", sender_email=mailbox["email"])
                        
                        lead_deferral_counts[lead_id] = lead_deferral_counts.get(lead_id, 0) + 1
                        if lead_deferral_counts[lead_id] >= CONSECUTIVE_DEFERRAL_CIRCUIT_BREAKER:
                            log_event(lead_id, recipient_email, company_name, subject, "DEFERRED_MAX_RETRIES", code, f"Exceeded max deferrals ({CONSECUTIVE_DEFERRAL_CIRCUIT_BREAKER}): {msg_err}", sender_email=mailbox["email"])
                            queue.pop(0)
                            break

                        mailbox = get_available_mailbox(exclude_ids=exclude_mailbox_ids)
                        if not mailbox:
                            # All available mailboxes deferred on this lead; rotate to end of queue so other leads are not starved!
                            queue.append(queue.pop(0))
                            break
                    
                    # 5xx Errors: Differentiate Sender Block vs Recipient Hard Bounce vs Auth Error
                    else:
                        is_sender_block = any(k in msg_err.lower() for k in [
                            "spamhaus", "barracuda", "reputation", "blacklist", "5.7.1", "5.7.509", "access denied", "policy rejection", "tenant"
                        ])
                        is_hard_bounce = (
                            code in (550, 551, 552, 553, 554) and not is_sender_block
                        ) or any(k in msg_err.lower() for k in [
                            "user unknown", "unknown user", "recipient address rejected", "user does not exist",
                            "no such user", "mailbox unavailable", "invalid recipient", "5.1.1", "5.1.2", "not found",
                            "disabled", "does not exist", "mailbox not found"
                        ])

                        if "sendasdenied" in msg_err.lower() or "not allowed to send as" in msg_err.lower():
                            if mailbox.get("mailbox_id", 0) > 0:
                                record_mailbox_error(mailbox["mailbox_id"], error_code=code, error_msg=msg_err)
                                exclude_mailbox_ids.append(mailbox["mailbox_id"])
                            log_event(lead_id, recipient_email, company_name, subject, "SENDER_AUTH_ERROR", code, msg_err, sender_email=mailbox["email"])
                            mailbox = get_available_mailbox(exclude_ids=exclude_mailbox_ids)
                            if not mailbox:
                                queue.append(queue.pop(0))
                                break
                        elif is_sender_block:
                            # Sender reputation / IP issue: cooldown mailbox, do not burn the lead
                            if mailbox.get("mailbox_id", 0) > 0:
                                record_mailbox_cooldown(mailbox["mailbox_id"], duration_minutes=60, error_code=code, error_msg=msg_err)
                                exclude_mailbox_ids.append(mailbox["mailbox_id"])
                            log_event(lead_id, recipient_email, company_name, subject, "REPUTATION_BLOCK", code, f"{msg_err} (Mailbox reputation cooldown)", sender_email=mailbox["email"])
                            mailbox = get_available_mailbox(exclude_ids=exclude_mailbox_ids)
                            if not mailbox:
                                queue.append(queue.pop(0))
                                break
                        elif is_hard_bounce:
                            # Hard Bounce (550): Permanent suppression and drop lead
                            log_event(lead_id, recipient_email, company_name, subject, "BOUNCED", code, msg_err, sender_email=mailbox["email"])
                            queue.pop(0)
                            break
                        elif code in (534, 535):
                            # Auth error (535): Mark mailbox as ERROR, failover to next mailbox!
                            if mailbox.get("mailbox_id", 0) > 0:
                                record_mailbox_error(mailbox["mailbox_id"], error_code=code, error_msg=msg_err)
                                exclude_mailbox_ids.append(mailbox["mailbox_id"])
                            log_event(lead_id, recipient_email, company_name, subject, "AUTH_ERROR", code, msg_err, sender_email=mailbox["email"])
                            mailbox = get_available_mailbox(exclude_ids=exclude_mailbox_ids)
                            if not mailbox:
                                queue.append(queue.pop(0))
                                break
                        else:
                            log_event(lead_id, recipient_email, company_name, subject, "FAILED", code, msg_err, sender_email=mailbox["email"])
                            queue.pop(0)
                            break

                except Exception as ex:
                    if accepted_by_smtp:
                        if not send_success:
                            raise
                        break
                    self._queue_item_status(lead_id, "UNCERTAIN")
                    log_event(lead_id, recipient_email, company_name, subject, "ERROR", response_msg=str(ex), sender_email=mailbox["email"])
                    queue.pop(0)
                    break

            with self._lock:
                self.state["queue_pending"] = len(queue)

            if schedule_closed:
                continue

            # One spacing policy; hourly/daily caps remain authoritative.
            if not self._stop_event.is_set() and queue:
                pacing_mailbox = enforce_warmup_limits(
                    mailbox, default_min_delay=self.state["min_delay"],
                    default_max_delay=self.state["max_delay"],
                ) if mailbox else {}
                delay = calculate_human_delay(
                    pacing_mailbox.get("effective_min_delay_seconds", self.state["min_delay"]),
                    pacing_mailbox.get("effective_max_delay_seconds", self.state["max_delay"]),
                )

                target_time = time.time() + delay
                with self._lock:
                    self.state["next_send_timestamp"] = target_time
                    self.state["status_text"] = f"Cooling down. Next dispatch in {int(delay)}s..."

                self._wait_until("spacing", target_time)

        with self._lock:
            self.state["is_running"] = False
            self.state["queue_pending"] = 0
            self.state["next_send_timestamp"] = 0.0
            if not self.state["is_paused"]:
                self.state["status_text"] = "Completed / Idle"
            self.state["wait_reason"] = "stopped" if self._stop_event.is_set() else "completed"
        if not self._stop_event.is_set():
            dispatch_queue.update_run(self._run_id, status="COMPLETED", next_send_at=0)

def send_single_email(
    recipient_email: str,
    company_name: str,
    subject: str,
    body: str,
    lead_id: str = "manual_preview",
    sender_email: Optional[str] = None,
    is_personal_preview_test: bool = False
) -> Tuple[bool, str]:
    """
    Directly dispatches 1 individual email via authenticated M365 SMTP.
    Uses the specified mailbox, an available pool mailbox, or .env fallback.
    Under default configuration (ENABLE_LIVE_DISPATCH=False), every outbound transmission
    is simulated. Live prospect sends also require a current, approved email preflight.
    """
    load_dotenv()
    
    # Check pool first
    pool_boxes = get_all_mailboxes()
    target_box = None
    if sender_email:
        target_box = next((b for b in pool_boxes if b["email"].lower() == sender_email.lower()), None)
    if not target_box and pool_boxes:
        target_esp = detect_domain_esp(recipient_email)
        target_box = get_available_mailbox(preferred_provider=target_esp) or pool_boxes[0]

    if target_box:
        smtp_server = target_box["smtp_server"]
        smtp_port = target_box["smtp_port"]
        smtp_user = target_box["smtp_user"]
        smtp_pass = target_box["smtp_password"]
        sender_name = target_box["sender_name"]
        from_email = target_box["email"]
    else:
        smtp_server = os.getenv("SMTP_SERVER", "smtp.office365.com")
        smtp_port = int(os.getenv("SMTP_PORT", 587))
        smtp_user = os.getenv("SMTP_USER", "")
        smtp_pass = os.getenv("SMTP_PASSWORD", "")
        sender_name = os.getenv("SENDER_NAME", "Bryan @ Outbounder")
        from_email = smtp_user

    if not smtp_user or not smtp_pass:
        return False, "No active mailbox or .env credentials configured."

    if not recipient_email or "@" not in recipient_email:
        return False, "Invalid recipient email address."

    recipient_domain = recipient_email.split("@")[-1].lower()
    is_gov, gov_reason = is_government_affiliated(
        company_name=company_name,
        root_domain=recipient_domain,
        contact_email=recipient_email
    )
    if is_gov:
        log_send_event(lead_id, recipient_email, company_name, subject, "SUPPRESSED", 550, f"Blocked by Government Shield: {gov_reason}", sender_email=from_email)
        return False, f"Blocked by Government Shield: {gov_reason}"

    # Global live-off applies to every email path, including personal preview tests.
    live_dispatch_enabled = is_live_dispatch_enabled()
    admin_test_email = os.getenv("ADMIN_TEST_EMAIL", "").strip().lower()
    is_personal_domain = recipient_email.lower().endswith(("@gmail.com", "@outlook.com", "@hotmail.com", "@yahoo.com", "@icloud.com"))

    if not live_dispatch_enabled:
        log_send_event(lead_id, recipient_email, company_name, subject, "SENT", 250, "[DRY-RUN SAFETY SHIELD] Simulated live send accepted (Live sending gated)", body=body, sender_email=from_email)
        return True, f"[DRY-RUN MODE] Simulated delivery from {from_email} to {recipient_email} (Safety gate: live outbound emails disabled)."

    campaign_schedule = None
    if is_personal_preview_test:
        if not (is_personal_domain or recipient_email.lower() == admin_test_email):
            return False, "Personal preview tests are limited to a personal mailbox or the configured admin test address."
    elif not is_live_outreach_ready(lead_id, recipient_email):
        return False, "Live send blocked: approve this prospect and complete a matching MX/source preflight in the Next.js Email Preflight page first."
    else:
        campaign_schedule = get_campaign_schedule_for_lead(lead_id)
        if campaign_schedule:
            reason = _campaign_schedule_closed_message(campaign_schedule)
            if reason:
                return False, f"Live send blocked outside campaign hours ({reason})"

    try:
        with _smtp_session(smtp_server, smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(smtp_user, smtp_pass)

            if campaign_schedule:
                reason = _campaign_schedule_closed_message(campaign_schedule)
                if reason:
                    return False, f"Live send blocked outside campaign hours ({reason})"

            p_type = (target_box.get("provider_type") or "MICROSOFT") if target_box else "MICROSOFT"
            msg = build_outbound_mime_message(
                sender_name=sender_name,
                from_email=from_email,
                recipient_email=recipient_email,
                subject=subject,
                body=body,
                provider_type=p_type
            )

            server.sendmail(from_email, [recipient_email], msg.as_string())

        log_send_event(lead_id, recipient_email, company_name, subject, "SENT", 250, "250 Manual dispatch accepted", body=body, sender_email=from_email)
        return True, f"SMTP accepted the message from {from_email} to {recipient_email} (250 OK); inbox delivery is unverified."
    except smtplib.SMTPAuthenticationError as e:
        return False, f"SMTP Auth Failed (535): {e}"
    except smtplib.SMTPResponseException as e:
        log_send_event(lead_id, recipient_email, company_name, subject, "FAILED", e.smtp_code, str(e.smtp_error), sender_email=from_email)
        return False, f"SMTP Error ({e.smtp_code}): {e.smtp_error.decode('utf-8', errors='ignore')}"
    except Exception as ex:
        log_send_event(lead_id, recipient_email, company_name, subject, "ERROR", response_msg=str(ex), sender_email=from_email)
        return False, f"Failed: {ex}"
