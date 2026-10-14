"""Isolated dry-run integration coverage for campaign-local dispatcher hours."""

import tempfile
import threading
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import campaign_database
import campaign_dispatcher as dispatcher_module


class FrozenDateTime(datetime):
    """A fixed Monday at 09:00 PDT, supplied to the dispatcher gate."""

    @classmethod
    def now(cls, tz=None):
        instant = datetime(2026, 3, 9, 16, 0, tzinfo=timezone.utc)
        return instant.astimezone(tz) if tz is not None else instant.replace(tzinfo=None)


class FrozenWeekendDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        instant = datetime(2026, 10, 4, 17, 0, tzinfo=timezone.utc)
        return instant.astimezone(tz) if tz is not None else instant.replace(tzinfo=None)


class TestCampaignDispatchScheduleIntegration(unittest.TestCase):
    def test_schedule_override_releases_an_active_run_without_changing_campaign_hours(self):
        dispatcher = dispatcher_module.CampaignDispatcher()
        schedule = {
            "timezone_name": "America/Los_Angeles",
            "start_minute": 9 * 60,
            "end_minute": 18 * 60,
        }

        with patch.object(dispatcher_module, "datetime", FrozenWeekendDateTime):
            self.assertIsNotNone(dispatcher._schedule_closed_message(schedule))
        dispatcher.state["is_running"] = True
        dispatcher.state["queue_pending"] = 1
        dispatcher.override_current_schedule()

        self.assertTrue(dispatcher.state["schedule_override_active"])
        self.assertIsNone(dispatcher._schedule_closed_message(schedule))
        with patch.object(dispatcher_module, "datetime", FrozenWeekendDateTime):
            self.assertIsNotNone(dispatcher_module._campaign_schedule_closed_message(schedule))

    def test_confirmed_schedule_override_wakes_a_worker_waiting_outside_campaign_hours(self):
        with tempfile.TemporaryDirectory(prefix="outbounder-dispatch-override-") as temp_dir:
            database_path = Path(temp_dir) / "isolated-dispatch.sqlite3"
            with patch.object(campaign_database, "DB_PATH", database_path):
                campaign_database.init_campaign_tables()
                campaign_database.seed_default_campaigns()
                dispatcher = dispatcher_module.CampaignDispatcher()
                mailbox = {
                    "mailbox_id": 0,
                    "email": "test-sender@example.test",
                    "sender_name": "Test Sender",
                    "smtp_server": "smtp.invalid.test",
                    "smtp_port": 2525,
                    "smtp_user": "not-used",
                    "smtp_password": "not-used",
                    "daily_limit": 20,
                    "hourly_limit": 4,
                    "provider_type": "OTHER",
                }
                schedule_checked = threading.Event()

                def closed_until_override(_schedule):
                    schedule_checked.set()
                    return None if dispatcher._schedule_override_event.is_set() else "outside campaign hours"

                lead = {
                    "lead_id": "schedule-override-worker-lead",
                    "campaign_id": "yc_us_expansion",
                    "contact_email": "founder@example.test",
                    "company_name": "California Test Startup",
                    "root_domain": "example.test",
                    "buyer_name": "Test Founder",
                    "_campaign_schedule": {
                        "timezone_name": "America/Los_Angeles",
                        "start_minute": 540,
                        "end_minute": 1080,
                    },
                }
                with (
                    patch.object(dispatcher_module, "is_live_dispatch_enabled", return_value=False),
                    patch.object(dispatcher_module, "detect_domain_esp", return_value="OTHER"),
                    patch.object(dispatcher_module, "get_available_mailbox", return_value=mailbox),
                    patch.object(dispatcher_module, "get_mailbox_metrics", return_value={"sends_today": 0, "sends_this_hour": 0}),
                    patch.object(dispatcher_module, "enforce_warmup_limits", side_effect=lambda value, **_kwargs: value),
                    patch.object(dispatcher_module, "is_government_affiliated", return_value=(False, "")),
                    patch.object(dispatcher_module, "is_domain_in_cooldown", return_value=False),
                    patch.object(dispatcher_module, "_campaign_schedule_closed_message", side_effect=closed_until_override),
                    patch.object(dispatcher_module.smtplib, "SMTP", side_effect=AssertionError("dry run must not construct SMTP")) as smtp_constructor,
                ):
                    dispatcher.start_campaign(
                        leads=[lead],
                        subject_tmpl="Books for {{company_name}}",
                        body_tmpl="Hello {{buyer_name}}",
                    )
                    worker = dispatcher._thread
                    self.assertIsNotNone(worker)
                    self.assertTrue(schedule_checked.wait(timeout=2), "worker did not reach the closed schedule gate")
                    dispatcher.override_current_schedule()
                    worker.join(timeout=5)
                    if worker.is_alive():
                        dispatcher.stop_campaign()
                        worker.join(timeout=2)

                self.assertFalse(worker.is_alive(), "override did not release the waiting worker")
                self.assertTrue(dispatcher.state["schedule_override_active"])
                self.assertEqual(dispatcher.state["queue_pending"], 0)
                smtp_constructor.assert_not_called()

    def test_california_schedule_reaches_worker_and_dry_run_never_constructs_smtp(self):
        with tempfile.TemporaryDirectory(prefix="outbounder-dispatch-test-") as temp_dir:
            database_path = Path(temp_dir) / "isolated-dispatch.sqlite3"
            with patch.object(campaign_database, "DB_PATH", database_path):
                campaign_database.init_campaign_tables()

                dry_run_mailbox = {
                    "mailbox_id": 0,
                    "email": "test-sender@example.test",
                    "sender_name": "Test Sender",
                    "smtp_server": "smtp.invalid.test",
                    "smtp_port": 2525,
                    "smtp_user": "not-used",
                    "smtp_password": "not-used",
                    "daily_limit": 20,
                    "hourly_limit": 4,
                    "provider_type": "OTHER",
                }
                schedule = {
                    "timezone_name": "America/Los_Angeles",
                    "start_minute": 9 * 60,
                    "end_minute": 18 * 60,
                }

                with (
                    patch.object(dispatcher_module, "datetime", FrozenDateTime),
                    patch.object(dispatcher_module, "is_live_dispatch_enabled", return_value=False),
                    patch.object(dispatcher_module, "detect_domain_esp", return_value="OTHER"),
                    patch.object(dispatcher_module, "get_available_mailbox", return_value=dry_run_mailbox),
                    patch.object(dispatcher_module, "get_mailbox_metrics", return_value={"sends_today": 0, "sends_this_hour": 0}),
                    patch.object(dispatcher_module, "enforce_warmup_limits", side_effect=lambda mailbox, **_kwargs: mailbox),
                    patch.object(dispatcher_module, "is_government_affiliated", return_value=(False, "")),
                    patch.object(dispatcher_module, "is_domain_in_cooldown", return_value=False),
                    patch.object(dispatcher_module.smtplib, "SMTP", side_effect=AssertionError("dry run must not construct SMTP")) as smtp_constructor,
                ):
                    dispatcher = dispatcher_module.CampaignDispatcher()
                    self.assertFalse(dispatcher.state["live_dispatch"])

                    gate_observations = []
                    original_gate = dispatcher_module._campaign_schedule_closed_message

                    def capture_gate(run_schedule):
                        gate_observations.append(run_schedule)
                        return original_gate(run_schedule)

                    lead = {
                        "lead_id": "isolated-california-lead",
                        "campaign_id": "yc_us_expansion",
                        "contact_email": "founder@example.test",
                        "company_name": "California Test Startup",
                        "root_domain": "example.test",
                        "buyer_name": "Test Founder",
                    }

                    with patch.object(dispatcher_module, "_campaign_schedule_closed_message", side_effect=capture_gate):
                        dispatcher.start_campaign(
                            leads=[lead],
                            subject_tmpl="Books for {{company_name}}",
                            body_tmpl="Hello {{buyer_name}}",
                        )
                        worker = dispatcher._thread
                        self.assertIsNotNone(worker)
                        worker.join(timeout=5)
                        if worker.is_alive():
                            dispatcher.stop_campaign()
                            worker.join(timeout=2)

                    self.assertFalse(worker.is_alive(), "isolated worker did not finish")
                    self.assertFalse(dispatcher.state["live_dispatch"])
                    self.assertEqual(len(gate_observations), 1)
                    self.assertEqual(gate_observations[0], schedule)
                    smtp_constructor.assert_not_called()

                    conn = campaign_database.get_db_connection()
                    try:
                        send = conn.execute(
                            "SELECT status, subject, body, response_msg FROM campaign_sends WHERE lead_id = ?",
                            (lead["lead_id"],),
                        ).fetchone()
                    finally:
                        conn.close()
                    self.assertIsNotNone(send)
                    self.assertEqual(send["status"], "SENT")
                    self.assertEqual(send["subject"], "Books for California Test Startup")
                    self.assertEqual(send["body"], "Hello Test Founder")
                    self.assertIn("[DRY-RUN SAFETY SHIELD]", send["response_msg"])

    def test_campaign_schedule_is_rechecked_before_each_smtp_attempt(self):
        with tempfile.TemporaryDirectory(prefix="outbounder-hours-close-test-") as temp_dir:
            database_path = Path(temp_dir) / "isolated-dispatch.sqlite3"
            with patch.object(campaign_database, "DB_PATH", database_path):
                campaign_database.init_campaign_tables()
                campaign_database.seed_default_campaigns()

                mailbox = {
                    "mailbox_id": 0,
                    "email": "test-sender@example.test",
                    "sender_name": "Test Sender",
                    "smtp_server": "smtp.invalid.test",
                    "smtp_port": 2525,
                    "smtp_user": "not-used",
                    "smtp_password": "not-used",
                    "daily_limit": 20,
                    "hourly_limit": 4,
                    "provider_type": "OTHER",
                }
                dispatcher = dispatcher_module.CampaignDispatcher()
                dispatcher.state["business_hours_only"] = False
                gate_checks = []

                def gate_passes_then_closes(schedule):
                    gate_checks.append(schedule)
                    if len(gate_checks) == 1:
                        return None
                    dispatcher._stop_event.set()
                    return "outside California hours"

                lead = {
                    "lead_id": "isolated-after-close-lead",
                    "campaign_id": "yc_us_expansion",
                    "contact_email": "founder@example.test",
                    "company_name": "California Test Startup",
                    "root_domain": "example.test",
                    "buyer_name": "Test Founder",
                }

                with (
                    patch.object(dispatcher_module, "is_live_dispatch_enabled", return_value=True),
                    patch.object(dispatcher_module, "detect_domain_esp", return_value="OTHER"),
                    patch.object(dispatcher_module, "get_available_mailbox", return_value=mailbox),
                    patch.object(dispatcher_module, "get_mailbox_metrics", return_value={"sends_today": 0, "sends_this_hour": 0}),
                    patch.object(dispatcher_module, "enforce_warmup_limits", side_effect=lambda value, **_kwargs: value),
                    patch.object(dispatcher_module, "is_government_affiliated", return_value=(False, "")),
                    patch.object(dispatcher_module, "is_domain_in_cooldown", return_value=False),
                    patch.object(dispatcher_module, "is_live_outreach_ready", return_value=True),
                    patch.object(dispatcher_module, "_campaign_schedule_closed_message", side_effect=gate_passes_then_closes),
                    patch.object(dispatcher_module.smtplib, "SMTP", side_effect=AssertionError("campaign closed before SMTP")) as smtp_constructor,
                ):
                    dispatcher.start_campaign(
                        leads=[lead],
                        subject_tmpl="Books for {{company_name}}",
                        body_tmpl="Hello {{buyer_name}}",
                    )
                    worker = dispatcher._thread
                    self.assertIsNotNone(worker)
                    worker.join(timeout=5)
                    if worker.is_alive():
                        dispatcher.stop_campaign()
                        worker.join(timeout=2)

                self.assertFalse(worker.is_alive(), "isolated worker did not finish")
                self.assertEqual(len(gate_checks), 2)
                self.assertEqual(gate_checks[1], {
                    "timezone_name": "America/Los_Angeles",
                    "start_minute": 9 * 60,
                    "end_minute": 18 * 60,
                })
                smtp_constructor.assert_not_called()

    def test_campaign_window_is_checked_again_after_smtp_login_before_sendmail(self):
        with tempfile.TemporaryDirectory(prefix="outbounder-hours-smtp-auth-test-") as temp_dir:
            database_path = Path(temp_dir) / "isolated-dispatch.sqlite3"
            with patch.object(campaign_database, "DB_PATH", database_path):
                campaign_database.init_campaign_tables()
                campaign_database.seed_default_campaigns()
                dispatcher = dispatcher_module.CampaignDispatcher()
                dispatcher.state["business_hours_only"] = False
                mailbox = {
                    "mailbox_id": 0,
                    "email": "test-sender@example.test",
                    "sender_name": "Test Sender",
                    "smtp_server": "smtp.invalid.test",
                    "smtp_port": 2525,
                    "smtp_user": "not-used",
                    "smtp_password": "not-used",
                    "daily_limit": 20,
                    "hourly_limit": 4,
                    "provider_type": "OTHER",
                }
                smtp_server = MagicMock()
                smtp_constructor = MagicMock()
                smtp_constructor.return_value.__enter__.return_value = smtp_server
                gate_checks = []

                def gate_closes_during_auth(schedule):
                    gate_checks.append(schedule)
                    if len(gate_checks) < 3:
                        return None
                    dispatcher._stop_event.set()
                    return "outside California hours"

                lead = {
                    "lead_id": "isolated-after-auth-lead",
                    "campaign_id": "yc_us_expansion",
                    "contact_email": "founder@example.test",
                    "company_name": "California Test Startup",
                    "root_domain": "example.test",
                    "buyer_name": "Test Founder",
                }
                with (
                    patch.object(dispatcher_module, "is_live_dispatch_enabled", return_value=True),
                    patch.object(dispatcher_module, "detect_domain_esp", return_value="OTHER"),
                    patch.object(dispatcher_module, "get_available_mailbox", return_value=mailbox),
                    patch.object(dispatcher_module, "get_mailbox_metrics", return_value={"sends_today": 0, "sends_this_hour": 0}),
                    patch.object(dispatcher_module, "enforce_warmup_limits", side_effect=lambda value, **_kwargs: value),
                    patch.object(dispatcher_module, "is_government_affiliated", return_value=(False, "")),
                    patch.object(dispatcher_module, "is_domain_in_cooldown", return_value=False),
                    patch.object(dispatcher_module, "is_live_outreach_ready", return_value=True),
                    patch.object(dispatcher_module, "_campaign_schedule_closed_message", side_effect=gate_closes_during_auth),
                    patch.object(dispatcher_module.smtplib, "SMTP", smtp_constructor),
                ):
                    dispatcher.start_campaign(
                        leads=[lead],
                        subject_tmpl="Books for {{company_name}}",
                        body_tmpl="Hello {{buyer_name}}",
                    )
                    worker = dispatcher._thread
                    self.assertIsNotNone(worker)
                    worker.join(timeout=5)
                    if worker.is_alive():
                        dispatcher.stop_campaign()
                        worker.join(timeout=2)

                self.assertFalse(worker.is_alive(), "isolated worker did not finish")
                self.assertEqual(len(gate_checks), 3)
                smtp_constructor.assert_called_once()
                smtp_server.login.assert_called_once_with("not-used", "not-used")
                smtp_server.sendmail.assert_not_called()

    def test_reply_arriving_after_queueing_is_rechecked_after_login_and_blocks_sendmail(self):
        with tempfile.TemporaryDirectory(prefix="outbounder-inbound-queue-stop-") as temp_dir:
            database_path = Path(temp_dir) / "isolated-dispatch.sqlite3"
            with patch.object(campaign_database, "DB_PATH", database_path):
                campaign_database.init_campaign_tables()
                campaign_database.seed_default_campaigns()
                dispatcher = dispatcher_module.CampaignDispatcher()
                dispatcher.state["business_hours_only"] = False
                mailbox = {
                    "mailbox_id": 0,
                    "email": "test-sender@example.test",
                    "sender_name": "Test Sender",
                    "smtp_server": "smtp.invalid.test",
                    "smtp_port": 2525,
                    "smtp_user": "not-used",
                    "smtp_password": "not-used",
                    "daily_limit": 20,
                    "hourly_limit": 4,
                    "provider_type": "OTHER",
                }
                smtp_server = MagicMock()
                smtp_constructor = MagicMock()
                smtp_constructor.return_value.__enter__.return_value = smtp_server
                lead = {
                    "lead_id": "inbound-reply-queued-lead",
                    "campaign_id": "yc_us_expansion",
                    "contact_email": "founder@example.test",
                    "company_name": "California Test Startup",
                    "root_domain": "example.test",
                    "buyer_name": "Test Founder",
                }
                with (
                    patch.object(dispatcher_module, "is_live_dispatch_enabled", return_value=True),
                    patch.object(dispatcher_module, "detect_domain_esp", return_value="OTHER"),
                    patch.object(dispatcher_module, "get_available_mailbox", return_value=mailbox),
                    patch.object(dispatcher_module, "get_mailbox_metrics", return_value={"sends_today": 0, "sends_this_hour": 0}),
                    patch.object(dispatcher_module, "enforce_warmup_limits", side_effect=lambda value, **_kwargs: value),
                    patch.object(dispatcher_module, "is_government_affiliated", return_value=(False, "")),
                    patch.object(dispatcher_module, "is_domain_in_cooldown", return_value=False),
                    patch.object(dispatcher_module, "is_live_outreach_ready", side_effect=[True, False]) as ready_check,
                    patch.object(dispatcher_module, "_campaign_schedule_closed_message", return_value=None),
                    patch.object(dispatcher_module.smtplib, "SMTP", smtp_constructor),
                ):
                    dispatcher.start_campaign(
                        leads=[lead],
                        subject_tmpl="Books for {{company_name}}",
                        body_tmpl="Hello {{buyer_name}}",
                    )
                    worker = dispatcher._thread
                    self.assertIsNotNone(worker)
                    worker.join(timeout=5)
                    if worker.is_alive():
                        dispatcher.stop_campaign()
                        worker.join(timeout=2)

                self.assertFalse(worker.is_alive(), "isolated worker did not finish")
                self.assertEqual(ready_check.call_count, 2)
                smtp_server.login.assert_called_once_with("not-used", "not-used")
                smtp_server.sendmail.assert_not_called()
                connection = campaign_database.get_db_connection()
                try:
                    event = connection.execute(
                        "SELECT status, response_msg FROM campaign_sends WHERE lead_id = ?",
                        (lead["lead_id"],),
                    ).fetchone()
                finally:
                    connection.close()
                self.assertEqual(event["status"], "SUPPRESSED")
                self.assertIn("before SMTP send", event["response_msg"])


if __name__ == "__main__":
    unittest.main()
