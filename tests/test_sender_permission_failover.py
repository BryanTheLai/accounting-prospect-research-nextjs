import smtplib
import unittest
from unittest.mock import MagicMock, patch

from campaign_dispatcher import CampaignDispatcher


class SenderPermissionFailoverTest(unittest.TestCase):
    def test_send_as_denied_preserves_recipient_and_uses_other_mailbox(self):
        dispatcher = CampaignDispatcher()
        dispatcher.state["business_hours_only"] = False
        dispatcher._pause_event.set()
        blocked = {
            "mailbox_id": 1280, "email": "alias@example.com", "sender_name": "Sender",
            "smtp_server": "smtp.invalid", "smtp_port": 587,
            "smtp_user": "user@example.com", "smtp_password": "test-only",
            "provider_type": "MICROSOFT", "daily_limit": 20, "hourly_limit": 5,
        }
        working = {**blocked, "mailbox_id": 984, "email": "sender@example.com"}
        rejected_server = MagicMock()
        rejected_server.sendmail.side_effect = smtplib.SMTPDataError(
            554, b"5.2.252 SendAsDenied; user not allowed to send as alias@example.com"
        )
        accepted_server = MagicMock()
        first_context = MagicMock()
        first_context.__enter__.return_value = rejected_server
        second_context = MagicMock()
        second_context.__enter__.return_value = accepted_server
        with patch("campaign_dispatcher.is_live_dispatch_enabled", return_value=True), \
             patch("campaign_dispatcher.is_live_outreach_ready", return_value=True), \
             patch("campaign_dispatcher.is_domain_in_cooldown", return_value=False), \
             patch("campaign_dispatcher.detect_domain_esp", return_value="MICROSOFT"), \
             patch("campaign_dispatcher.get_available_mailbox", side_effect=[blocked, working]) as pick, \
             patch("campaign_dispatcher.enforce_warmup_limits", side_effect=lambda mb, **kwargs: mb), \
             patch("campaign_dispatcher.get_mailbox_metrics", return_value={"sends_today": 0, "sends_this_hour": 0}), \
             patch("campaign_dispatcher.record_mailbox_error") as mark_error, \
             patch("campaign_dispatcher.record_mailbox_success"), \
             patch("campaign_dispatcher.log_send_event") as log, \
             patch("campaign_dispatcher.smtplib.SMTP", side_effect=[first_context, second_context]):
            dispatcher._worker_loop([{
                "lead_id": "test-source-confirmed", "company_name": "Example",
                "root_domain": "recipient.example", "contact_email": "founder@recipient.example",
            }], "Bookkeeping for Example", "Hello")
        accepted_server.sendmail.assert_called_once()
        mark_error.assert_called_once()
        self.assertEqual(pick.call_args.kwargs["exclude_ids"], [1280])
        statuses = [call.args[4] for call in log.call_args_list]
        self.assertEqual(statuses, ["SENDER_AUTH_ERROR", "SENT"])


if __name__ == "__main__":
    unittest.main()
