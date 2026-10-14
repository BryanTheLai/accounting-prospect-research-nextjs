import smtplib
import threading
import unittest
from contextlib import ExitStack
from unittest.mock import MagicMock, patch

from campaign_dispatcher import CampaignDispatcher


class SubmissionSafetyTest(unittest.TestCase):
    def worker_fixture(self, stack, *, quit_error=None, metrics_error=None, on_login=None):
        dispatcher = CampaignDispatcher()
        dispatcher.state["business_hours_only"] = False
        dispatcher._pause_event.set()
        mailbox = {"mailbox_id": 1, "email": "sender@example.test", "sender_name": "Sender",
                   "smtp_server": "smtp.invalid", "smtp_port": 587, "smtp_user": "sender",
                   "smtp_password": "fixture-only", "daily_limit": 20, "hourly_limit": 5}
        first, second = MagicMock(), MagicMock()
        first.__enter__.return_value.login.side_effect = on_login and (lambda *_: on_login(dispatcher))
        if quit_error:
            first.__exit__.side_effect = quit_error
        for name, value in (
            ("is_live_dispatch_enabled", True), ("is_live_outreach_ready", True),
            ("is_domain_in_cooldown", False), ("detect_domain_esp", "OTHER"),
            ("get_mailbox_metrics", {"sends_today": 0, "sends_this_hour": 0}),
        ):
            stack.enter_context(patch(f"campaign_dispatcher.{name}", return_value=value))
        stack.enter_context(patch("campaign_dispatcher.get_available_mailbox", side_effect=[mailbox, {**mailbox, "mailbox_id": 2}]))
        stack.enter_context(patch("campaign_dispatcher.enforce_warmup_limits", side_effect=lambda mb, **_: mb))
        stack.enter_context(patch("campaign_dispatcher.record_mailbox_success", side_effect=metrics_error))
        stack.enter_context(patch("campaign_dispatcher.record_mailbox_cooldown"))
        stack.enter_context(patch("campaign_dispatcher.smtplib.SMTP", side_effect=[first, second]))
        log = stack.enter_context(patch("campaign_dispatcher.log_send_event"))
        lead = {"lead_id": "submission", "contact_email": "founder@recipient.test", "company_name": "Example"}
        return dispatcher, lead, first.__enter__.return_value, second.__enter__.return_value, log

    def test_pre_rendered_bracketed_company_name_never_reaches_smtp(self):
        with ExitStack() as stack:
            dispatcher, lead, first, second, log = self.worker_fixture(stack)
            lead["company_name"] = "[in]trigue"
            lead["_queued_subject"] = "Subject"
            lead["_queued_body"] = "Help [in]trigue."
            dispatcher._worker_loop([lead], "Subject", "Body")
            first.sendmail.assert_not_called()
            second.sendmail.assert_not_called()
            self.assertEqual(log.call_args.args[4], "FAILED")
            self.assertIn("company_name", log.call_args.kwargs["response_msg"])

    def test_quit_error_cannot_retry_successfully_submitted_message(self):
        for error in (smtplib.SMTPResponseException(421, b"Quit deferred"), smtplib.SMTPServerDisconnected("Quit disconnected")):
            with self.subTest(error=type(error).__name__), ExitStack() as stack:
                dispatcher, lead, first, second, log = self.worker_fixture(stack, quit_error=error)
                dispatcher._worker_loop([lead], "Subject", "Body")
                first.sendmail.assert_called_once()
                second.sendmail.assert_not_called()
                self.assertEqual([call.args[4] for call in log.call_args_list], ["SENT"])

    def test_mailbox_metric_failure_cannot_lose_acceptance_record(self):
        with ExitStack() as stack:
            dispatcher, lead, first, second, log = self.worker_fixture(stack, metrics_error=RuntimeError("Metrics unavailable"))
            dispatcher._worker_loop([lead], "Subject", "Body")
            first.sendmail.assert_called_once()
            second.sendmail.assert_not_called()
            self.assertEqual([call.args[4] for call in log.call_args_list], ["SENT"])

    def test_quit_error_cannot_replace_temporary_data_rejection(self):
        with ExitStack() as stack:
            dispatcher, lead, first, second, log = self.worker_fixture(stack, quit_error=smtplib.SMTPResponseException(550, b"Quit failed"))
            first.sendmail.side_effect = smtplib.SMTPDataError(451, b"Temporary DATA rejection")
            dispatcher._worker_loop([lead], "Subject", "Body")
            second.sendmail.assert_called_once()
            self.assertEqual([call.args[4] for call in log.call_args_list], ["DEFERRED", "SENT"])

    def test_malformed_data_acknowledgement_stays_uncertain(self):
        with ExitStack() as stack:
            dispatcher, lead, first, second, log = self.worker_fixture(stack)
            first.sendmail.side_effect = smtplib.SMTPDataError(-1, b"garbled acknowledgement")
            state = stack.enter_context(patch.object(dispatcher, "_queue_item_status"))
            dispatcher._worker_loop([lead], "Subject", "Body")
            first.sendmail.assert_called_once()
            second.sendmail.assert_not_called()
            self.assertEqual(state.call_args.args, ("submission", "UNCERTAIN"))
            self.assertEqual([call.args[4] for call in log.call_args_list], ["ERROR"])

    def test_stop_during_login_prevents_uncommitted_submission(self):
        with ExitStack() as stack:
            dispatcher, lead, first, _, log = self.worker_fixture(stack, on_login=lambda worker: worker._stop_event.set())
            dispatcher._worker_loop([lead], "Subject", "Body")
            first.sendmail.assert_not_called()
            log.assert_not_called()

    def test_pause_during_login_prevents_uncommitted_submission(self):
        authenticated = threading.Event()
        def pause(worker):
            worker._pause_event.clear()
            authenticated.set()
        with ExitStack() as stack:
            dispatcher, lead, first, _, log = self.worker_fixture(stack, on_login=pause)
            thread = threading.Thread(target=dispatcher._worker_loop, args=([lead], "Subject", "Body"))
            thread.start()
            try:
                self.assertTrue(authenticated.wait(2))
                first.sendmail.assert_not_called()
            finally:
                dispatcher._stop_event.set()
                dispatcher._pause_event.set()
                thread.join(2)
            self.assertFalse(thread.is_alive())
            first.sendmail.assert_not_called()
            log.assert_not_called()

    def test_stop_timeout_cannot_admit_an_overlapping_worker(self):
        dispatcher = CampaignDispatcher()
        dispatcher._thread = MagicMock()
        dispatcher._thread.is_alive.return_value = True
        with self.assertRaises(RuntimeError):
            dispatcher.stop_campaign()
        with self.assertRaises(RuntimeError):
            dispatcher.start_campaign([], "Subject", "Body")
        self.assertTrue(dispatcher._stop_event.is_set())
