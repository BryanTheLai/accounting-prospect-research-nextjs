"""HTTP-level dispatch eligibility checks using a temporary SQLite fixture."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from unittest.mock import patch

import campaign_database


class TestDispatchSafetyGate(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="outbounder-dispatch-api-")
        self.database_path = Path(self.temp_dir.name) / "dispatch.sqlite3"
        self.db_path_patch = patch.object(campaign_database, "DB_PATH", self.database_path)
        self.db_path_patch.start()
        campaign_database.init_campaign_tables()
        campaign_database.seed_default_campaigns()
        checked_at = datetime.now(timezone.utc).isoformat()

        conn = campaign_database.get_db_connection()
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS prospects (
                    lead_id TEXT PRIMARY KEY,
                    campaign_id TEXT,
                    company_name TEXT,
                    company_summary TEXT,
                    bro_summary TEXT,
                    root_domain TEXT,
                    contact_email TEXT,
                    email TEXT,
                    quality_score INTEGER,
                    status TEXT,
                    notes TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE email_preflight (
                    lead_id TEXT PRIMARY KEY,
                    email TEXT NOT NULL,
                    mx_status TEXT NOT NULL,
                    mx_hosts TEXT NOT NULL DEFAULT '[]',
                    checked_at TEXT NOT NULL,
                    source_confirmed INTEGER NOT NULL DEFAULT 0,
                    source_confirmed_at TEXT
                )
            """)
            fixtures = [
                ("yc_unapproved", "yc_us_expansion", "Unapproved Startup", "support@unapproved.example", "Ready to Review"),
                ("yc_no_source", "yc_us_expansion", "Unconfirmed Startup", "unconfirmed@example.test", "Approved for Outreach"),
                ("yc_approved", "yc_us_expansion", "Approved Startup", "approved@example.test", "Approved for Outreach"),
            ]
            conn.executemany("""
                INSERT INTO prospects (lead_id, campaign_id, company_name, root_domain,
                    contact_email, quality_score, status)
                VALUES (?, ?, ?, ?, ?, 90, ?)
            """, [(*row[:3], "example.test", row[3], row[4]) for row in fixtures])
            conn.executemany("""
                INSERT INTO email_preflight
                    (lead_id, email, mx_status, mx_hosts, checked_at, source_confirmed, source_confirmed_at)
                VALUES (?, ?, 'mx_present', '[\"mx.example.test\"]', ?, ?, ?)
            """, [
                ("yc_unapproved", "support@unapproved.example", checked_at, 1, checked_at),
                ("yc_no_source", "unconfirmed@example.test", checked_at, 0, None),
                ("yc_approved", "approved@example.test", checked_at, 1, checked_at),
            ])
            conn.commit()
        finally:
            conn.close()

        self.live_env_patch = patch.dict(os.environ, {"ENABLE_LIVE_DISPATCH": "false"})
        self.live_env_patch.start()
        import dispatcher_sidecar

        self.sidecar = dispatcher_sidecar
        self.sidecar.CONTROL_TOKEN = "dispatch-test-token"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self.sidecar.Handler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(timeout=2)
        self.sidecar.CONTROL_TOKEN = ""
        self.live_env_patch.stop()
        self.db_path_patch.stop()
        self.temp_dir.cleanup()

    def request(self, path: str, body: dict | None = None, *, authorized: bool = True):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Content-Type": "application/json"} if data else {}
        if authorized:
            headers["Authorization"] = "Bearer dispatch-test-token"
        request = Request(
            self.base_url + path,
            data=data,
            headers=headers,
            method="POST" if data else "GET",
        )
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read())
        except Exception as error:
            if hasattr(error, "code"):
                return error.code, json.loads(error.read())
            raise

    def test_launcher_readiness_requires_the_current_process_token(self):
        status, _ = self.request("/ready", authorized=False)
        self.assertEqual(status, 401)
        status, payload = self.request("/ready")
        self.assertEqual(status, 200)
        self.assertTrue(payload["ready"])

    def test_http_status_and_start_require_exact_review_and_source_evidence(self):
        smtp = patch("smtplib.SMTP", side_effect=AssertionError("safety gate test must never touch SMTP"))
        smtp.start()
        self.addCleanup(smtp.stop)

        status, payload = self.request("/status?campaignId=yc_us_expansion")
        self.assertEqual(status, 200)
        self.assertFalse(payload["snapshot"]["live_dispatch"])
        self.assertEqual(payload["eligibleCount"], 1)
        self.assertEqual([row["id"] for row in payload["candidates"]], ["yc_approved"])
        self.assertEqual(payload["heldCounts"]["needs_approval"], 1)
        self.assertEqual(payload["heldCounts"]["needs_email_check"], 1)
        self.assertNotIn("email", payload["candidates"][0])

        body = {
            "campaignId": "yc_us_expansion",
            "leadIds": ["yc_no_source"],
            "templateAName": "YC A/B — Commercial Burn Cut",
            "templateBName": "YC A/B — Conversational Builder",
            "liveConfirmed": False,
        }
        status, rejected = self.request("/start", body)
        self.assertEqual(status, 400)
        self.assertIn("MX and source evidence", rejected["error"])
        self.assertFalse(self.sidecar.dispatcher.get_snapshot()["is_running"])

        accepted_leads = []

        def accept_for_dry_run_test(**kwargs):
            accepted_leads.extend(kwargs["leads"])
            return {"YC A/B — Commercial Burn Cut": 1, "YC A/B — Conversational Builder": 0}

        with patch.object(self.sidecar.dispatcher, "start_campaign", side_effect=accept_for_dry_run_test):
            body["leadIds"] = ["yc_approved"]
            status, accepted = self.request("/start", body)

        self.assertEqual(status, 202)
        self.assertFalse(accepted["snapshot"]["live_dispatch"])
        self.assertEqual(accepted["acceptedLeadCount"], 1)
        self.assertEqual(len(accepted_leads), 1)
        self.assertEqual(accepted_leads[0]["_campaign_schedule"], {
            "timezone_name": "America/Los_Angeles",
            "start_minute": 540,
            "end_minute": 1080,
        })
        self.assertFalse(self.sidecar.dispatcher.get_snapshot()["is_running"])

        conn = campaign_database.get_db_connection()
        try:
            conn.execute(
                "UPDATE email_preflight SET checked_at = ?, source_confirmed_at = ? WHERE lead_id = ?",
                ("2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z", "yc_approved"),
            )
            conn.commit()
        finally:
            conn.close()
        status, stale_payload = self.request("/status?campaignId=yc_us_expansion")
        self.assertEqual(status, 200)
        self.assertEqual(stale_payload["eligibleCount"], 0)
        self.assertEqual(stale_payload["heldCounts"]["needs_email_check"], 2)

        body["leadIds"] = ["yc_approved"]
        status, stale_rejected = self.request("/start", body)
        self.assertEqual(status, 400)
        self.assertIn("newer than 30 days", stale_rejected["error"])
        self.assertFalse(self.sidecar.dispatcher.get_snapshot()["is_running"])

    def test_status_deduplicates_recipients_and_omits_archived_campaign_leads(self):
        checked = datetime.now(timezone.utc).isoformat()
        with campaign_database.connection_scope() as connection:
            connection.execute("UPDATE campaigns SET status='ARCHIVED' WHERE campaign_id='accounting_firm_partners'")
            for lead_id, campaign in (("duplicate_address", "yc_us_expansion"), ("archived_lead", "accounting_firm_partners")):
                connection.execute("INSERT INTO prospects(lead_id,campaign_id,company_name,root_domain,contact_email,status,quality_score) VALUES (?,?,?,'example.test','approved@example.test','Approved for Outreach',90)", (lead_id, campaign, lead_id))
                connection.execute("INSERT INTO email_preflight(lead_id,email,mx_status,source_confirmed,checked_at,source_confirmed_at) VALUES (?,'approved@example.test','mx_present',1,?,?)", (lead_id, checked, checked))
        status, payload = self.request("/status?campaignId=all")
        self.assertEqual(status, 200)
        self.assertEqual(payload["eligibleCount"], 1)
        self.assertEqual(len(payload["candidates"]), 1)

    def test_auto_approval_requires_fresh_evidence_and_safe_contact_route(self):
        checked = datetime.now(timezone.utc).isoformat()
        with campaign_database.connection_scope() as connection:
            for lead_id, company, email in (
                ("auto_ready", "Ready Company", "founder@ready.example"),
                ("auto_support", "Support Company", "support@support.example"),
                ("auto_bracketed", "[in]trigue", "info@intrigue.example"),
            ):
                connection.execute("""
                    INSERT INTO prospects (lead_id, campaign_id, company_name, root_domain,
                        contact_email, quality_score, status)
                    VALUES (?, 'yc_us_expansion', ?, ?, ?, 90, 'Ready to Review')
                """, (lead_id, company, email.split("@", 1)[1], email))
                connection.execute("""
                    INSERT INTO email_preflight
                        (lead_id, email, mx_status, mx_hosts, checked_at, source_confirmed, source_confirmed_at)
                    VALUES (?, ?, 'mx_present', '[\"mx.example.test\"]', ?, 1, ?)
                """, (lead_id, email, checked, checked))

        status, listing = self.request("/status?campaignId=yc_us_expansion")
        self.assertEqual(status, 200)
        candidates = {row["id"]: row for row in listing["candidates"]}
        self.assertTrue(candidates["auto_ready"]["autoApprovalEligible"])
        self.assertNotIn("auto_support", candidates)
        self.assertNotIn("auto_bracketed", candidates)
        _, all_campaigns = self.request("/status?campaignId=all")
        all_candidates = {row["id"]: row for row in all_campaigns["candidates"]}
        self.assertNotIn("auto_ready", all_candidates)

        body = {
            "campaignId": "yc_us_expansion",
            "leadIds": ["auto_ready"],
            "templateAName": "YC A/B — Commercial Burn Cut",
            "templateBName": "YC A/B — Conversational Builder",
            "liveConfirmed": False,
        }
        with patch.object(self.sidecar.dispatcher, "start_campaign", return_value={
            "YC A/B — Commercial Burn Cut": 1,
            "YC A/B — Conversational Builder": 0,
        }):
            status, payload = self.request("/start", body)
        self.assertEqual(status, 202)
        self.assertEqual(payload["acceptedLeadCount"], 1)
        with campaign_database.connection_scope() as connection:
            promoted = connection.execute(
                "SELECT status, notes FROM prospects WHERE lead_id='auto_ready'"
            ).fetchone()
        self.assertEqual(promoted[0], "Approved for Outreach")
        self.assertIn("Auto-approved at dispatch start", promoted[1])

    def test_schedule_override_requires_live_mode_confirmation_and_active_queue(self):
        status, rejected = self.request("/override-schedule", {"confirmed": False, "liveConfirmed": True})
        self.assertEqual(status, 400)
        self.assertIn("Confirm the live schedule override", rejected["error"])

        with patch.object(self.sidecar, "is_live_dispatch_enabled", return_value=True):
            status, rejected = self.request("/override-schedule", {"confirmed": True, "liveConfirmed": True})
        self.assertEqual(status, 409)
        self.assertIn("active dispatch run", rejected["error"])

        dispatcher = self.sidecar.dispatcher
        dispatcher.state["is_running"] = True
        dispatcher.state["is_paused"] = True
        dispatcher.state["queue_pending"] = 1
        with patch.object(self.sidecar, "is_live_dispatch_enabled", return_value=True):
            status, rejected = self.request("/override-schedule", {"confirmed": True, "liveConfirmed": True})
        self.assertEqual(status, 409)
        self.assertIn("paused run", rejected["error"])
        self.assertFalse(dispatcher.state["schedule_override_active"])
        dispatcher.state["is_paused"] = False
        with patch.object(self.sidecar, "is_live_dispatch_enabled", return_value=False):
            status, rejected = self.request("/override-schedule", {"confirmed": True, "liveConfirmed": True})
        self.assertEqual(status, 409)
        self.assertIn("Live delivery must be enabled", rejected["error"])
        self.assertFalse(dispatcher.state["schedule_override_active"])

        with patch.object(self.sidecar, "is_live_dispatch_enabled", return_value=True):
            status, accepted = self.request("/override-schedule", {"confirmed": True, "liveConfirmed": True})
        self.assertEqual(status, 200)
        self.assertTrue(accepted["snapshot"]["schedule_override_active"])
        self.assertTrue(dispatcher.state["schedule_override_active"])
        with patch.object(self.sidecar, "is_live_dispatch_enabled", return_value=True):
            status, repeated = self.request("/override-schedule", {"confirmed": True, "liveConfirmed": True})
        self.assertEqual(status, 200)
        self.assertTrue(repeated["snapshot"]["schedule_override_active"])
        dispatcher.stop_campaign()
        dispatcher.state["queue_pending"] = 0
        dispatcher.state["schedule_override_active"] = False
        dispatcher._schedule_override_event.clear()


if __name__ == "__main__":
    unittest.main()
