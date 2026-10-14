"""
Unit Tests for Telephony Persistence and Timezone Calculation Engine
Path: tests/test_telephony_and_timezone.py
"""
import unittest
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch

from timezone_utils import normalize_phone_e164, evaluate_lead_timezone
import campaign_database

class TestTelephonyAndTimezone(unittest.TestCase):

    def test_phone_normalization_e164(self):
        # US phone numbers
        self.assertEqual(normalize_phone_e164("(415) 555-0199", default_country="US"), "+14155550199")
        self.assertEqual(normalize_phone_e164("14155550199", default_country="US"), "+14155550199")
        self.assertEqual(normalize_phone_e164("+14155550199", default_country="US"), "+14155550199")
        
        # Malaysia phone numbers
        self.assertEqual(normalize_phone_e164("012-345 6789", default_country="MY"), "+60123456789")
        self.assertEqual(normalize_phone_e164("07-598 6688", default_country="MY"), "+6075986688")
        self.assertEqual(normalize_phone_e164("60123456789", default_country="MY"), "+60123456789")
        
        # Singapore phone numbers
        self.assertEqual(normalize_phone_e164("61234567", default_country="SG"), "+6561234567")
        self.assertEqual(normalize_phone_e164("+6591234567", default_country="SG"), "+6591234567")

        # Empty / whitespace
        self.assertEqual(normalize_phone_e164(""), "")
        self.assertEqual(normalize_phone_e164("   "), "")

    def test_evaluate_lead_timezone_classification(self):
        # US Pacific
        res_sf = evaluate_lead_timezone("San Francisco, CA")
        self.assertEqual(res_sf["timezone_name"], "America/Los_Angeles")
        self.assertIn("PT", res_sf["label"])

        # US Eastern
        res_ny = evaluate_lead_timezone("New York, NY")
        self.assertEqual(res_ny["timezone_name"], "America/New_York")
        self.assertIn("ET", res_ny["label"])

        # Singapore
        res_sg = evaluate_lead_timezone("Singapore")
        self.assertEqual(res_sg["timezone_name"], "Asia/Singapore")
        self.assertIn("SGT", res_sg["label"])

        # Malaysia (default)
        res_my = evaluate_lead_timezone("Johor Bahru, Malaysia")
        self.assertEqual(res_my["timezone_name"], "Asia/Kuala_Lumpur")
        self.assertIn("MYT", res_my["label"])

    def test_telephony_tables_and_call_logging(self):
        # Test in a temporary SQLite database
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            tmp_path = Path(tmp.name)

        try:
            with patch.object(campaign_database, "DB_PATH", tmp_path):
                # Setup base prospects table
                with campaign_database.get_db_connection() as conn:
                    conn.execute("""
                    CREATE TABLE prospects (
                        lead_id TEXT PRIMARY KEY,
                        company_name TEXT,
                        contact_phone TEXT,
                        status TEXT DEFAULT 'Ready to Review'
                    );
                    """)
                    conn.execute("""
                    INSERT INTO prospects (lead_id, company_name, contact_phone)
                    VALUES ('lead_001', 'Acme AI', '+14155550199');
                    """)
                    conn.commit()

                # Initialize telephony tables
                campaign_database.init_telephony_tables()

                # Log a call disposition
                call_id = campaign_database.log_call_disposition(
                    lead_id="lead_001",
                    target_phone="+14155550199",
                    target_name="Sam Altman",
                    company_name="Acme AI",
                    campaign_id="yc_us_expansion",
                    disposition="CONNECTED_MEETING_BOOKED",
                    duration_seconds=180,
                    notes="Booked 15m review call for next Tuesday"
                )
                self.assertGreater(call_id, 0)

                # Verify call history
                history = campaign_database.get_lead_call_history("lead_001")
                self.assertEqual(len(history), 1)
                self.assertEqual(history[0]["disposition"], "CONNECTED_MEETING_BOOKED")
                self.assertEqual(history[0]["duration_seconds"], 180)

                # Verify aggregate lead stats updated
                with campaign_database.get_db_connection() as conn:
                    lead = conn.execute("SELECT * FROM prospects WHERE lead_id = 'lead_001'").fetchone()
                    self.assertEqual(lead["call_attempts_count"], 1)
                    self.assertEqual(lead["last_disposition"], "CONNECTED_MEETING_BOOKED")
                    self.assertEqual(lead["status"], "Discovery Call Booked")

                # Verify telephony metrics today
                stats = campaign_database.get_telephony_stats_today()
                self.assertEqual(stats["dials_today"], 1)
                self.assertEqual(stats["connects_today"], 1)
                self.assertEqual(stats["meetings_booked_today"], 1)
                self.assertEqual(stats["connect_rate_pct"], 100.0)
                self.assertEqual(stats["meeting_conversion_pct"], 100.0)

                # Test Email Stats Summary
                campaign_database.init_campaign_tables()
                campaign_database.log_send_event(
                    lead_id="lead_001",
                    recipient_email="sam@openai.com",
                    company_name="OpenAI",
                    subject="Delaware Books",
                    status="SENT",
                    smtp_code=250,
                    response_msg="250 2.0.0 OK",
                    sender_email="bryan@openclose-desk.com"
                )
                em_summary = campaign_database.get_email_stats_summary()
                self.assertEqual(em_summary["sent_today"], 1)
                self.assertEqual(em_summary["sent_total"], 1)
                self.assertEqual(em_summary["replies_total"], 1) # Because status updated to Discovery Call Booked
                self.assertEqual(em_summary["deliverability_rate_pct"], 100.0)
        finally:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except Exception:
                    pass

if __name__ == "__main__":
    unittest.main()
