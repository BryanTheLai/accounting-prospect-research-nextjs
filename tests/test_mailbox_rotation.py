"""
Unit Tests for Multi-Mailbox LRU Rotation, Quota Gating & Failover Logic
Path: tests/test_mailbox_rotation.py
"""
import unittest
import sqlite3
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch
import campaign_database as db

class TestMailboxRotation(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="mailbox-rotation-test-")
        self.addCleanup(self.temp_dir.cleanup)
        db_path_patch = patch.object(db, "DB_PATH", Path(self.temp_dir.name) / "campaign.sqlite3")
        db_path_patch.start()
        self.addCleanup(db_path_patch.stop)
        db.init_campaign_tables()
        # Clean test mailboxes
        with db.get_db_connection() as conn:
            conn.execute("DELETE FROM mailboxes WHERE email LIKE '%@rotation-test.com'")
            conn.execute("DELETE FROM campaign_sends WHERE sender_email LIKE '%@rotation-test.com'")
            conn.commit()

        # Insert 2 test mailboxes
        self.mb1_email = "inbox1@rotation-test.com"
        self.mb2_email = "inbox2@rotation-test.com"

        self.mb1_id = db.upsert_mailbox(
            email=self.mb1_email,
            smtp_user=self.mb1_email,
            smtp_password="pw1",
            daily_limit=10,
            hourly_limit=2
        )
        self.mb2_id = db.upsert_mailbox(
            email=self.mb2_email,
            smtp_user=self.mb2_email,
            smtp_password="pw2",
            daily_limit=10,
            hourly_limit=2
        )

    def tearDown(self):
        with db.get_db_connection() as conn:
            conn.execute("DELETE FROM mailboxes WHERE email LIKE '%@rotation-test.com'")
            conn.execute("DELETE FROM campaign_sends WHERE sender_email LIKE '%@rotation-test.com'")
            conn.commit()

    def test_lru_selection_pacing(self):
        """Ensures the mailbox with the older last_sent_at is picked first (Least-Recently-Used)."""
        # Set mb1 last_sent_at to 10 mins ago, mb2 to 30 mins ago
        with db.get_db_connection() as conn:
            conn.execute("UPDATE mailboxes SET last_sent_at = datetime('now', '-10 minutes') WHERE email = ?", (self.mb1_email,))
            conn.execute("UPDATE mailboxes SET last_sent_at = datetime('now', '-30 minutes') WHERE email = ?", (self.mb2_email,))
            conn.commit()

        chosen = db.get_available_mailbox()
        self.assertIsNotNone(chosen)
        self.assertEqual(chosen["email"], self.mb2_email, "Should pick mb2 because it was idle longer (30m vs 10m)")

    def test_hourly_quota_gating_rotates_to_secondary_mailbox(self):
        """Ensures that when Mailbox 1 hits its hourly cap (2/2), the selector skips it and picks Mailbox 2."""
        # Log 2 sends within the last 60 minutes for mb1
        for i in range(2):
            db.log_send_event(
                lead_id=f"lead_h_{i}",
                recipient_email=f"target_{i}@customer.com",
                company_name="Corp",
                subject="Sub",
                status="SENT",
                smtp_code=250,
                sender_email=self.mb1_email
            )

        # Mailbox 1 now has 2/2 sends this hour
        metrics1 = db.get_mailbox_metrics(self.mb1_email)
        self.assertEqual(metrics1["sends_this_hour"], 2)

        # get_available_mailbox must skip mb1 and select mb2!
        chosen = db.get_available_mailbox()
        self.assertIsNotNone(chosen)
        self.assertEqual(chosen["email"], self.mb2_email, "Must automatically rotate to mb2 when mb1 hits hourly cap")

    def test_cooldown_and_failover_status(self):
        """Ensures that a 421 deferral puts a mailbox into COOLDOWN and excludes it from selection."""
        db.record_mailbox_cooldown(self.mb1_id, duration_minutes=15, error_code=421, error_msg="4.7.28 Throttled")
        
        all_boxes = db.get_all_mailboxes()
        mb1 = next(b for b in all_boxes if b["mailbox_id"] == self.mb1_id)
        self.assertEqual(mb1["status"], "COOLDOWN")

        # get_available_mailbox must now pick mb2
        chosen = db.get_available_mailbox()
        self.assertIsNotNone(chosen)
        self.assertEqual(chosen["email"], self.mb2_email)

    def test_auth_error_status(self):
        """Ensures 535 auth failure sets status to ERROR and removes from rotation."""
        db.record_mailbox_error(self.mb2_id, error_code=535, error_msg="Authentication failed")
        
        all_boxes = db.get_all_mailboxes()
        mb2 = next(b for b in all_boxes if b["mailbox_id"] == self.mb2_id)
        self.assertEqual(mb2["status"], "ERROR")

        # get_available_mailbox must select mb1
        chosen = db.get_available_mailbox()
        self.assertIsNotNone(chosen)
        self.assertEqual(chosen["email"], self.mb1_email)

    def test_esp_matching_preferred_provider_routing(self):
        """Verifies that preferred_provider selects matching ESP first and falls back gracefully."""
        from email_verifier import detect_domain_esp

        # Configure mb1 as MICROSOFT, mb2 as GOOGLE
        with db.get_db_connection() as conn:
            conn.execute("UPDATE mailboxes SET provider_type = 'MICROSOFT' WHERE email = ?", (self.mb1_email,))
            conn.execute("UPDATE mailboxes SET provider_type = 'GOOGLE' WHERE email = ?", (self.mb2_email,))
            conn.commit()

        # Preferred GOOGLE -> mb2
        chosen = db.get_available_mailbox(preferred_provider="GOOGLE")
        self.assertIsNotNone(chosen)
        self.assertEqual(chosen["email"], self.mb2_email, "Should prioritize GOOGLE provider when requested")

        # Preferred MICROSOFT -> mb1
        chosen_ms = db.get_available_mailbox(preferred_provider="MICROSOFT")
        self.assertIsNotNone(chosen_ms)
        self.assertEqual(chosen_ms["email"], self.mb1_email, "Should prioritize MICROSOFT provider when requested")

        # Fallback: When Google box hits quota, gracefully fallback to Microsoft
        for i in range(2):
            db.log_send_event(
                lead_id=f"g_lead_{i}",
                recipient_email=f"g_target_{i}@customer.com",
                company_name="GCorp",
                subject="Sub",
                status="SENT",
                smtp_code=250,
                sender_email=self.mb2_email
            )
        # mb2 has hit its 2/2 hourly cap
        fallback = db.get_available_mailbox(preferred_provider="GOOGLE")
        self.assertIsNotNone(fallback)
        self.assertEqual(fallback["email"], self.mb1_email, "Must gracefully fallback to available Microsoft box when Google box quota is full")

        # Test detect_domain_esp
        self.assertEqual(detect_domain_esp("founder@gmail.com"), "GOOGLE")
        self.assertEqual(detect_domain_esp("test@microsoft.com"), "MICROSOFT")

if __name__ == "__main__":
    unittest.main()
