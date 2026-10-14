"""
Unit & Integration Tests for Persistent Campaign Database, Multi-Mailbox Pool & Suppression
Path: tests/test_campaign_database.py
"""
import unittest
import sqlite3
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch
import campaign_database as db

class TestCampaignDatabase(unittest.TestCase):
    def setUp(self):
        """Initializes tables before each test."""
        self.temp_dir = tempfile.TemporaryDirectory(prefix="campaign-database-test-")
        self.addCleanup(self.temp_dir.cleanup)
        db_path_patch = patch.object(db, "DB_PATH", Path(self.temp_dir.name) / "campaign.sqlite3")
        db_path_patch.start()
        self.addCleanup(db_path_patch.stop)
        db.init_campaign_tables()

    def test_mailbox_crud_and_metrics(self):
        """Tests inserting, querying, and updating mailbox pool."""
        test_email = "test.worker@openclose-desk.com"
        mb_id = db.upsert_mailbox(
            email=test_email,
            smtp_user=test_email,
            smtp_password="dummy_password",
            sender_name="Bryan Test",
            daily_limit=15,
            hourly_limit=3
        )
        self.assertIsNotNone(mb_id)

        all_boxes = db.get_all_mailboxes()
        target = next((b for b in all_boxes if b["email"] == test_email), None)
        self.assertIsNotNone(target)
        self.assertEqual(target["daily_limit"], 15)
        self.assertEqual(target["hourly_limit"], 3)
        self.assertTrue(target["manual_limits"])
        self.assertEqual(target["status"], "ACTIVE")

    def test_new_mailbox_defaults_support_one_hundred_per_day(self):
        email = "default.limits@openclose-desk.com"
        mailbox_id = db.upsert_mailbox(email=email, smtp_user=email, smtp_password="fixture")
        try:
            target = next(box for box in db.get_all_mailboxes() if box["email"] == email)
            self.assertEqual((target["daily_limit"], target["hourly_limit"]), (100, 30))
            self.assertTrue(target["manual_limits"])
        finally:
            db.delete_mailbox(mailbox_id)

        # Cleanup
        db.delete_mailbox(target["mailbox_id"])
        all_boxes_after = db.get_all_mailboxes()
        self.assertIsNone(next((b for b in all_boxes_after if b["email"] == test_email), None))

    def test_hard_bounce_suppression(self):
        """Ensures that logging a 550 BOUNCED send immediately adds recipient to email_suppression."""
        bounced_email = "bad_user@invalid_domain_test.com"
        db.log_send_event(
            lead_id="test_lead_99",
            recipient_email=bounced_email,
            company_name="Ghost Corp",
            subject="Test question",
            status="BOUNCED",
            smtp_code=550,
            response_msg="5.1.1 User unknown"
        )

        suppressed = db.get_suppressed_emails()
        self.assertIn(bounced_email.lower(), suppressed)

        # Ensure get_sent_email_set includes suppressed
        sent_set = db.get_sent_email_set()
        self.assertIn(bounced_email.lower(), sent_set)

    def test_domain_cooldown_enforcement(self):
        """Ensures that sending an email to @target.com enforces a 48-hour cooldown on that company domain."""
        import time
        test_domain = f"unique-cd-{int(time.time() * 1000)}.com"
        contact_1 = f"alice@{test_domain}"
        contact_2 = f"bob@{test_domain}"

        # Initially not in cooldown
        self.assertFalse(db.is_domain_in_cooldown(test_domain, cooldown_hours=48))

        # Log a successful send to contact_1
        db.log_send_event(
            lead_id="test_lead_1",
            recipient_email=contact_1,
            company_name="Cooldown Test Ltd",
            subject="Question",
            status="SENT",
            smtp_code=250,
            response_msg="250 OK"
        )

        # Domain must now be in cooldown
        self.assertTrue(db.is_domain_in_cooldown(test_domain, cooldown_hours=48))

        # Cleanup
        with db.get_db_connection() as conn:
            conn.execute("DELETE FROM campaign_sends WHERE recipient_email IN (?, ?)", (contact_1, contact_2))
            conn.commit()

    def test_template_crud(self):
        """Tests saving and retrieving templates."""
        t_name = "Unit Test Template Alpha"
        db.save_template(t_name, "Subject Alpha", "Body Alpha Content", is_default=0)
        
        tmpls = db.get_all_templates()
        target = next((t for t in tmpls if t["name"] == t_name), None)
        self.assertIsNotNone(target)
        self.assertEqual(target["subject"], "Subject Alpha")

        db.delete_template(target["template_id"])
        tmpls_after = db.get_all_templates()
        self.assertIsNone(next((t for t in tmpls_after if t["name"] == t_name), None))

if __name__ == "__main__":
    unittest.main()
