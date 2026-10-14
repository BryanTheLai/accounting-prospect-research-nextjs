"""
Unit & Integration Tests for Autonomous Campaign Framework, Playbooks & Sourcing Strategies
Path: tests/test_campaign_framework.py
"""
import unittest
import subprocess
import sys
from pathlib import Path
import campaign_database as db
import campaign_framework as cf

class TestCampaignFramework(unittest.TestCase):
    def setUp(self):
        """Initializes tables and seeds default campaigns before tests."""
        db.init_campaign_tables()
        with db.get_db_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS prospects (
                    lead_id TEXT PRIMARY KEY, company_name TEXT NOT NULL,
                    company_summary TEXT, root_domain TEXT, headquarters TEXT,
                    malaysia_facility TEXT, sector TEXT, estimated_transactions_mo TEXT,
                    accounting_software TEXT, buyer_name TEXT, buyer_title TEXT,
                    contact_email TEXT, contact_phone TEXT, sg_my_wedge TEXT,
                    quality_score INTEGER, tier TEXT, status TEXT, notes TEXT,
                    bro_summary TEXT, proof_link TEXT, phone_script TEXT, campaign_id TEXT
                )
            """)
        db.seed_default_campaigns()

    def test_default_campaigns_seeded(self):
        """Verifies that the default campaign playbooks exist in database."""
        all_cp = db.get_all_campaigns()
        cp_ids = [c["campaign_id"] for c in all_cp]
        self.assertIn("jobstreet_hiring_pain", cp_ids)
        self.assertIn("hydroball_clones", cp_ids)
        self.assertIn("accounting_firm_partners", cp_ids)
        self.assertIn("lhdn_einvoicing_urgency", cp_ids)
        for campaign_id in ("yc_us_expansion", "yc_conversational_discovery"):
            campaign = next(item for item in all_cp if item["campaign_id"] == campaign_id)
            self.assertEqual(campaign["schedule_timezone"], "America/Los_Angeles")
            self.assertEqual(campaign["schedule_start_minute"], 9 * 60)
            self.assertEqual(campaign["schedule_end_minute"], 18 * 60)

    def test_campaign_crud(self):
        """Tests creating, fetching, and deleting a campaign playbook."""
        test_id = "test_custom_angle"
        db.upsert_campaign(
            campaign_id=test_id,
            name="Test Custom Playbook",
            tagline="Unit test playbook",
            target_criteria="Criteria X",
            sourcing_strategy="Strategy Y",
            agent_prompt_spec="Prompt Z",
            offer_wedge="Wedge W"
        )

        cp = db.get_campaign_by_id(test_id)
        self.assertIsNotNone(cp)
        self.assertEqual(cp["name"], "Test Custom Playbook")
        self.assertEqual(cp["offer_wedge"], "Wedge W")

        # Cleanup
        db.delete_campaign(test_id)
        self.assertIsNone(db.get_campaign_by_id(test_id))

    def test_sourcing_strategies_prompts(self):
        """Verifies that all registered sourcing strategies generate rich agent prompts."""
        for cid, strat in cf.STRATEGY_REGISTRY.items():
            prompt = strat.get_agent_prompt(target_count=10)
            self.assertIn("Outbounder", prompt)
            self.assertIn("Data to extract", prompt)
            self.assertIn(cid, prompt)

    def test_lead_ingest_and_filtering(self):
        """Tests ingesting lead records into a specific campaign and querying them."""
        test_campaign = "unit_test_ingest_cp"
        db.upsert_campaign(
            campaign_id=test_campaign,
            name="Ingest Test Campaign",
            tagline="Testing ingestion"
        )

        sample_leads = [
            {
                "company_name": "Test Ingest Corp A",
                "contact_email": "owner@ingest-a.com",
                "buyer_name": "Alice Wong",
                "sector": "Manufacturing",
                "quality_score": 90
            },
            {
                "company_name": "Test Ingest Corp B",
                "contact_email": "director@ingest-b.com",
                "buyer_name": "Bob Tan",
                "sector": "Wholesale",
                "quality_score": 85
            }
        ]

        inserted, updated = db.ingest_leads_to_campaign(sample_leads, test_campaign)
        self.assertEqual(inserted, 2)
        self.assertEqual(updated, 0)

        # Check counts
        counts = db.get_campaign_lead_counts()
        self.assertEqual(counts.get(test_campaign), 2)

        # Check filter
        leads = db.get_leads_by_campaign(test_campaign)
        self.assertEqual(len(leads), 2)
        self.assertEqual(leads[0]["campaign_id"], test_campaign)

        # Cleanup
        with db.get_db_connection() as conn:
            conn.execute("DELETE FROM prospects WHERE campaign_id = ?", (test_campaign,))
            conn.commit()
        db.delete_campaign(test_campaign)

    def test_framework_cli_status_and_list(self):
        """Executes CLI commands via subprocess to ensure clean exit code 0."""
        # Test status
        res_status = subprocess.run(
            [sys.executable, "campaign_framework.py", "status"],
            capture_output=True,
            encoding="utf-8",
            errors="replace"
        )
        self.assertEqual(res_status.returncode, 0, f"Error: {res_status.stderr}")
        self.assertIn("TELEMETRY SNAPSHOT", res_status.stdout)

        # Test campaign list
        res_list = subprocess.run(
            [sys.executable, "campaign_framework.py", "campaign", "list"],
            capture_output=True,
            encoding="utf-8",
            errors="replace"
        )
        self.assertEqual(res_list.returncode, 0, f"Error: {res_list.stderr}")
        self.assertIn("jobstreet_hiring_pain", res_list.stdout)

if __name__ == "__main__":
    unittest.main()
