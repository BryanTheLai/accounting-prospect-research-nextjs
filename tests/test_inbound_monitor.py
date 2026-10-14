"""Fake-only coverage for the bounded, read-only inbound mailbox scan."""

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import inbound_monitor


class FakeIMAP:
    def __init__(self, host, port, timeout, messages):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.messages = messages
        self.fetch_requests = []
        self.selected_readonly = False
        self.logged_in = None
        self.sock = FakeSocket()

    def login(self, user, password):
        self.logged_in = (user, password)
        return "OK", [b"LOGIN completed"]

    def status(self, mailbox, data):
        assert mailbox == "INBOX"
        assert data == "(UIDNEXT)"
        return "OK", [f"INBOX (UIDNEXT {max(self.messages, default=0) + 1})".encode()]

    def select(self, mailbox, readonly=False):
        self.selected_readonly = readonly
        assert mailbox == "INBOX"
        return "OK", [b"EXISTS"]

    def response(self, code):
        assert code == "UIDVALIDITY"
        return b"UIDVALIDITY", [b"77"]

    def uid(self, command, *args):
        self.fetch_requests.append((command, args))
        if command == "search":
            range_text = args[-1]
            start, end = (int(value) for value in range_text.split()[-1].split(":"))
            uids = [uid for uid in self.messages if start <= uid <= end]
            return "OK", [" ".join(str(uid) for uid in uids).encode()]
        uid = int(args[0])
        query = args[1]
        if "RFC822.SIZE" in query:
            length = self.messages[uid]["size"]
            return "OK", [(f"1 (UID {uid} RFC822.SIZE {length})".encode(), b"")]
        if "BODY.PEEK[]" in query:
            return "OK", [(f"1 (UID {uid} BODY[] {{{len(self.messages[uid]['raw'])}}}".encode(), self.messages[uid]["raw"]), b")"]
        raise AssertionError(f"Unexpected IMAP fetch query: {query}")

    def logout(self):
        return "BYE", [b"logout"]


class FakeSocket:
    def __init__(self):
        self.timeouts = []

    def settimeout(self, timeout):
        self.timeouts.append(timeout)


def make_message(sender, subject, body, extra_headers=""):
    return (
        f"From: {sender}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n"
        f"{extra_headers}\r\n{body}\r\n"
    ).encode()


def fixture_db(path: Path):
    connection = sqlite3.connect(path)
    connection.executescript("""
        CREATE TABLE prospects (lead_id TEXT PRIMARY KEY, contact_email TEXT, status TEXT);
        CREATE TABLE campaign_sends (
            send_id INTEGER PRIMARY KEY, recipient_email TEXT, status TEXT, response_msg TEXT
        );
        CREATE TABLE email_suppression (
            email TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO prospects VALUES ('lead-reply', 'reply@startup.test', 'Approved for Outreach');
        INSERT INTO prospects VALUES ('lead-optout', 'stop@startup.test', 'Approved for Outreach');
        INSERT INTO prospects VALUES ('lead-bounce', 'bad@startup.test', 'Approved for Outreach');
        INSERT INTO prospects VALUES ('lead-dry', 'dry@startup.test', 'Approved for Outreach');
        INSERT INTO campaign_sends VALUES (1, 'reply@startup.test', 'SENT', '250 accepted');
        INSERT INTO campaign_sends VALUES (2, 'stop@startup.test', 'SENT', '250 accepted');
        INSERT INTO campaign_sends VALUES (3, 'bad@startup.test', 'SENT', '250 accepted');
        INSERT INTO campaign_sends VALUES (4, 'dry@startup.test', 'SENT', '[DRY-RUN] simulated');
    """)
    connection.commit()
    connection.close()


def mailbox(provider="MICROSOFT"):
    return {
        "mailbox_id": 8,
        "email": "sender@example.test",
        "smtp_user": "private-login@example.test",
        "smtp_password": "PRIVATE-TEST-SECRET",
        "provider_type": provider,
    }


class TestInboundMonitor(unittest.TestCase):
    def test_provider_host_is_fixed_and_unknown_providers_fail_closed(self):
        self.assertEqual(inbound_monitor.imap_host_for_provider("MICROSOFT"), "outlook.office365.com")
        self.assertEqual(inbound_monitor.imap_host_for_provider("GOOGLE"), "imap.gmail.com")
        for provider in ("OTHER", "ANY", ""):
            with self.subTest(provider=provider), self.assertRaises(inbound_monitor.InboundScanError):
                inbound_monitor.imap_host_for_provider(provider)

    def test_scan_uses_examine_peek_bound_and_local_classification_only(self):
        with tempfile.TemporaryDirectory(prefix="outbounder-inbound-test-") as temp:
            db_path = Path(temp) / "isolated.sqlite3"
            fixture_db(db_path)
            messages = {
                1: {"raw": make_message("old@other.test", "Old", "outside the requested scan window"), "size": 84},
                2: {"raw": make_message("reply@startup.test", "Re: accounting", "Thanks, let's talk next week."), "size": 90},
                3: {"raw": make_message("stop@startup.test", "Re: accounting", "Please unsubscribe me."), "size": 82},
                4: {"raw": make_message("MAILER-DAEMON@example.test", "Undeliverable: books", "Final-Recipient: rfc822; bad@startup.test"), "size": 100},
                5: {"raw": make_message("dry@startup.test", "Re: accounting", "Thanks."), "size": 70},
                6: {"raw": make_message("stranger@other.test", "Hello", "A normal unrelated note."), "size": 74},
            }
            instances = []

            def factory(host, port, timeout):
                client = FakeIMAP(host, port, timeout, messages)
                instances.append(client)
                return client

            result = inbound_monitor.scan_mailbox_readonly(
                mailbox(), max_messages=5, database_path=db_path, imap_factory=factory,
            )

            self.assertEqual(instances[0].host, "outlook.office365.com")
            self.assertEqual(instances[0].port, 993)
            self.assertEqual(instances[0].timeout, inbound_monitor.INBOUND_IMAP_OPERATION_TIMEOUT)
            self.assertTrue(all(timeout <= inbound_monitor.INBOUND_IMAP_OPERATION_TIMEOUT for timeout in instances[0].sock.timeouts))
            self.assertEqual(instances[0].logged_in, ("private-login@example.test", "PRIVATE-TEST-SECRET"))
            self.assertTrue(instances[0].selected_readonly)
            self.assertTrue(all("BODY.PEEK[]" in args[1] or "RFC822.SIZE" in args[1] for cmd, args in instances[0].fetch_requests if cmd == "fetch"))
            self.assertTrue(all("RFC822" not in args[1] or "RFC822.SIZE" in args[1] for cmd, args in instances[0].fetch_requests if cmd == "fetch"))
            self.assertEqual(result, {
                "status": "SUCCESS", "messages_checked": 5, "replies_processed": 1,
                "bounces_processed": 1, "opt_outs_processed": 1, "unrelated": 2,
                "already_processed": 0, "oversized_skipped": 0,
            })
            self.assertNotIn("PRIVATE-TEST-SECRET", repr(result))
            self.assertNotIn("reply@startup.test", repr(result))
            self.assertNotIn("Thanks, let's talk", repr(result))

            connection = sqlite3.connect(db_path)
            try:
                statuses = dict(connection.execute("SELECT contact_email, status FROM prospects"))
                suppressions = dict(connection.execute("SELECT email, reason FROM email_suppression"))
                saved_rows = connection.execute("SELECT classification FROM inbound_scan_messages ORDER BY uid").fetchall()
                saved_dump = " ".join(str(value) for row in saved_rows for value in row)
                self.assertEqual(statuses["reply@startup.test"], "Replied (Warm)")
                self.assertEqual(statuses["stop@startup.test"], "Discarded / DNC")
                self.assertEqual(statuses["bad@startup.test"], "Bounced / 550 Invalid")
                self.assertEqual(statuses["dry@startup.test"], "Approved for Outreach")
                self.assertEqual(suppressions["stop@startup.test"], "Inbound opt-out request")
                self.assertEqual(suppressions["bad@startup.test"], "Inbound delivery failure (NDR)")
                self.assertNotIn("Thanks", saved_dump)
                self.assertNotIn("PRIVATE-TEST-SECRET", saved_dump)
            finally:
                connection.close()

    def test_uidvalidity_uid_dedup_makes_updates_idempotent(self):
        with tempfile.TemporaryDirectory(prefix="outbounder-inbound-idempotency-") as temp:
            db_path = Path(temp) / "isolated.sqlite3"
            fixture_db(db_path)
            messages = {15: {"raw": make_message("stop@startup.test", "Re:", "Remove me from the list."), "size": 90}}
            clients = []

            def factory(host, port, timeout):
                client = FakeIMAP(host, port, timeout, messages)
                clients.append(client)
                return client

            first = inbound_monitor.scan_mailbox_readonly(mailbox(), database_path=db_path, imap_factory=factory)
            second = inbound_monitor.scan_mailbox_readonly(mailbox(), database_path=db_path, imap_factory=factory)
            self.assertEqual(first["opt_outs_processed"], 1)
            self.assertEqual(second["opt_outs_processed"], 0)
            self.assertEqual(second["already_processed"], 1)
            self.assertEqual(len(clients), 2)
            connection = sqlite3.connect(db_path)
            try:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM email_suppression").fetchone()[0], 1)
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM inbound_scan_messages").fetchone()[0], 1)
            finally:
                connection.close()

    def test_oversized_message_is_never_fetched_and_unconfirmed_credentials_are_not_exposed(self):
        with tempfile.TemporaryDirectory(prefix="outbounder-inbound-size-") as temp:
            db_path = Path(temp) / "isolated.sqlite3"
            fixture_db(db_path)
            messages = {10: {"raw": b"not fetched", "size": inbound_monitor.MAX_INBOUND_MESSAGE_BYTES + 1}}
            fake = FakeIMAP("outlook.office365.com", 993, 10, messages)
            result = inbound_monitor.scan_mailbox_readonly(
                mailbox(), database_path=db_path, imap_factory=lambda *_args, **_kwargs: fake,
            )
            self.assertEqual(result["oversized_skipped"], 1)
            self.assertFalse(any("BODY.PEEK[]" in args[1] for cmd, args in fake.fetch_requests if cmd == "fetch"))
            missing = mailbox()
            missing["smtp_password"] = ""
            with self.assertRaises(inbound_monitor.InboundScanError) as error:
                inbound_monitor.scan_mailbox_readonly(missing, database_path=db_path, imap_factory=Mock())
            self.assertNotIn("PRIVATE-TEST-SECRET", str(error.exception))

    def test_provider_maps_google_and_no_real_imap_transport_is_used_by_tests(self):
        with tempfile.TemporaryDirectory(prefix="outbounder-inbound-google-") as temp:
            db_path = Path(temp) / "isolated.sqlite3"
            fixture_db(db_path)
            fake = FakeIMAP("imap.gmail.com", 993, 10, {})
            result = inbound_monitor.scan_mailbox_readonly(
                mailbox("GOOGLE"), database_path=db_path, imap_factory=lambda *_args, **_kwargs: fake,
            )
            self.assertEqual(fake.host, "imap.gmail.com")
            self.assertEqual(result["messages_checked"], 0)

    def test_absolute_scan_deadline_stops_before_first_imap_command(self):
        fake = FakeIMAP("outlook.office365.com", 993, 1.5, {})
        with patch.object(inbound_monitor.time, "monotonic", side_effect=[100.0, 176.0]):
            with self.assertRaisesRegex(inbound_monitor.InboundScanError, "time limit"):
                inbound_monitor.scan_mailbox_readonly(
                    mailbox(), database_path=Path("unused.db"), imap_factory=lambda *_args, **_kwargs: fake,
                )
        self.assertIsNone(fake.logged_in)


if __name__ == "__main__":
    unittest.main()
