import json
import sqlite3
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

import campaign_database as db
from mailbox_pacing import PacingInputError, safe_mailbox_pacing_summary, validate_pacing_update
from warmup_ramper import enforce_warmup_limits


class TestMailboxPacingValidation(unittest.TestCase):
    def valid(self, **overrides):
        return {
            "mailboxId": 7,
            "dailyLimit": 20,
            "hourlyLimit": 4,
            "minDelaySeconds": 90,
            "maxDelaySeconds": 210,
            "confirmed": True,
            **overrides,
        }

    def test_accepts_only_bounded_confirmed_pacing_fields(self):
        self.assertEqual(validate_pacing_update(self.valid()), {
            "mailbox_id": 7,
            "daily_limit": 20,
            "hourly_limit": 4,
            "min_delay_seconds": 90,
            "max_delay_seconds": 210,
            "manual_limits": True,
        })
        for invalid in (
            self.valid(confirmed=False),
            self.valid(dailyLimit=0),
            self.valid(hourlyLimit=1.5),
            self.valid(dailyLimit=3, hourlyLimit=4),
            self.valid(minDelaySeconds=59),
            self.valid(maxDelaySeconds=3601),
            self.valid(minDelaySeconds=120, maxDelaySeconds=149),
            self.valid(smtpPassword="must never be accepted"),
        ):
            with self.subTest(invalid=invalid), self.assertRaises(PacingInputError):
                validate_pacing_update(invalid)
        inherited = validate_pacing_update({
            "mailboxId": 7, "dailyLimit": 20, "hourlyLimit": 4,
            "inheritDelay": True, "confirmed": True,
        })
        self.assertIsNone(inherited["min_delay_seconds"])
        self.assertIsNone(inherited["max_delay_seconds"])

    def test_summary_applies_warmup_and_drops_credential_fields(self):
        row = {
            "mailbox_id": 9,
            "email": "sender@example.test",
            "smtp_user": "secret-login",
            "smtp_password": "secret-password",
            "status": "ACTIVE",
            "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "daily_limit": 25,
            "hourly_limit": 5,
            "min_delay_seconds": 60,
            "max_delay_seconds": 120,
            "sends_today": 1,
            "sends_this_hour": 1,
        }
        [summary] = safe_mailbox_pacing_summary([row], 90, 210)
        self.assertEqual(summary["effectiveDailyLimit"], 5)
        self.assertEqual(summary["effectiveHourlyLimit"], 2)
        self.assertEqual(summary["effectiveMinDelaySeconds"], 180)
        self.assertEqual(summary["effectiveMaxDelaySeconds"], 180)
        self.assertEqual(summary["warmup"]["dayNumber"], 1)
        self.assertTrue(summary["hasDelayOverride"])
        self.assertNotIn("email", summary)
        self.assertNotIn("smtp_user", summary)
        self.assertNotIn("smtp_password", summary)
        self.assertNotRegex(json.dumps(summary), "secret")

    def test_manual_limits_honor_operator_values_even_for_a_new_mailbox(self):
        mailbox = {"mailbox_id": 1, "status": "ACTIVE", "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
                   "daily_limit": 50, "hourly_limit": 10, "manual_limits": 1,
                   "min_delay_seconds": 90, "max_delay_seconds": 210}
        paced = enforce_warmup_limits(mailbox)
        self.assertEqual((paced["daily_limit"], paced["hourly_limit"]), (50, 10))
        self.assertEqual((paced["effective_min_delay_seconds"], paced["effective_max_delay_seconds"]), (90, 210))
        [summary] = safe_mailbox_pacing_summary([mailbox], 90, 210)
        self.assertEqual((summary["effectiveDailyLimit"], summary["effectiveHourlyLimit"]), (50, 10))
        self.assertTrue(summary["manualLimits"])
        self.assertEqual(validate_pacing_update(self.valid(dailyLimit=50, hourlyLimit=10))["daily_limit"], 50)

    def test_unconfigured_mailbox_inherits_streamlit_global_jitter_without_mutating_config(self):
        mailbox = {
            "daily_limit": 20,
            "hourly_limit": 4,
            "min_delay_seconds": None,
            "max_delay_seconds": None,
            "created_at": "2000-01-01 00:00:00",
        }
        paced = enforce_warmup_limits(mailbox, default_min_delay=120, default_max_delay=330)
        self.assertEqual((paced["effective_min_delay_seconds"], paced["effective_max_delay_seconds"]), (120, 150))
        self.assertIsNone(paced["min_delay_seconds"])
        self.assertIsNone(paced["max_delay_seconds"])

    def test_summary_projects_the_same_policy_the_sender_enforces(self):
        for created_at in (datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), "2000-01-01 00:00:00"):
            for minimum, maximum in ((None, None), (60, 120), (300, 600)):
                mailbox = {"mailbox_id": 1, "status": "ACTIVE", "created_at": created_at,
                           "daily_limit": 25, "hourly_limit": 5,
                           "min_delay_seconds": minimum, "max_delay_seconds": maximum,
                           "smtp_password": "fixture-secret"}
                before = dict(mailbox)
                effective = enforce_warmup_limits(mailbox, default_min_delay=90, default_max_delay=210)
                [summary] = safe_mailbox_pacing_summary([mailbox], 90, 210)
                self.assertEqual(summary["effectiveDailyLimit"], effective["daily_limit"])
                self.assertEqual(summary["effectiveHourlyLimit"], effective["hourly_limit"])
                self.assertEqual(summary["effectiveMinDelaySeconds"], effective["effective_min_delay_seconds"])
                self.assertEqual(summary["effectiveMaxDelaySeconds"], effective["effective_max_delay_seconds"])
                self.assertEqual(mailbox, before)
                self.assertNotIn("fixture-secret", json.dumps(summary))

    def test_a_quota_change_wakes_waiting_capacity_without_restarting_a_run(self):
        from campaign_dispatcher import CampaignDispatcher
        dispatcher = CampaignDispatcher()
        finished = threading.Event()
        def wait():
            dispatcher._wait_until("daily_quota", time.time()+3600)
            finished.set()
        thread = threading.Thread(target=wait)
        thread.start()
        try:
            dispatcher.mailbox_limits_changed()
            self.assertTrue(finished.wait(1))
            self.assertFalse(dispatcher._stop_event.is_set())
        finally:
            dispatcher._stop_event.set(); thread.join(2)


class TestMailboxPacingSidecar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory(prefix="outbounder-pacing-test-")
        cls.db_path = Path(cls.temp_dir.name) / "fixture.sqlite"
        cls.original_db_path = db.DB_PATH
        db.DB_PATH = cls.db_path
        db.init_campaign_tables()
        cls.mailbox_id = db.upsert_mailbox(
            "fixture-sender@example.test", "fixture-login", "fixture-password",
            daily_limit=20, hourly_limit=4,
        )

        import dispatcher_sidecar
        from campaign_dispatcher import CampaignDispatcher

        cls.sidecar = dispatcher_sidecar
        cls.sidecar.CONTROL_TOKEN = "fixture-control-token"
        cls.sidecar.dispatcher = CampaignDispatcher()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), cls.sidecar.Handler)
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.server_thread.join(timeout=3)
        db.DB_PATH = cls.original_db_path
        cls.temp_dir.cleanup()

    def request(self, path, body=None, authorized=True):
        headers = {"Content-Type": "application/json"} if body is not None else {}
        if authorized:
            headers["Authorization"] = "Bearer fixture-control-token"
        request = Request(
            self.url + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
            method="POST" if body is not None else "GET",
        )
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def test_pacing_status_requires_token_and_contains_no_credentials_or_sender_address(self):
        status, _ = self.request("/mailbox-pacing", authorized=False)
        self.assertEqual(status, 401)
        status, payload = self.request("/mailbox-pacing")
        self.assertEqual(status, 200)
        self.assertEqual(payload["mailboxes"][0]["mailboxId"], self.mailbox_id)
        self.assertNotIn("fixture-sender@example.test", json.dumps(payload))
        self.assertNotIn("fixture-login", json.dumps(payload))
        self.assertNotIn("fixture-password", json.dumps(payload))

    def test_pacing_write_is_confirmed_scoped_and_preserves_smtp_credentials(self):
        status, _ = self.request("/mailbox-pacing", {
            "mailboxId": self.mailbox_id, "dailyLimit": 12, "hourlyLimit": 3,
            "minDelaySeconds": 120, "maxDelaySeconds": 240, "confirmed": False,
        })
        self.assertEqual(status, 400)
        with patch.dict("os.environ", {"ENABLE_LIVE_DISPATCH": "false"}):
            status, payload = self.request("/mailbox-pacing", {
                "mailboxId": self.mailbox_id, "dailyLimit": 12, "hourlyLimit": 3,
                "minDelaySeconds": 120, "maxDelaySeconds": 240, "confirmed": True,
            })
            self.assertFalse(self.sidecar._safe_snapshot()["live_dispatch"])
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["updatedMailboxId"], self.mailbox_id)
        with db.get_db_connection() as conn:
            row = conn.execute(
                "SELECT daily_limit, hourly_limit, min_delay_seconds, max_delay_seconds, smtp_user, smtp_password FROM mailboxes WHERE mailbox_id = ?",
                (self.mailbox_id,),
            ).fetchone()
        self.assertEqual(tuple(row), (12, 3, 120, 240, "fixture-login", "fixture-password"))
        self.assertFalse(self.sidecar.dispatcher.get_snapshot()["is_running"])

        status, payload = self.request("/mailbox-pacing", {
            "mailboxId": self.mailbox_id, "dailyLimit": 12, "hourlyLimit": 3,
            "inheritDelay": True, "confirmed": True,
        })
        self.assertEqual(status, 200, payload)
        self.assertFalse(payload["mailboxes"][0]["hasDelayOverride"])
        with db.get_db_connection() as conn:
            row = conn.execute(
                "SELECT min_delay_seconds, max_delay_seconds, smtp_user, smtp_password FROM mailboxes WHERE mailbox_id = ?",
                (self.mailbox_id,),
            ).fetchone()
        self.assertEqual(tuple(row), (None, None, "fixture-login", "fixture-password"))

    def test_active_dispatch_applies_operator_quotas_without_stopping_the_run(self):
        dispatcher = self.sidecar.dispatcher
        dispatcher.state["is_running"] = True
        try:
            status, payload = self.request("/mailbox-pacing", {
                "mailboxId": self.mailbox_id, "dailyLimit": 50, "hourlyLimit": 10,
                "minDelaySeconds": 150, "maxDelaySeconds": 210, "manualLimits": True, "confirmed": True,
            })
            self.assertEqual(status, 200)
            self.assertEqual(payload["mailboxes"][0]["effectiveDailyLimit"], 50)
            self.assertEqual(payload["mailboxes"][0]["effectiveHourlyLimit"], 10)
            self.assertTrue(dispatcher.state["is_running"])
            self.assertTrue(dispatcher._limits_changed_event.is_set())
        finally:
            dispatcher.state["is_running"] = False

    def test_database_migrates_existing_mailbox_table_additively(self):
        legacy_path = Path(self.temp_dir.name) / "legacy.sqlite"
        with sqlite3.connect(legacy_path) as conn:
            conn.execute("""CREATE TABLE mailboxes (
                mailbox_id INTEGER PRIMARY KEY, email TEXT, sender_name TEXT, smtp_server TEXT,
                smtp_port INTEGER, smtp_user TEXT, smtp_password TEXT, daily_limit INTEGER,
                hourly_limit INTEGER, status TEXT, provider_type TEXT, cooldown_until TEXT,
                last_sent_at TEXT, created_at TEXT
            )""")
        db.DB_PATH = legacy_path
        try:
            db.init_campaign_tables()
            with db.get_db_connection() as conn:
                columns = {row["name"] for row in conn.execute("PRAGMA table_info(mailboxes)")}
            self.assertTrue({"min_delay_seconds", "max_delay_seconds", "manual_limits"}.issubset(columns))
        finally:
            db.DB_PATH = self.db_path


if __name__ == "__main__":
    unittest.main()
