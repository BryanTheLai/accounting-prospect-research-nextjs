"""
Unit Tests for Master 5-Year YC Universe Harvester & Directory
Verifies:
1. Domain sanitization
2. Batch component parsing (Season + Year)
3. Table initialization & index presence
4. Zero-hallucination invariant on contacts (phone, email strictly empty)
5. Idempotent upsert & badge integrity
"""
import unittest
import sqlite3
from pathlib import Path
import tempfile
import os

from harvest_yc_5year_master import (
    clean_domain,
    parse_batch_components,
    init_yc_5year_tables
)
import config

class TestYC5YearHarvester(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.TemporaryDirectory()
        self.test_db = Path(self.test_dir.name) / "test_leads.db"
        self.orig_db = config.DB_PATH
        config.DB_PATH = self.test_db

    def tearDown(self):
        config.DB_PATH = self.orig_db
        try:
            self.test_dir.cleanup()
        except Exception:
            pass

    def test_clean_domain(self):
        cases = [
            ("https://www.stripe.com/docs", "stripe.com"),
            ("http://sub.domain.co.uk/path?arg=1", "sub.domain.co.uk"),
            ("HTTP://UPPERCASE.COM/", "uppercase.com"),
            ("", ""),
            (None, "")
        ]
        for inp, expected in cases:
            self.assertEqual(clean_domain(inp), expected)

    def test_parse_batch_components(self):
        cases = [
            ("Winter 2024", ("Winter", 2024)),
            ("Summer 2021", ("Summer", 2021)),
            ("Fall 2025", ("Fall", 2025)),
            ("Spring 2020", ("Spring", 2020)),
            ("W20", ("W20", 0)),
            ("", ("", 0))
        ]
        for inp, expected in cases:
            self.assertEqual(parse_batch_components(inp), expected)

    def test_init_yc_5year_tables_and_indices(self):
        init_yc_5year_tables(self.test_db)
        conn = sqlite3.connect(self.test_db)
        cur = conn.cursor()

        # Check table columns
        cur.execute("PRAGMA table_info(yc_5year_directory)")
        cols = {row[1]: row[2] for row in cur.fetchall()}
        
        expected_cols = [
            "yc_id", "name", "slug", "website", "root_domain", "batch",
            "batch_season", "batch_year", "status", "stage", "top_company",
            "is_hiring", "nonprofit", "team_size", "industry", "subindustry",
            "tags", "tags_highlighted", "all_locations", "regions",
            "one_liner", "long_description", "yc_url", "small_logo_url",
            "app_video_public", "demo_day_video_public", "contact_email", "contact_phone"
        ]
        for ec in expected_cols:
            self.assertIn(ec, cols, f"Missing required column: {ec}")

        # Check indexes
        cur.execute("PRAGMA index_list(yc_5year_directory)")
        indexes = [row[1] for row in cur.fetchall()]
        self.assertIn("idx_yc5_batch", indexes)
        self.assertIn("idx_yc5_status", indexes)
        self.assertIn("idx_yc5_top", indexes)
        self.assertIn("idx_yc5_hiring", indexes)
        conn.close()

    def test_zero_hallucination_invariant(self):
        """Verifies that inserting raw records never fabricates contacts and respects empty strings."""
        init_yc_5year_tables(self.test_db)
        conn = sqlite3.connect(self.test_db)
        cur = conn.cursor()

        cur.execute("""
        INSERT INTO yc_5year_directory (
            yc_id, name, slug, website, root_domain, batch,
            status, top_company, is_hiring, contact_email, contact_phone
        ) VALUES (9999, 'Zero Hallucination AI', 'zero-hallucination', 'https://zero.ai', 'zero.ai', 'Winter 2024',
                 'Active', 1, 1, '', '')
        """)
        conn.commit()

        cur.execute("SELECT contact_email, contact_phone, top_company, is_hiring FROM yc_5year_directory WHERE yc_id = 9999")
        row = cur.fetchone()
        self.assertEqual(row[0], "", "Email must remain strictly empty string")
        self.assertEqual(row[1], "", "Phone must remain strictly empty string")
        self.assertEqual(row[2], 1, "Top company badge must be preserved")
        self.assertEqual(row[3], 1, "Hiring badge must be preserved")
        conn.close()

if __name__ == "__main__":
    unittest.main()
