"""Loopback-only control API for the local Outbounder email dispatcher."""

from __future__ import annotations

import json
import os
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlsplit

from campaign_database import (
    connection_scope,
    get_all_campaigns,
    get_all_templates,
    get_campaign_lead_counts,
    get_email_preflight_map,
    is_email_preflight_fresh,
    get_all_mailboxes,
    get_leads_by_campaign,
    get_sent_email_set,
    update_mailbox_pacing_settings,
)
from campaign_dispatcher import CampaignDispatcher
from config import is_live_dispatch_enabled
from email_intelligence import classify_email
from gov_shield import is_government_affiliated
from mailbox_pacing import safe_mailbox_pacing_summary, validate_pacing_update
from inbound_monitor import InboundScanError, scan_mailbox_readonly
from spintax_engine import validate_company_name


HOST = "127.0.0.1"
PORT = int(os.getenv("OUTBOUNDER_DISPATCHER_PORT", "8765"))
CONTROL_TOKEN = os.getenv("OUTBOUNDER_CONTROL_TOKEN", "")
MAX_BODY_BYTES = 128 * 1024

dispatcher = CampaignDispatcher()
mutation_lock = threading.Lock()
inbound_scan_lock = threading.Lock()

AUTO_APPROVAL_BLOCKED_LOCAL_PARTS = {
    "privacy", "legal", "compliance", "customer", "customercare",
    "customer-care", "returns", "helpdesk", "myorder", "whatsup", "cs",
}
AUTO_APPROVAL_BLOCKED_PREFIXES = (
    "support", "billing", "help", "noreply", "no-reply", "donotreply",
    "newsletter", "alerts", "notifications", "service", "ticketing", "webmaster",
)
MYSG_HIRING_LOCAL_PARTS = {
    "hr", "careers", "recruitment", "jobs", "talent", "hiring",
    "humanresources", "human.resources",
}


def _auto_approval_route_allowed(lead: dict[str, Any]) -> bool:
    email = str(lead.get("contact_email") or lead.get("email") or "").strip().lower()
    if email.count("@") != 1:
        return False
    local = email.split("@", 1)[0]
    compact_local = local.replace(".", "").replace("-", "").replace("_", "")
    if compact_local in {part.replace(".", "").replace("-", "").replace("_", "") for part in AUTO_APPROVAL_BLOCKED_LOCAL_PARTS}:
        return False
    if any(local.startswith(prefix) for prefix in AUTO_APPROVAL_BLOCKED_PREFIXES):
        return False
    if classify_email(email, str(lead.get("buyer_name") or "")).get("tier") == 4:
        return False
    try:
        validate_company_name(lead.get("company_name"))
    except ValueError:
        return False
    return bool(str(lead.get("company_name") or "").strip())


def _auto_approval_campaign_allowed(
    campaign: dict[str, Any], lead: dict[str, Any], selected_campaign_id: str
) -> bool:
    lead_campaign_id = str(lead.get("campaign_id") or "")
    if not selected_campaign_id or selected_campaign_id == "all" or selected_campaign_id != lead_campaign_id:
        return False
    if str(campaign.get("status") or "").upper() != "ACTIVE":
        return False
    if not _auto_approval_route_allowed(lead):
        return False
    if str(campaign.get("campaign_id") or "") == "mysg_consumer_retail_accounting":
        local = str(lead.get("contact_email") or "").strip().lower().split("@", 1)[0]
        if local in MYSG_HIRING_LOCAL_PARTS or any(
            local.startswith(prefix) for prefix in ("hr", "career", "recruit", "job", "talent", "hiring")
        ):
            return False
    return True


def _json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def _safe_snapshot() -> dict[str, Any]:
    snap = dispatcher.get_snapshot()
    # Never expose lead names, recipient addresses, sender addresses, or exception
    # details through this control API. Status text from the worker can contain PII.
    allowed_snapshot = {
        key: snap.get(key)
        for key in (
            "is_running",
            "is_paused",
            "daily_limit",
            "hourly_limit",
            "min_delay",
            "max_delay",
            "business_hours_only",
            "schedule_override_active",
            "sent_today",
            "sent_this_hour",
            "queue_pending",
            "next_send_timestamp",
            "wait_reason",
            "run_id",
            "accepted_count",
            "run_total",
            "uncertain_count",
        )
    }
    allowed_snapshot["live_dispatch"] = is_live_dispatch_enabled()
    allowed_snapshot["schedule_override_supported"] = True
    if snap.get("last_error"):
        allowed_snapshot["has_error"] = True
    else:
        allowed_snapshot["has_error"] = False

    return allowed_snapshot


def _safe_status(include_metadata: bool = True, campaign_id: str = "all", offset: int = 0) -> dict[str, Any]:
    snapshot = _safe_snapshot()
    if not include_metadata:
        return {"snapshot": snapshot}

    campaigns = get_all_campaigns()
    campaign_by_id = {row["campaign_id"]: row for row in campaigns}
    if campaign_id != "all" and campaign_id not in campaign_by_id:
        raise ValueError("The selected campaign does not exist")
    templates = [
        {"name": row["name"], "isDefault": bool(row.get("is_default", 0))}
        for row in get_all_templates()
    ]
    counts = get_campaign_lead_counts()
    sent_or_suppressed = get_sent_email_set()
    preflight_by_lead = get_email_preflight_map()
    eligible: list[dict[str, Any]] = []
    seen_emails = set()
    held = {"needs_approval": 0, "needs_email_check": 0, "sent_or_suppressed": 0, "government": 0}
    for lead in get_leads_by_campaign(campaign_id):
        if str(lead.get("campaign_id") or "") not in campaign_by_id:
            continue
        email = str(lead.get("contact_email") or lead.get("email") or "").strip()
        if "@" not in email:
            held["needs_email_check"] += 1
            continue
        if email.lower() in sent_or_suppressed:
            held["sent_or_suppressed"] += 1
            continue
        is_gov, _ = is_government_affiliated(
            company_name=str(lead.get("company_name") or ""),
            root_domain=str(lead.get("root_domain") or ""),
            contact_email=email,
            summary=str(lead.get("company_summary") or lead.get("bro_summary") or ""),
        )
        if is_gov:
            held["government"] += 1
            continue
        if not _auto_approval_route_allowed(lead):
            held["needs_approval"] += 1
            continue
        campaign = campaign_by_id.get(str(lead.get("campaign_id") or ""))
        status = str(lead.get("status") or "").strip().casefold()
        auto_approval_eligible = (
            status == "ready to review"
            and campaign is not None
            and _auto_approval_campaign_allowed(campaign, lead, campaign_id)
        )
        if status != "approved for outreach" and not auto_approval_eligible:
            held["needs_approval"] += 1
            continue
        evidence = preflight_by_lead.get(str(lead.get("lead_id") or ""), {})
        if (
            str(evidence.get("email") or "").strip().casefold() != email.casefold()
            or evidence.get("mx_status") != "mx_present"
            or int(evidence.get("source_confirmed") or 0) != 1
            or not is_email_preflight_fresh(evidence)
        ):
            held["needs_email_check"] += 1
            continue
        normalized = email.strip().lower()
        if normalized in seen_emails:
            continue
        seen_emails.add(normalized)
        eligible.append({
            "id": str(lead.get("lead_id") or ""),
            "company": str(lead.get("company_name") or ""),
            "status": str(lead.get("status") or ""),
            "fit": lead.get("quality_score"),
            "campaignId": str(lead.get("campaign_id") or ""),
            "autoApprovalEligible": auto_approval_eligible,
        })
    campaign_options = [
        {
            "id": "all",
            "name": "All campaigns",
            "count": sum(counts.values()),
            "scheduleTimezone": None,
            "scheduleStartMinute": None,
            "scheduleEndMinute": None,
        }
    ]
    campaign_options.extend(
        {
            "id": campaign["campaign_id"],
            "name": campaign["name"],
            "count": counts.get(campaign["campaign_id"], 0),
            **(
                {"templateName": campaign["default_template_name"]}
                if campaign.get("default_template_name")
                else {}
            ),
            "scheduleTimezone": campaign.get("schedule_timezone", "Asia/Singapore"),
            "scheduleStartMinute": campaign.get("schedule_start_minute", 540),
            "scheduleEndMinute": campaign.get("schedule_end_minute", 1050),
        }
        for campaign in campaigns
    )
    return {
        "snapshot": snapshot,
        "templates": templates,
        "campaigns": campaign_options,
        "candidates": eligible[offset : offset + 100],
        "eligibleCount": len(eligible),
        "heldCounts": held,
        "hasMore": offset + 100 < len(eligible),
    }


def _safe_mailbox_pacing() -> dict[str, Any]:
    snapshot = dispatcher.get_snapshot()
    mailboxes = get_all_mailboxes()
    return {
        "mailboxes": safe_mailbox_pacing_summary(
            mailboxes,
            int(snapshot.get("min_delay", 60)),
            int(snapshot.get("max_delay", 120)),
        ),
        "limits": {
            "maxDaily": 9_007_199_254_740_991,
            "maxHourly": 9_007_199_254_740_991,
            "minDelaySeconds": 60,
            "maxDelaySeconds": 3600,
            "minDelaySpanSeconds": 30,
        },
        "isRunning": bool(snapshot.get("is_running")),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "OutbounderLocalControl/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        # Request paths and errors can contain user data; keep the sidecar quiet.
        return

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = _json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        supplied = self.headers.get("Authorization", "")
        if supplied.startswith("Bearer "):
            supplied = supplied[7:]
        else:
            supplied = self.headers.get("X-Outbounder-Control-Token", "")
        return bool(CONTROL_TOKEN) and secrets.compare_digest(supplied, CONTROL_TOKEN)

    def _read_json(self) -> dict[str, Any] | None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send(400, {"error": "Invalid Content-Length"})
            return None
        if content_length < 1 or content_length > MAX_BODY_BYTES:
            self._send(413, {"error": "Request body is empty or too large"})
            return None
        try:
            value = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send(400, {"error": "Request body must be JSON"})
            return None
        if not isinstance(value, dict):
            self._send(400, {"error": "Request body must be an object"})
            return None
        return value

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path == "/ready" and not parsed.query:
            if not self._authorized():
                self._send(401, {"error": "Unauthorized"})
                return
            self._send(200, {"ready": True})
            return
        if parsed.path == "/health" and not parsed.query:
            self._send(200, {"ready": True})
            return
        if parsed.path not in ("/status", "/mailbox-pacing"):
            self._send(404, {"error": "Not found"})
            return
        if not self._authorized():
            self._send(401, {"error": "Unauthorized"})
            return
        if parsed.path == "/mailbox-pacing":
            if parsed.query:
                self._send(400, {"error": "Unsupported pacing query"})
                return
            try:
                self._send(200, _safe_mailbox_pacing())
            except Exception:
                self._send(503, {"error": "Local mailbox pacing status is unavailable"})
            return
        try:
            query = parse_qs(parsed.query, keep_blank_values=True)
            if "summary" in query:
                if query != {"summary": ["1"]}:
                    self._send(400, {"error": "Unsupported status query"})
                    return
                self._send(200, _safe_status(include_metadata=False))
                return
            if set(query) - {"campaignId", "offset"} or len(query.get("campaignId", [])) > 1 or len(query.get("offset", [])) > 1:
                self._send(400, {"error": "Unsupported status query"})
                return
            campaign_id = query.get("campaignId", ["all"])[0]
            if not campaign_id:
                self._send(400, {"error": "campaignId must be all or a campaign id"})
                return
            try:
                offset = int(query.get("offset", ["0"])[0])
            except ValueError:
                self._send(400, {"error": "offset must be a positive integer"})
                return
            if offset < 0 or offset > 5000 or offset % 100:
                self._send(400, {"error": "offset must be a non-negative multiple of 100 no greater than 5,000"})
                return
            self._send(200, _safe_status(campaign_id=campaign_id, offset=offset))
        except ValueError as error:
            self._send(400, {"error": str(error)})
        except Exception:
            self._send(503, {"error": "Local dispatcher status is unavailable"})

    def do_POST(self) -> None:
        if self.path not in ("/start", "/pause", "/stop", "/live", "/override-schedule", "/mailbox-pacing", "/inbound-scan", "/limits-changed"):
            self._send(404, {"error": "Not found"})
            return
        if not self._authorized():
            self._send(401, {"error": "Unauthorized"})
            return
        body = self._read_json()
        if body is None:
            return
        if self.path == "/inbound-scan":
            if body.get("confirmed") is not True:
                self._send(400, {"error": "Confirm the read-only inbound scan in the operator desk."})
                return
            mailbox_id = body.get("mailboxId")
            if type(mailbox_id) is not int or mailbox_id < 1:
                self._send(400, {"error": "The selected mailbox is invalid."})
                return
            max_messages = body.get("maxMessages", 15)
            if type(max_messages) is not int or not 1 <= max_messages <= 20:
                self._send(400, {"error": "Choose between 1 and 20 recent messages."})
                return
            if not inbound_scan_lock.acquire(blocking=False):
                self._send(409, {"error": "An inbound scan is already running."})
                return
            try:
                mailboxes = get_all_mailboxes()
                mailbox = next((item for item in mailboxes if int(item.get("mailbox_id", 0)) == mailbox_id), None)
                if mailbox is None:
                    self._send(404, {"error": "The selected mailbox was not found."})
                    return
                result = scan_mailbox_readonly(mailbox, max_messages=max_messages)
                self._send(200, result)
            except InboundScanError as error:
                self._send(400, {"error": str(error)})
            except Exception:
                # Do not log or return exceptions: mailbox libraries may include
                # account names, message headers, or server responses in errors.
                self._send(503, {"error": "Inbound scan failed. Mailbox credentials and server details were not returned."})
            finally:
                inbound_scan_lock.release()
            return
        try:
            with mutation_lock:
                if self.path == "/limits-changed":
                    dispatcher.mailbox_limits_changed()
                    self._send(200, {"updated": True})
                elif self.path == "/start":
                    self._start(body)
                elif self.path == "/pause":
                    self._pause()
                elif self.path == "/stop":
                    self._stop()
                elif self.path == "/override-schedule":
                    self._override_schedule(body)
                elif self.path == "/mailbox-pacing":
                    self._update_mailbox_pacing(body)
                else:
                    self._set_live(body)
        except ValueError as error:
            self._send(400, {"error": str(error)})
        except RuntimeError as error:
            self._send(409, {"error": str(error)})
        except Exception:
            self._send(503, {"error": "Local dispatcher action failed"})

    def _start(self, body: dict[str, Any]) -> None:
        lead_ids = body.get("leadIds")
        campaign_id = body.get("campaignId")
        template_a_name = body.get("templateAName")
        template_b_name = body.get("templateBName")
        live_confirmed = body.get("liveConfirmed")
        if not isinstance(lead_ids, list) or not lead_ids:
            raise ValueError("Select at least one prospect")
        if any(not isinstance(lead_id, str) or not lead_id.strip() for lead_id in lead_ids):
            raise ValueError("Every selected lead ID must be a non-empty string")
        if len(lead_ids) != len(set(lead_ids)):
            raise ValueError("Duplicate lead IDs are not allowed")
        if len(lead_ids) > 5000:
            raise ValueError("A run may include at most 5,000 selected prospects")
        if not isinstance(campaign_id, str) or not campaign_id.strip():
            raise ValueError("Choose All campaigns or one campaign")
        if not isinstance(template_a_name, str) or not template_a_name.strip():
            raise ValueError("Choose variant A")
        if not isinstance(template_b_name, str) or not template_b_name.strip():
            raise ValueError("Choose variant B")
        if template_a_name.strip() == template_b_name.strip():
            raise ValueError("Choose two different templates for the A/B split")
        if not isinstance(live_confirmed, bool):
            raise ValueError("liveConfirmed must be true or false")

        if dispatcher.get_snapshot()["is_running"]:
            raise RuntimeError("A dispatch run is already active")

        if campaign_id == "all":
            scoped_leads = get_leads_by_campaign("all")
        else:
            known_campaigns = {row["campaign_id"] for row in get_all_campaigns()}
            if campaign_id not in known_campaigns:
                raise ValueError("The selected campaign does not exist")
            scoped_leads = get_leads_by_campaign(campaign_id)

        leads_by_id = {str(row.get("lead_id", "")): row for row in scoped_leads}
        missing = [lead_id for lead_id in lead_ids if lead_id not in leads_by_id]
        if missing:
            raise ValueError("One or more selected prospects do not belong to the chosen campaign scope")
        selected = [leads_by_id[lead_id] for lead_id in lead_ids]
        if any(not (row.get("contact_email") or row.get("email") or "").strip() for row in selected):
            raise ValueError("Every selected prospect must have an email address")

        templates_by_name = {row["name"]: row for row in get_all_templates()}
        template_a = templates_by_name.get(template_a_name.strip())
        template_b = templates_by_name.get(template_b_name.strip())
        if template_a is None or template_b is None:
            raise ValueError("One of the selected outbound templates no longer exists")

        # Recheck every send prerequisite against durable state immediately before queueing.
        sent_or_suppressed = get_sent_email_set()
        preflight_by_lead = get_email_preflight_map()
        campaign_by_id = {row["campaign_id"]: row for row in get_all_campaigns()}
        eligible_selected = []
        auto_approved_ids = []
        seen_emails = set()
        for lead in selected:
            email = str(lead.get("contact_email") or lead.get("email") or "").strip()
            normalized_email = email.lower()
            if "@" not in email or normalized_email in sent_or_suppressed or normalized_email in seen_emails:
                continue
            is_gov, _ = is_government_affiliated(
                company_name=str(lead.get("company_name") or ""),
                root_domain=str(lead.get("root_domain") or ""),
                contact_email=email,
                summary=str(lead.get("company_summary") or lead.get("bro_summary") or ""),
            )
            if is_gov:
                continue
            campaign = campaign_by_id.get(str(lead.get("campaign_id") or ""))
            status = str(lead.get("status") or "").strip().casefold()
            auto_approval_eligible = (
                status == "ready to review"
                and campaign is not None
                and _auto_approval_campaign_allowed(campaign, lead, campaign_id)
            )
            if not _auto_approval_route_allowed(lead):
                continue
            if status != "approved for outreach" and not auto_approval_eligible:
                continue
            evidence = preflight_by_lead.get(str(lead.get("lead_id") or ""), {})
            if (
                str(evidence.get("email") or "").strip().casefold() != normalized_email
                or evidence.get("mx_status") != "mx_present"
                or int(evidence.get("source_confirmed") or 0) != 1
                or not is_email_preflight_fresh(evidence)
            ):
                continue
            if campaign is None:
                continue
            lead["_campaign_schedule"] = {
                "timezone_name": str(campaign.get("schedule_timezone") or "Asia/Singapore"),
                "start_minute": int(campaign.get("schedule_start_minute", 540)),
                "end_minute": int(campaign.get("schedule_end_minute", 1050)),
            }
            seen_emails.add(normalized_email)
            eligible_selected.append(lead)
            if auto_approval_eligible:
                auto_approved_ids.append(str(lead.get("lead_id") or ""))
        if not eligible_selected:
            raise ValueError("No selected prospects are ready. Each must be Approved for Outreach, have MX and source evidence newer than 30 days, and be unsent and unsuppressed.")

        live_enabled = is_live_dispatch_enabled()
        if live_enabled and not live_confirmed:
            raise RuntimeError("Explicit live-send confirmation is required to start this run")

        if auto_approved_ids:
            approval_note = "Auto-approved at dispatch start: active campaign, fresh published-source/MX evidence, safe recipient route, not previously sent or suppressed."
            with connection_scope() as connection:
                connection.executemany("""
                    UPDATE prospects
                    SET status='Approved for Outreach',
                        notes=trim(coalesce(notes, '') || char(10) || ?)
                    WHERE lead_id=? AND status='Ready to Review'
                """, [(approval_note, lead_id) for lead_id in auto_approved_ids])

        variant_counts = dispatcher.start_campaign(
            leads=eligible_selected,
            subject_tmpl=template_a["subject"],
            body_tmpl=template_a["body"],
            variants=[template_a, template_b],
        )
        result = _safe_status()
        result["acceptedLeadCount"] = len(eligible_selected)
        result["variantCounts"] = variant_counts
        result["campaignId"] = campaign_id
        self._send(202, result)

    def _pause(self) -> None:
        snapshot = dispatcher.get_snapshot()
        if not snapshot["is_running"]:
            raise RuntimeError("There is no dispatch run to pause or resume")
        dispatcher.pause_campaign()
        self._send(200, _safe_status())

    def _stop(self) -> None:
        dispatcher.stop_campaign()
        self._send(200, _safe_status())

    def _set_live(self, body: dict[str, Any]) -> None:
        enabled = body.get("enabled")
        if not isinstance(enabled, bool) or body.get("confirmed") is not True:
            raise ValueError("Set enabled and explicitly confirm the live-mode change")
        if dispatcher.get_snapshot()["is_running"]:
            raise RuntimeError("Stop the current run before changing live mode")
        dispatcher.set_live_dispatch(enabled)
        self._send(200, _safe_status())

    def _override_schedule(self, body: dict[str, Any]) -> None:
        if body.get("confirmed") is not True or body.get("liveConfirmed") is not True:
            raise ValueError("Confirm the live schedule override in the operator desk")
        if not is_live_dispatch_enabled():
            raise RuntimeError("Live delivery must be enabled before overriding a campaign schedule")
        dispatcher.override_current_schedule()
        self._send(200, _safe_status())

    def _update_mailbox_pacing(self, body: dict[str, Any]) -> None:
        update = validate_pacing_update(body)
        mailbox_id = update.pop("mailbox_id")
        update_mailbox_pacing_settings(mailbox_id=mailbox_id, **update)
        dispatcher.mailbox_limits_changed()
        result = _safe_mailbox_pacing()
        result["updatedMailboxId"] = mailbox_id
        self._send(200, result)


def main() -> None:
    if not CONTROL_TOKEN:
        raise SystemExit("OUTBOUNDER_CONTROL_TOKEN must be provided by the local launcher")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    if os.getenv("OUTBOUNDER_RECOVER_QUEUE") == "1":
        dispatcher.recover_saved_campaign()
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        dispatcher.stop_campaign()
        server.server_close()


if __name__ == "__main__":
    main()
