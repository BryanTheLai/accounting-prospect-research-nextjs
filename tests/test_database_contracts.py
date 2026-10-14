import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import campaign_database as db


class DatabaseContractsTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "fixture.sqlite"
        self.target = patch.object(db, "DB_PATH", self.path)
        self.target.start()
        db.init_campaign_tables()

    def tearDown(self):
        self.target.stop()
        self.directory.cleanup()

    def test_reading_default_campaigns_never_overwrites_operator_fields(self):
        db.seed_default_campaigns()
        fields = ["name", "tagline", "description", "target_criteria", "sourcing_strategy", "agent_prompt_spec", "offer_wedge", "default_template_name"]
        with db.connection_scope() as connection:
            connection.execute(f"UPDATE campaigns SET {','.join(field + '=?' for field in fields)},status='PAUSED' WHERE campaign_id='yc_us_expansion'",
                               ["operator " + field for field in fields])
        db.get_all_campaigns()
        result = db.get_campaign_by_id("yc_us_expansion")
        for field in fields:
            self.assertEqual(result[field], "operator " + field)
        self.assertEqual(result["status"], "PAUSED")
        self.assertEqual(len(db.get_all_campaigns()), len(db.DEFAULT_CAMPAIGNS))

    def test_mailbox_list_initializes_once_and_returns_same_counts(self):
        for email in ("one@example.test", "two@example.test", "empty@example.test"):
            db.upsert_mailbox(email, "fixture", "fixture")
        with db.connection_scope() as connection:
            for sender, response, status in (
                ("ONE@example.test", "accepted", "SENT"),
                ("one@example.test", "[DRY-RUN]", "SENT"),
                ("one@example.test", "failed", "FAILED"),
                ("two@example.test", "accepted", "SENT"),
            ):
                connection.execute("INSERT INTO campaign_sends(lead_id,recipient_email,subject,status,response_msg,sender_email,sent_at) VALUES ('fixture','recipient@example.test','test',?,?,?,datetime('now','localtime'))",
                                   (status, response, sender))
        with patch.object(db, "init_campaign_tables", wraps=db.init_campaign_tables) as initialize:
            rows = db.get_all_mailboxes()
        self.assertEqual(initialize.call_count, 1)
        expected = {"one@example.test": 1, "two@example.test": 1, "empty@example.test": 0}
        for row in rows:
            self.assertEqual(row["sends_today"], expected[row["email"]])
            self.assertEqual(row["sends_this_hour"], expected[row["email"]])

    def test_connection_scope_commits_rolls_back_and_always_closes(self):
        with db.connection_scope() as success:
            success.execute("CREATE TABLE changes(value TEXT)")
            success.execute("INSERT INTO changes VALUES ('committed')")
        with self.assertRaises(sqlite3.ProgrammingError):
            success.execute("SELECT 1")
        with self.assertRaisesRegex(RuntimeError, "abort"):
            with db.connection_scope() as failed:
                failed.execute("INSERT INTO changes VALUES ('rolled back')")
                raise RuntimeError("abort")
        with self.assertRaises(sqlite3.ProgrammingError):
            failed.execute("SELECT 1")
        with db.connection_scope() as connection:
            self.assertEqual([row[0] for row in connection.execute("SELECT value FROM changes")], ["committed"])
