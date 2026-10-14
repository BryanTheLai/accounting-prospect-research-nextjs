import sqlite3
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from yc_ingest import ingest_yc_selection_to_targets


PROSPECTS_SCHEMA = """
CREATE TABLE prospects (
    lead_id TEXT PRIMARY KEY, company_name TEXT NOT NULL, company_summary TEXT,
    root_domain TEXT NOT NULL, headquarters TEXT, malaysia_facility TEXT,
    sector TEXT, estimated_transactions_mo TEXT, accounting_software TEXT,
    buyer_name TEXT, buyer_title TEXT, contact_email TEXT, contact_phone TEXT,
    sg_my_wedge TEXT, quality_score INTEGER, tier TEXT, status TEXT, notes TEXT,
    bro_summary TEXT, proof_link TEXT, phone_script TEXT, campaign_id TEXT
)
"""


class TestYcIngestSafety(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.sqlite"
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(PROSPECTS_SCHEMA)
        self.selected = pd.DataFrame([{
            "slug": "safe-company", "name": "Safe Company", "root_domain": "safe.example",
            "batch": "W25", "team_size": 5, "top_company": 0, "is_hiring": 1,
            "one_liner": "Builds useful software", "yc_url": "https://www.ycombinator.com/companies/safe-company",
        }])

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_new_yc_rows_do_not_invent_contact_fields(self):
        self.assertEqual(ingest_yc_selection_to_targets(self.selected, db_path=self.db_path), 1)
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("""SELECT buyer_name, buyer_title, contact_email, contact_phone, status
                FROM prospects WHERE lead_id = 'yc_safe_company'""").fetchone()
        self.assertEqual(row, ("", "", "", "", "Ready to Review"))

    def test_repeat_ingest_preserves_existing_operator_edits(self):
        self.assertEqual(ingest_yc_selection_to_targets(self.selected, db_path=self.db_path), 1)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""UPDATE prospects SET buyer_name='Bryan Test', contact_email='founder@safe.example',
                status='Approved for Outreach', notes='operator note' WHERE lead_id='yc_safe_company'""")
        changed = self.selected.copy()
        changed.loc[0, "name"] = "Changed Source Name"
        self.assertEqual(ingest_yc_selection_to_targets(changed, db_path=self.db_path), 0)
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("""SELECT company_name, buyer_name, contact_email, status, notes
                FROM prospects WHERE lead_id = 'yc_safe_company'""").fetchone()
        self.assertEqual(row, ("Safe Company", "Bryan Test", "founder@safe.example", "Approved for Outreach", "operator note"))


if __name__ == "__main__":
    unittest.main()
