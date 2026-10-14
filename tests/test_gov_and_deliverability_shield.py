"""
Unit Tests for Government Shield, Warmup Ramper, Blacklist Monitor & Inbound Parser
Path: tests/test_gov_and_deliverability_shield.py
"""

import unittest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

import gov_shield
import warmup_ramper
import blacklist_checker
import inbound_monitor
import campaign_database as db

class TestGovShield(unittest.TestCase):

    def test_gov_tld_blocking(self):
        """Ensures .gov, .gov.my, .gov.sg, .edu domains are blocked."""
        self.assertTrue(gov_shield.is_government_domain("mida.gov.my")[0])
        self.assertTrue(gov_shield.is_government_domain("tech.gov.sg")[0])
        self.assertTrue(gov_shield.is_government_domain("utm.edu.my")[0])
        self.assertFalse(gov_shield.is_government_domain("alliancecosmetics.com")[0])
        self.assertFalse(gov_shield.is_government_domain("singaporetech.com.sg")[0])

    def test_malaysian_and_singapore_public_sector_keywords(self):
        """Ensures ministries, municipal councils (MBJB/Majlis), and statutory boards are blocked."""
        # Municipal Council (Majlis)
        is_gov, reason = gov_shield.is_government_affiliated("Majlis Bandaraya Johor Bahru (MBJB)")
        self.assertTrue(is_gov)
        self.assertIn("GOV SHIELD", reason)

        # Ministry / Kementerian
        is_gov, _ = gov_shield.is_government_affiliated("Kementerian Kewangan Malaysia")
        self.assertTrue(is_gov)

        # Singapore Statutory Board
        is_gov, _ = gov_shield.is_government_affiliated("GovTech Singapore")
        self.assertTrue(is_gov)

        # Malaysian GLC
        is_gov, _ = gov_shield.is_government_affiliated("Petronas Dagangan")
        self.assertTrue(is_gov)

        # Normal Private SME (Allowed)
        is_gov, reason = gov_shield.is_government_affiliated("Advance Lab Pte Ltd", root_domain="advancelab.com.sg")
        self.assertFalse(is_gov)
        self.assertIn("PRIVATE SME", reason)

    def test_gov_shield_no_substring_false_positives(self):
        """Verifies that short acronyms (edb, epf, sla, ura, mas, lta) do NOT cause substring false positives."""
        commercial_companies = [
            ("LanceDB", "lancedb.com", "contact@lancedb.com"),
            ("ParadeDB", "paradedb.com", "founders@paradedb.com"),
            ("Stepful", "stepful.com", "support@stepful.com"),
            ("Slash", "slash.co", "hello@slash.co"),
            ("Mastra", "mastra.ai", "info@mastra.ai"),
            ("Corgi Insurance", "corgi.insure", "care@corgi.insure"),
            ("TBS Asia Management Consultants Sdn. Bhd.", "tbsasia.com", "contact@tbsasia.com"),
            ("Chambers Translation Sdn. Bhd.", "chamberstranslation.com", "info@chamberstranslation.com"),
            ("RedBrick AI", "redbrick.ai", "team@redbrick.ai"),
            ("Precision Tooling Masters Sdn Bhd", "ptmasters.com.my", "sales@ptmasters.com.my")
        ]
        for name, domain, email in commercial_companies:
            is_gov, reason = gov_shield.is_government_affiliated(name, root_domain=domain, contact_email=email)
            self.assertFalse(is_gov, f"Expected {name} to NOT be government blocked, but got: {reason}")

    def test_filter_leads_for_government(self):
        """Verifies bulk filtering separating private SMEs from government entities."""
        sample_leads = [
            {"company_name": "Hydroball Technics", "root_domain": "hydroball.sg"},
            {"company_name": "Majlis Perbandaran Kulai", "root_domain": "mpku.gov.my"},
            {"company_name": "Seng Li Engineering", "root_domain": "sengli.com.my"}
        ]
        clean, blocked = gov_shield.filter_leads_for_government(sample_leads)
        self.assertEqual(len(clean), 2)
        self.assertEqual(len(blocked), 1)
        self.assertEqual(blocked[0]["company_name"], "Majlis Perbandaran Kulai")

    def test_dispatcher_start_campaign_excludes_government_leads(self):
        """Ensures that start_campaign never queues government or municipal entities."""
        from campaign_dispatcher import CampaignDispatcher
        disp = CampaignDispatcher()
        leads = [
            {"lead_id": "clean_1", "company_name": "Advancelab Pte Ltd", "contact_email": "hr@advancelab.com.my", "root_domain": "advancelab.com.my"},
            {"lead_id": "gov_1", "company_name": "Majlis Bandaraya Iskandar Puteri (MBIP)", "contact_email": "aduan@mbip.gov.my", "root_domain": "mbip.gov.my"}
        ]
        with patch("campaign_dispatcher.threading.Thread") as worker, \
             patch("campaign_dispatcher.get_sent_email_set", return_value=set()):
            disp.start_campaign(leads, subject_tmpl="Test", body_tmpl="Body")
            self.assertEqual(disp.state["queue_pending"], 1)
            queued = worker.call_args.kwargs["args"][0]
            self.assertEqual([lead["lead_id"] for lead in queued], ["clean_1"])
            worker.return_value.is_alive.return_value = False
        disp.stop_campaign()
        self.assertEqual(disp.state["queue_pending"], 0)

class TestWarmupRamper(unittest.TestCase):

    def test_day_1_volume_cap(self):
        """Ensures Day 1 mailbox is strictly capped at 5 sends/day."""
        policy = warmup_ramper.get_warmup_policy() # defaults to age 1
        self.assertEqual(policy["daily_limit"], 5)
        self.assertEqual(policy["hourly_limit"], 2)
        self.assertTrue(policy["is_day_one"])

    def test_enforce_warmup_limits_caps_high_configured_limit(self):
        """Ensures that even if user configured 25/day, Day 1 clamps it to 5/day."""
        mb = {
            "email": "bryan@openclose-desk.com",
            "daily_limit": 25,
            "hourly_limit": 5,
            "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        }
        adjusted = warmup_ramper.enforce_warmup_limits(mb)
        self.assertEqual(adjusted["daily_limit"], 5)
        self.assertEqual(adjusted["hourly_limit"], 2)

class TestBlacklistAndHygiene(unittest.TestCase):

    def test_disposable_email_detection(self):
        """Ensures known burner domains are detected."""
        self.assertTrue(blacklist_checker.is_disposable_email("test@mailinator.com")[0])
        self.assertTrue(blacklist_checker.is_disposable_email("fake@temp-mail.org")[0])
        self.assertFalse(blacklist_checker.is_disposable_email("bryan@openclose-desk.com")[0])

    def test_sensitive_role_account_detection(self):
        """Ensures compliance traps (abuse@, postmaster@) are detected."""
        self.assertTrue(blacklist_checker.is_sensitive_role_account("abuse@company.com")[0])
        self.assertTrue(blacklist_checker.is_sensitive_role_account("postmaster@domain.com")[0])
        self.assertFalse(blacklist_checker.is_sensitive_role_account("michael.tan@company.com")[0])

class TestInboundMonitor(unittest.TestCase):

    def test_parse_ndr_bounced_email(self):
        """Verifies extraction of failed recipient from NDR body."""
        ndr_body = """
        This is an automatically generated Delivery Status Notification.
        Delivery to the following recipients failed permanently:
        Final-Recipient: rfc822; deaduser99@invaliddomain.com
        Action: failed
        Status: 5.1.1
        """
        extracted = inbound_monitor.parse_ndr_bounced_email("Undeliverable: Quick question", "postmaster@mail.protection.outlook.com", ndr_body)
        self.assertEqual(extracted, "deaduser99@invaliddomain.com")

    def test_stop_on_reply_warm_and_opt_out(self):
        """Verifies prospect reply stops outbound sequence and upgrades deal stage."""
        db.init_campaign_tables()
        with db.get_db_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS prospects (
                    lead_id TEXT PRIMARY KEY, company_name TEXT NOT NULL,
                    root_domain TEXT, buyer_name TEXT, contact_email TEXT,
                    status TEXT, campaign_id TEXT
                )
            """)
        test_email = "test_lead_replier_99@precision.com"
        
        with db.get_db_connection() as conn:
            conn.execute("DELETE FROM prospects WHERE contact_email = ?", (test_email,))
            conn.execute("""
            INSERT INTO prospects (lead_id, company_name, root_domain, buyer_name, contact_email, status, campaign_id)
            VALUES ('test_lead_replier_99', 'Precision Test', 'precision.com', 'John Boss', ?, 'In Sequence (Smartlead)', 'jobstreet_hiring_pain')
            """, (test_email,))
            conn.commit()

        # 1. Warm reply
        res = inbound_monitor.process_inbound_message(test_email, "Re: Quick question", "Sounds interesting, let's do a 10 min Zoom next Tuesday.")
        self.assertEqual(res["type"], "REPLY_WARM")
        self.assertEqual(res["action"], "SEQUENCE_STOPPED")
        
        # Check database status updated
        with db.get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT status FROM prospects WHERE contact_email = ?", (test_email,))
            self.assertEqual(cur.fetchone()[0], "Replied (Warm)")

        # 2. Opt-out reply
        res_opt = inbound_monitor.process_inbound_message(test_email, "Re: Quick question", "Please stop emailing me, not interested, unsubscribe.")
        self.assertEqual(res_opt["type"], "OPT_OUT")
        self.assertEqual(res_opt["action"], "SUPPRESSED")
        
        # Check database status updated to DNC and email in suppression
        with db.get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT status FROM prospects WHERE contact_email = ?", (test_email,))
            self.assertEqual(cur.fetchone()[0], "Discarded / DNC")
        self.assertIn(test_email, db.get_suppressed_emails())

        # Cleanup
        with db.get_db_connection() as conn:
            conn.execute("DELETE FROM prospects WHERE contact_email = ?", (test_email,))
            conn.execute("DELETE FROM email_suppression WHERE email = ?", (test_email,))
            conn.commit()

class TestCooldownAndDeduplicationHygiene(unittest.TestCase):
    def test_freemail_cooldown_exemption(self):
        """Verifies that public freemail domains (gmail.com, etc.) are exempted from 48h domain cooldown."""
        self.assertFalse(db.is_domain_in_cooldown("gmail.com"))
        self.assertFalse(db.is_domain_in_cooldown("yahoo.com"))
        self.assertFalse(db.is_domain_in_cooldown("outlook.com"))

    def test_dry_run_simulation_does_not_burn_leads(self):
        """Verifies that [DRY-RUN SAFETY SHIELD] sends do not pollute get_sent_email_set."""
        test_email = "dryrun_unburned@targetcompany.com"
        db.log_send_event("test_lead", test_email, "Target Co", "Sub", "SENT", 250, "[DRY-RUN SAFETY SHIELD] Simulated send accepted (Live sending gated)")
        
        sent_set = db.get_sent_email_set()
        self.assertNotIn(test_email, sent_set)
        
        # Cleanup
        with db.get_db_connection() as conn:
            conn.execute("DELETE FROM campaign_sends WHERE recipient_email = ?", (test_email,))
            conn.commit()

if __name__ == "__main__":
    unittest.main()
