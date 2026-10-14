import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import campaign_database as db
import dispatch_queue as queue


class DispatchQueueTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "queue.sqlite"
        self.patch = patch.object(db, "DB_PATH", self.path)
        self.patch.start()
        db.init_campaign_tables()
        self.leads = [
            {"lead_id": "one", "contact_email": "one@example.test", "_queued_subject": "Exact subject", "_queued_body": "Exact body"},
            {"lead_id": "two", "contact_email": "two@example.test", "_queued_subject": "Second subject", "_queued_body": "Second body"},
        ]

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def test_queue_survives_real_process_boundary_with_settings_and_exact_copy(self):
        queue.create_run("run", self.leads, {"min_delay": 150}, live=True)
        queue.update_run("run", schedule_override=True, next_send_at=123456789)
        env = {**os.environ, "OUTBOUNDER_DB_PATH": str(self.path)}
        code = "import json,dispatch_queue; print(json.dumps(dispatch_queue.recover_run()))"
        child = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True)
        recovered = json.loads(child.stdout)
        self.assertEqual(recovered["leads"][0]["_queued_body"], "Exact body")
        self.assertTrue(recovered["live"])
        self.assertTrue(recovered["schedule_override"])
        self.assertEqual(recovered["next_send_at"], 123456789)

    def test_inflight_without_acceptance_is_held_not_resent(self):
        queue.create_run("run", self.leads, {}, live=True)
        queue.set_item_status("run", "one", "IN_FLIGHT")
        recovered = queue.recover_run()
        self.assertEqual([r["lead_id"] for r in recovered["leads"]], ["two"])
        self.assertEqual(queue.run_summary("run")["uncertain_count"], 1)

    def test_unresolved_live_submissions_are_excluded_across_fresh_runs(self):
        checked = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
        with db.get_db_connection() as connection:
            connection.execute("CREATE TABLE prospects(lead_id TEXT PRIMARY KEY,contact_email TEXT,status TEXT)")
            connection.execute("CREATE TABLE email_preflight(lead_id TEXT PRIMARY KEY,email TEXT,mx_status TEXT,source_confirmed INTEGER,checked_at TEXT,source_confirmed_at TEXT)")
            for lead in self.leads:
                connection.execute("INSERT INTO prospects VALUES (?,?,'Approved for Outreach')", (lead["lead_id"], lead["contact_email"]))
                connection.execute("INSERT INTO email_preflight VALUES (?,?,'mx_present',1,?,?)", (lead["lead_id"], lead["contact_email"], checked, checked))
        queue.create_run("run", self.leads, {}, live=True)
        for state in ("IN_FLIGHT", "UNCERTAIN"):
            with self.subTest(state=state):
                queue.set_item_status("run", "one", state)
                queue.update_run("run", status="STOPPED")
                self.assertIn("one@example.test", db.get_sent_email_set())
                self.assertFalse(db.is_live_outreach_ready("one", "one@example.test"))
                self.assertTrue(db.is_live_outreach_ready("two", "two@example.test"))
        with db.get_db_connection() as connection:
            connection.execute("UPDATE dispatch_runs SET live=0 WHERE run_id='run'")
        self.assertNotIn("one@example.test", db.get_sent_email_set())
        self.assertTrue(db.is_live_outreach_ready("one", "one@example.test"))

    def test_inflight_with_durable_acceptance_is_not_resent(self):
        queue.create_run("run", self.leads, {}, live=True)
        queue.set_item_status("run", "one", "IN_FLIGHT")
        db.log_send_event("one", "one@example.test", "One", "Exact subject", "SENT", 250,
                          "250 Message accepted", run_id="run", body="Exact body")
        recovered = queue.recover_run()
        self.assertEqual([r["lead_id"] for r in recovered["leads"]], ["two"])
        self.assertEqual(queue.run_summary("run")["accepted_count"], 1)
        self.assertEqual(queue.run_summary("run")["uncertain_count"], 0)

    def test_stopped_and_paused_are_not_automatically_resumed(self):
        queue.create_run("run", self.leads, {}, live=True)
        queue.update_run("run", status="PAUSED")
        self.assertIsNone(queue.recover_run())
        queue.update_run("run", status="STOPPED")
        self.assertIsNone(queue.recover_run())

    def test_only_one_unfinished_run_and_unique_recipients(self):
        queue.create_run("run", self.leads, {}, live=True)
        with self.assertRaises(RuntimeError):
            queue.create_run("other", self.leads, {}, live=True)
        queue.update_run("run", status="STOPPED")
        duplicate = [self.leads[0], {**self.leads[1], "contact_email": "ONE@example.test"}]
        with self.assertRaises(ValueError):
            queue.create_run("other", duplicate, {}, live=True)

    def test_restored_dispatcher_uses_frozen_copy_and_does_not_resend_after_process_restart(self):
        leads = [{**self.leads[0], "company_name": "One", "root_domain": "example.test", "_ab_run_id": "run"}]
        queue.create_run("run", leads, {"business_hours_only": False}, live=True)
        code = r'''
import json
from unittest.mock import MagicMock, patch
from campaign_dispatcher import CampaignDispatcher
import dispatch_queue
import campaign_database
server=MagicMock()
mailbox={"mailbox_id":0,"email":"sender@example.test","sender_name":"Sender","smtp_server":"smtp.invalid","smtp_port":587,"smtp_user":"sender","smtp_password":"test-only","daily_limit":25,"hourly_limit":5}
with patch("campaign_dispatcher.is_live_outreach_ready",return_value=True), patch("campaign_dispatcher.is_domain_in_cooldown",return_value=False), patch("campaign_dispatcher.detect_domain_esp",return_value="OTHER"), patch("campaign_dispatcher.get_available_mailbox",return_value=mailbox), patch("campaign_dispatcher.enforce_warmup_limits",side_effect=lambda mb,**kwargs:mb), patch("campaign_dispatcher.get_mailbox_metrics",return_value={"sends_today":0,"sends_this_hour":0}), patch("campaign_dispatcher.smtplib.SMTP") as smtp:
    smtp.return_value.__enter__.return_value=server
    dispatcher=CampaignDispatcher()
    dispatcher.recover_saved_campaign()
    dispatcher._thread.join(timeout=5)
    with campaign_database.get_db_connection() as connection:
        log=connection.execute("SELECT body FROM campaign_sends WHERE run_id='run' ORDER BY send_id DESC LIMIT 1").fetchone()
    print(json.dumps({"send_calls":server.sendmail.call_count,"state":dispatcher.get_snapshot(),"log":log[0] if log else None}))
'''
        env = {**os.environ, "OUTBOUNDER_DB_PATH": str(self.path), "ENABLE_LIVE_DISPATCH": "false"}
        result = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        restored = json.loads(result.stdout)
        self.assertEqual(restored["send_calls"], 1)
        self.assertEqual(restored["log"], "Exact body")
        self.assertEqual(restored["state"]["accepted_count"], 1)
        self.assertIsNone(queue.recover_run())

    def test_worker_recovery_exception_is_visible_and_saved_queue_remains_paused(self):
        from campaign_dispatcher import CampaignDispatcher
        queue.create_run("run", self.leads, {}, live=False)
        dispatcher = CampaignDispatcher()
        dispatcher._run_id = "run"
        with patch.object(dispatcher, "_worker_loop", side_effect=RuntimeError("test failure")):
            dispatcher._run_worker(self.leads, "", "")
        self.assertTrue(dispatcher.state["is_paused"])
        self.assertEqual(dispatcher.state["wait_reason"], "worker_error")
        self.assertIsNone(queue.recover_run())
        self.assertEqual(len(queue.recover_run(include_paused=True)["leads"]), 2)

    def test_spacing_is_used_after_every_message_without_extra_four_send_break(self):
        from campaign_dispatcher import CampaignDispatcher
        dispatcher = CampaignDispatcher()
        dispatcher.state["business_hours_only"] = False
        dispatcher._pause_event.set()
        mailbox = {"mailbox_id": 0, "email": "sender@example.test", "daily_limit": 25, "hourly_limit": 5,
                   "created_at": "2000-01-01 00:00:00"}
        leads = [{"lead_id": f"pacing-{i}", "company_name": "Example", "contact_email": f"person{i}@example.test"}
                 for i in range(5)]
        with patch("campaign_dispatcher.is_live_dispatch_enabled", return_value=False), \
             patch("campaign_dispatcher.get_available_mailbox", return_value=mailbox), \
             patch("campaign_dispatcher.get_mailbox_metrics", return_value={"sends_today": 0, "sends_this_hour": 0}), \
             patch("campaign_dispatcher.detect_domain_esp", return_value="OTHER"), \
             patch("campaign_dispatcher.is_domain_in_cooldown", return_value=False), \
             patch("campaign_dispatcher.log_send_event"), \
             patch("campaign_dispatcher.calculate_human_delay", return_value=150) as delay, \
             patch.object(dispatcher, "_wait_until") as wait:
            dispatcher._worker_loop(leads, "Subject", "Body")
        self.assertEqual(delay.call_count, 4)
        self.assertEqual(wait.call_count, 4)
        self.assertTrue(all(call.args[0] == "spacing" for call in wait.call_args_list))

    def test_exception_after_stop_does_not_reactivate_saved_run(self):
        from campaign_dispatcher import CampaignDispatcher
        queue.create_run("run", self.leads, {}, live=False)
        dispatcher = CampaignDispatcher()
        dispatcher._run_id = "run"
        dispatcher._stop_event.set()
        with patch.object(dispatcher, "_worker_loop", side_effect=RuntimeError("stopped worker")):
            dispatcher._run_worker(self.leads, "", "")
        self.assertIsNone(queue.recover_run(include_paused=True))

    def test_quota_wait_targets_rolling_hour_reset_and_daily_midnight(self):
        from datetime import datetime, timedelta
        now = datetime.now()
        mailbox = {"mailbox_id": 1, "email": "sender@example.test", "status": "ACTIVE", "daily_limit": 10,
                   "hourly_limit": 3, "created_at": "2000-01-01 00:00:00", "sends_today": 3, "sends_this_hour": 3}
        with db.get_db_connection() as connection:
            for minutes in (5, 10, 15):
                connection.execute("INSERT INTO campaign_sends(lead_id,recipient_email,subject,status,response_msg,sender_email,sent_at) VALUES ('quota','recipient@example.test','test','SENT','accepted',?,?)",
                                   (mailbox["email"], (now - timedelta(minutes=minutes)).strftime("%Y-%m-%d %H:%M:%S")))
        with patch.object(db, "get_all_mailboxes", return_value=[mailbox]):
            hourly = db.next_mailbox_slot()
        self.assertEqual(hourly["reason"], "hourly_quota")
        self.assertAlmostEqual(hourly["timestamp"], (now + timedelta(minutes=45, seconds=1)).timestamp(), delta=2)
        with patch.object(db, "get_all_mailboxes", return_value=[{**mailbox, "sends_today": 10}]):
            daily = db.next_mailbox_slot()
        self.assertEqual(daily["reason"], "daily_quota")
        self.assertEqual(datetime.fromtimestamp(daily["timestamp"]).hour, 0)

    def test_recovery_rechecks_changed_quotas_across_a_process_boundary(self):
        from datetime import datetime, timedelta
        now = datetime.now()
        with db.get_db_connection() as connection:
            connection.execute("INSERT INTO mailboxes(email,smtp_user,smtp_password,daily_limit,hourly_limit,manual_limits) VALUES ('sender@example.test','fixture','fixture',1,1,1)")
        queue.create_run("run", self.leads, {"min_delay": 90, "max_delay": 210}, live=True)
        db.log_send_event("one", "one@example.test", "One", "Exact subject", "SENT", 250,
                          "accepted", run_id="run", sender_email="sender@example.test")
        with db.get_db_connection() as connection:
            connection.execute("UPDATE campaign_sends SET sent_at=?", ((now-timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S"),))
        deadline = (now+timedelta(hours=12)).timestamp()
        queue.update_run("run", next_send_at=deadline, wait_reason="daily_quota")
        env = {**os.environ, "OUTBOUNDER_DB_PATH": str(self.path), "ENABLE_LIVE_DISPATCH": "false"}
        def recover():
            child = subprocess.run([sys.executable, "-c", "import json,dispatch_queue;print(json.dumps(dispatch_queue.recover_run()))"], env=env, capture_output=True, text=True, check=True)
            return json.loads(child.stdout)
        self.assertEqual(recover()["wait_reason"], "daily_quota")
        with db.get_db_connection() as connection:
            connection.execute("UPDATE mailboxes SET daily_limit=100,hourly_limit=30")
        recovered = recover()
        self.assertLess(recovered["next_send_at"], now.timestamp()+30)
        self.assertEqual(recovered["run_id"], "run")
        self.assertEqual(recovered["leads"], [self.leads[1]])
        self.assertEqual(queue.run_summary("run")["accepted_count"], 1)

    def test_quota_recheck_does_not_shortcut_saved_message_spacing(self):
        from datetime import datetime, timedelta
        queue.create_run("run", self.leads, {}, live=True)
        deadline = (datetime.now()+timedelta(minutes=3)).timestamp()
        queue.update_run("run", next_send_at=deadline, wait_reason="spacing")
        with patch.object(db, "next_mailbox_slot") as slot:
            recovered = queue.recover_run()
        slot.assert_not_called()
        self.assertEqual(recovered["next_send_at"], deadline)


if __name__ == "__main__":
    unittest.main()
