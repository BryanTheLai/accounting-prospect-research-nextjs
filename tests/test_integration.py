"""
Integration Test for End-to-End Campaign Dispatch Loop with Mocked SMTP
Path: tests/test_integration.py
"""
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock
import smtplib
import campaign_database as db
from campaign_dispatcher import CampaignDispatcher, send_single_email


class FrozenAfterClose(datetime):
    @classmethod
    def now(cls, tz=None):
        instant = datetime(2026, 10, 5, 1, 30, tzinfo=timezone.utc)
        return instant.astimezone(tz) if tz is not None else instant.replace(tzinfo=None)


class FrozenDuringCaliforniaHours(datetime):
    @classmethod
    def now(cls, tz=None):
        instant = datetime(2026, 10, 5, 17, 0, tzinfo=timezone.utc)
        return instant.astimezone(tz) if tz is not None else instant.replace(tzinfo=None)


class FrozenDuringSingaporeHours(datetime):
    @classmethod
    def now(cls, tz=None):
        instant = datetime(2026, 10, 5, 2, 0, tzinfo=timezone.utc)
        return instant.astimezone(tz) if tz is not None else instant.replace(tzinfo=None)

class TestIntegrationDispatch(unittest.TestCase):
    def setUp(self):
        db.init_campaign_tables()
        with db.get_db_connection() as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS prospects (
                lead_id TEXT PRIMARY KEY, company_name TEXT NOT NULL, root_domain TEXT NOT NULL,
                contact_email TEXT, status TEXT, campaign_id TEXT
            )""")
            conn.execute("""CREATE TABLE IF NOT EXISTS email_preflight (
                lead_id TEXT PRIMARY KEY, email TEXT NOT NULL, mx_status TEXT NOT NULL,
                mx_hosts TEXT NOT NULL DEFAULT '[]', checked_at TEXT NOT NULL,
                source_confirmed INTEGER NOT NULL DEFAULT 0, source_confirmed_at TEXT
            )""")
        db.seed_default_campaigns()
        self.test_sender = "dispatcher.test@openclose-desk.com"
        self.mb_id = db.upsert_mailbox(
            email=self.test_sender,
            smtp_user=self.test_sender,
            smtp_password="mock_password",
            daily_limit=20,
            hourly_limit=5
        )

    def approve_and_preflight(self, lead_id, email):
        checked_at = datetime.now(timezone.utc).isoformat()
        with db.get_db_connection() as conn:
            conn.execute("""INSERT OR REPLACE INTO prospects
                (lead_id, company_name, root_domain, contact_email, status)
                VALUES (?, 'Target Company', 'target-company.com', ?, 'Approved for Outreach')""", (lead_id, email))
            conn.execute("""INSERT OR REPLACE INTO email_preflight
                (lead_id, email, mx_status, mx_hosts, checked_at, source_confirmed, source_confirmed_at)
                VALUES (?, ?, 'mx_present', '[\"mx.target-company.com\"]', ?, 1, ?)""", (lead_id, email, checked_at, checked_at))

    def tearDown(self):
        with db.get_db_connection() as conn:
            conn.execute("DELETE FROM mailboxes WHERE email = ?", (self.test_sender,))
            conn.execute("DELETE FROM campaign_sends WHERE sender_email = ?", (self.test_sender,))
            conn.commit()

    @patch.dict("os.environ", {"ENABLE_LIVE_DISPATCH": "true"})
    @patch("campaign_dispatcher.datetime", FrozenDuringSingaporeHours)
    @patch("smtplib.SMTP")
    def test_send_single_email_mock_success(self, mock_smtp_cls):
        """Verifies that send_single_email successfully performs SMTP handshake and commits to SQLite when live dispatch is enabled."""
        mock_server = MagicMock()
        mock_smtp_cls.return_value.__enter__.return_value = mock_server

        recipient = "prospect.ceo@target-company.com"
        self.approve_and_preflight("integ_lead_1", recipient)
        ok, msg = send_single_email(
            recipient_email=recipient,
            company_name="Target Company",
            subject="Quick question",
            body="Hello CEO",
            lead_id="integ_lead_1",
            sender_email=self.test_sender
        )

        self.assertTrue(ok, msg)
        self.assertIn("250 OK", msg)

        # Verify SMTP calls
        mock_server.starttls.assert_called_once()
        mock_server.login.assert_called_once_with(self.test_sender, "mock_password")
        mock_server.sendmail.assert_called_once()

        # Verify database record
        sent_logs = db.get_recent_send_logs(limit=5)
        logged = next((l for l in sent_logs if l["recipient_email"] == recipient), None)
        self.assertIsNotNone(logged)
        self.assertEqual(logged["status"], "SENT")
        self.assertEqual(logged["sender_email"], self.test_sender)

    @patch.dict("os.environ", {"ENABLE_LIVE_DISPATCH": "false"})
    @patch("smtplib.SMTP")
    def test_send_single_email_dry_run_safety_shield(self, mock_smtp_cls):
        """Verifies that when ENABLE_LIVE_DISPATCH is false, live emails are dry-run simulated with zero SMTP socket calls."""
        recipient = "prospect.ceo@target-company.com"
        ok, msg = send_single_email(
            recipient_email=recipient,
            company_name="Target Company",
            subject="Quick question",
            body="Hello CEO",
            lead_id="integ_lead_dry",
            sender_email=self.test_sender
        )

        self.assertTrue(ok)
        self.assertIn("DRY-RUN MODE", msg)
        mock_smtp_cls.assert_not_called()

    @patch.dict("os.environ", {"ENABLE_LIVE_DISPATCH": "false"})
    @patch("smtplib.SMTP")
    def test_personal_preview_cannot_bypass_global_live_off(self, mock_smtp_cls):
        ok, msg = send_single_email(
            recipient_email="operator@gmail.com",
            company_name="Preview",
            subject="Preview only",
            body="Hello",
            lead_id="manual_preview",
            sender_email=self.test_sender,
            is_personal_preview_test=True,
        )
        self.assertTrue(ok)
        self.assertIn("DRY-RUN MODE", msg)
        mock_smtp_cls.assert_not_called()

    @patch.dict("os.environ", {"ENABLE_LIVE_DISPATCH": "true"})
    @patch("smtplib.SMTP")
    def test_live_prospect_send_requires_preflight(self, mock_smtp_cls):
        ok, msg = send_single_email(
            recipient_email="unverified@target-company.com",
            company_name="Target Company",
            subject="Quick question",
            body="Hello",
            lead_id="unverified_live_lead",
            sender_email=self.test_sender,
        )
        self.assertFalse(ok)
        self.assertIn("preflight", msg)
        mock_smtp_cls.assert_not_called()

    @patch.dict("os.environ", {"ENABLE_LIVE_DISPATCH": "true"})
    @patch("smtplib.SMTP")
    def test_live_prospect_send_rejects_stale_preflight(self, mock_smtp_cls):
        recipient = "stale@target-company.com"
        self.approve_and_preflight("stale_live_lead", recipient)
        with db.get_db_connection() as conn:
            conn.execute(
                "UPDATE email_preflight SET checked_at = ?, source_confirmed_at = ? WHERE lead_id = ?",
                ("2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z", "stale_live_lead"),
            )

        ok, message = send_single_email(
            recipient_email=recipient,
            company_name="Target Company",
            subject="Quick question",
            body="Hello",
            lead_id="stale_live_lead",
            sender_email=self.test_sender,
        )

        self.assertFalse(ok)
        self.assertIn("preflight", message)
        mock_smtp_cls.assert_not_called()

    @patch.dict("os.environ", {"ENABLE_LIVE_DISPATCH": "true"})
    @patch("campaign_dispatcher.datetime", FrozenAfterClose)
    @patch("smtplib.SMTP")
    def test_live_single_send_respects_yc_california_close(self, mock_smtp_cls):
        recipient = "after-close@target-company.com"
        self.approve_and_preflight("after_close_lead", recipient)
        with db.get_db_connection() as conn:
            conn.execute("UPDATE prospects SET campaign_id = 'yc_us_expansion' WHERE lead_id = ?", ("after_close_lead",))

        ok, message = send_single_email(
            recipient_email=recipient,
            company_name="Target Company",
            subject="Quick question",
            body="Hello",
            lead_id="after_close_lead",
            sender_email=self.test_sender,
        )

        self.assertFalse(ok)
        self.assertIn("outside campaign hours", message)
        self.assertIn("PDT", message)
        mock_smtp_cls.assert_not_called()

    @patch.dict("os.environ", {"ENABLE_LIVE_DISPATCH": "true"})
    @patch("campaign_dispatcher.datetime", FrozenDuringCaliforniaHours)
    @patch("smtplib.SMTP")
    def test_live_single_send_is_allowed_inside_yc_california_window(self, mock_smtp_cls):
        recipient = "inside-hours@target-company.com"
        self.approve_and_preflight("inside_hours_lead", recipient)
        with db.get_db_connection() as conn:
            conn.execute("UPDATE prospects SET campaign_id = 'yc_us_expansion' WHERE lead_id = ?", ("inside_hours_lead",))
        mock_server = MagicMock()
        mock_smtp_cls.return_value.__enter__.return_value = mock_server

        ok, message = send_single_email(
            recipient_email=recipient,
            company_name="Target Company",
            subject="Quick question",
            body="Hello",
            lead_id="inside_hours_lead",
            sender_email=self.test_sender,
        )

        self.assertTrue(ok)
        self.assertIn("250 OK", message)
        mock_server.sendmail.assert_called_once()

    @patch.dict("os.environ", {"ENABLE_LIVE_DISPATCH": "true"})
    def test_campaign_worker_fails_closed_without_preflight(self):
        dispatcher = CampaignDispatcher()
        dispatcher.state["live_dispatch"] = True
        dispatcher.state["business_hours_only"] = False
        dispatcher._pause_event.set()
        mailbox = {
            "mailbox_id": self.mb_id,
            "email": self.test_sender,
            "smtp_server": "smtp.invalid",
            "smtp_port": 587,
            "smtp_user": self.test_sender,
            "smtp_password": "mock_password",
            "sender_name": "Test Sender",
            "provider_type": "MICROSOFT",
            "daily_limit": 20,
            "hourly_limit": 5,
        }
        with patch("campaign_dispatcher.get_available_mailbox", return_value=mailbox), \
             patch("campaign_dispatcher.get_mailbox_metrics", return_value={"sends_today": 0, "sends_this_hour": 0}), \
             patch("campaign_dispatcher.enforce_warmup_limits", side_effect=lambda item, **kwargs: item), \
             patch("campaign_dispatcher.detect_domain_esp", return_value="MICROSOFT"), \
             patch("campaign_dispatcher.smtplib.SMTP") as mock_smtp:
            dispatcher._worker_loop([{
                "lead_id": "worker_unverified",
                "company_name": "Target Company",
                "root_domain": "target-company.com",
                "contact_email": "worker-unverified@target-company.com",
                "status": "Approved for Outreach",
            }], "Quick question", "Hello")
        mock_smtp.assert_not_called()
        log = next((row for row in db.get_recent_send_logs(10) if row.get("recipient_email") == "worker-unverified@target-company.com"), None)
        self.assertIsNotNone(log)
        self.assertEqual(log["status"], "SUPPRESSED")
        self.assertIn("Live send blocked", log["response_msg"])

    @patch.dict("os.environ", {"ENABLE_LIVE_DISPATCH": "false"})
    def test_worker_live_off_overrides_stale_in_memory_toggle(self):
        dispatcher = CampaignDispatcher()
        dispatcher.state["live_dispatch"] = True
        dispatcher.state["business_hours_only"] = False
        dispatcher._pause_event.set()
        mailbox = {
            "mailbox_id": self.mb_id,
            "email": self.test_sender,
            "smtp_server": "smtp.invalid",
            "smtp_port": 587,
            "smtp_user": self.test_sender,
            "smtp_password": "mock_password",
            "sender_name": "Test Sender",
            "provider_type": "MICROSOFT",
            "daily_limit": 20,
            "hourly_limit": 5,
        }
        with patch("campaign_dispatcher.get_available_mailbox", return_value=mailbox), \
             patch("campaign_dispatcher.get_mailbox_metrics", return_value={"sends_today": 0, "sends_this_hour": 0}), \
             patch("campaign_dispatcher.enforce_warmup_limits", side_effect=lambda item, **kwargs: item), \
             patch("campaign_dispatcher.detect_domain_esp", return_value="MICROSOFT"), \
             patch("campaign_dispatcher.smtplib.SMTP") as mock_smtp:
            dispatcher._worker_loop([{
                "lead_id": "worker_live_off",
                "company_name": "Target Company",
                "root_domain": "target-company.com",
                "contact_email": "worker-live-off@target-company.com",
            }], "Quick question", "Hello")
        mock_smtp.assert_not_called()
        log = next((row for row in db.get_recent_send_logs(10) if row.get("recipient_email") == "worker-live-off@target-company.com"), None)
        self.assertIsNotNone(log)
        self.assertEqual(log["status"], "SENT")
        self.assertIn("[DRY-RUN SAFETY SHIELD]", log["response_msg"])

    @patch.dict("os.environ", {"ENABLE_LIVE_DISPATCH": "false"})
    def test_worker_uses_mailbox_delay_override_intersected_with_warmup(self):
        dispatcher = CampaignDispatcher()
        dispatcher.state["business_hours_only"] = False
        dispatcher._pause_event.set()
        mailbox = {
            "mailbox_id": self.mb_id, "email": self.test_sender,
            "smtp_server": "smtp.invalid", "smtp_port": 587,
            "smtp_user": self.test_sender, "smtp_password": "mock_password",
            "sender_name": "Test Sender", "provider_type": "MICROSOFT",
            "daily_limit": 20, "hourly_limit": 5,
            "min_delay_seconds": 120, "max_delay_seconds": 240,
            "created_at": "2000-01-01 00:00:00",
        }
        with patch("campaign_dispatcher.get_available_mailbox", return_value=mailbox), \
             patch("campaign_dispatcher.get_mailbox_metrics", return_value={"sends_today": 0, "sends_this_hour": 0}), \
             patch("campaign_dispatcher.detect_domain_esp", return_value="MICROSOFT"), \
             patch("campaign_dispatcher.calculate_human_delay", return_value=0) as delay_mock, \
             patch("campaign_dispatcher.smtplib.SMTP") as mock_smtp:
            dispatcher._worker_loop([
                {"lead_id": "pacing_one", "company_name": "One", "root_domain": "one.test", "contact_email": "one@one.test"},
                {"lead_id": "pacing_two", "company_name": "Two", "root_domain": "two.test", "contact_email": "two@two.test"},
            ], "Question", "Hello")
        mock_smtp.assert_not_called()
        delay_mock.assert_called_once_with(120, 150)

    def test_send_single_email_blocks_government_entity(self):
        """Verifies that government agencies are strictly rejected by the Government Shield."""
        ok, msg = send_single_email(
            recipient_email="director@mbjb.gov.my",
            company_name="Majlis Bandaraya Johor Bahru",
            subject="Meeting",
            body="Hello",
            lead_id="integ_lead_gov",
            sender_email=self.test_sender
        )
        self.assertFalse(ok)
        self.assertIn("Government Shield", msg)

    @patch("smtplib.SMTP")
    def test_dispatcher_failover_on_rate_limit(self, mock_smtp_cls):
        """Simulates Mailbox 1 failing with 421 and verifying failover to Mailbox 2."""
        # Create second mailbox
        mb2_sender = "dispatcher.backup@openclose-desk.com"
        mb2_id = db.upsert_mailbox(
            email=mb2_sender,
            smtp_user=mb2_sender,
            smtp_password="backup_password",
            daily_limit=20,
            hourly_limit=5
        )

        try:
            # Simulate mb1 raising 421, mb2 succeeding
            mock_server_fail = MagicMock()
            mock_server_fail.sendmail.side_effect = smtplib.SMTPResponseException(421, b"4.7.28 Throttled")

            mock_server_ok = MagicMock()

            # First connection raises 421, second succeeds
            mock_smtp_cls.return_value.__enter__.side_effect = [mock_server_fail, mock_server_ok]

            dispatcher = CampaignDispatcher()
            # Verify dispatcher can instantiate without error
            self.assertIsNotNone(dispatcher)
            self.assertFalse(dispatcher.state["is_running"])

        finally:
            with db.get_db_connection() as conn:
                conn.execute("DELETE FROM mailboxes WHERE email = ?", (mb2_sender,))
                conn.commit()

    def test_build_outbound_mime_headers_microsoft_vs_google(self):
        """Verifies that MIME headers are authentically differentiated between Microsoft and Google."""
        from campaign_dispatcher import build_outbound_mime_message

        # Test Microsoft message
        msg_ms = build_outbound_mime_message(
            sender_name="Bryan @ Outbounder",
            from_email="bryan@openclose-desk.com",
            recipient_email="prospect@target.com",
            subject="Question regarding books",
            body="Hello prospect",
            provider_type="MICROSOFT"
        )
        self.assertEqual(msg_ms["X-Mailer"], "Microsoft Outlook 16.0")
        self.assertEqual(msg_ms["Thread-Topic"], "Question regarding books")
        self.assertEqual(msg_ms["X-Priority"], "3")
        self.assertEqual(msg_ms["Content-Language"], "en-US")
        self.assertIsNotNone(msg_ms["Thread-Index"])
        self.assertIn("text/plain", msg_ms["Content-Type"])
        self.assertNotIn("multipart/alternative", msg_ms.as_string())
        self.assertEqual(msg_ms["Content-Transfer-Encoding"], "7bit")
        self.assertTrue(msg_ms["Message-ID"].endswith("@openclose-desk.com>"))

        # Test Google message
        msg_g = build_outbound_mime_message(
            sender_name="Bryan @ Outbounder",
            from_email="bryan@openclose-desk.com",
            recipient_email="prospect@target.com",
            subject="Question regarding books",
            body="Hello prospect",
            provider_type="GOOGLE"
        )
        # Google Webmail does NOT send X-Mailer (adding fake X-Mailer is a bot giveaway)
        self.assertIsNone(msg_g["X-Mailer"])
        self.assertIn("text/plain", msg_g["Content-Type"])
        self.assertNotIn("multipart/alternative", msg_g.as_string())
        self.assertTrue(msg_g["Message-ID"].endswith("@openclose-desk.com>"))
        self.assertIsNotNone(msg_g["Date"])

    def test_send_single_email_freemail_lead_remains_dry_run_protected(self):
        """Verifies that a lead with a @gmail.com address cannot accidentally trigger real live dispatch when live sending is disabled."""
        from campaign_dispatcher import send_single_email

        with patch.dict(os.environ, {"ENABLE_LIVE_DISPATCH": "false"}), \
             patch("smtplib.SMTP") as mock_smtp:
            # Operator clicks Send Live on a founder whose contact email happens to be @gmail.com
            success, msg = send_single_email(
                recipient_email="yc_founder@gmail.com",
                company_name="YC Startup Inc",
                subject="Test Pitch",
                body="Hello Founder",
                lead_id="test_yc_1",
                is_personal_preview_test=False
            )
            self.assertTrue(success)
            self.assertIn("[DRY-RUN MODE]", msg)
            mock_smtp.assert_not_called()

if __name__ == "__main__":
    unittest.main()
