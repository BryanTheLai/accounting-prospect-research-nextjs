import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import campaign_database
from campaign_dispatcher import CampaignDispatcher


class TestCampaignAbAssignment(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.db_path = Path(self.temp_dir.name) / "campaign-ab-test.sqlite"
        self.db_path_patch = patch.object(campaign_database, "DB_PATH", self.db_path)
        self.db_path_patch.start()
        self.addCleanup(self.db_path_patch.stop)
        self.variants = [
            {"name": "Angle A", "template_id": 11, "subject": "A subject", "body": "A body"},
            {"name": "Angle B", "template_id": 22, "subject": "B subject", "body": "B body"},
        ]

    def make_leads(self, lead_count):
        return [
            {"lead_id": f"ab_lead_{index}", "campaign_id": "yc_us_expansion",
             "company_name": f"Company {index}", "root_domain": f"company{index}.example",
             "contact_email": f"founder{index}@company{index}.example"}
            for index in range(lead_count)
        ]

    def run_without_worker(self, leads, variants=None):
        dispatcher = CampaignDispatcher()
        with patch("campaign_dispatcher.get_sent_email_set", return_value=set()), \
             patch("campaign_dispatcher.is_government_affiliated", return_value=(False, "")), \
             patch("campaign_dispatcher.threading.Thread") as thread_cls:
            counts = dispatcher.start_campaign(
                leads, "fallback subject", "fallback body", variants=variants or self.variants,
                schedule={"timezone_name": "America/Los_Angeles", "start_minute": 540, "end_minute": 1080},
            )
        self.assertTrue(thread_cls.return_value.start.called)
        queued = thread_cls.call_args.kwargs["args"][0]
        thread_cls.return_value.is_alive.return_value = False
        dispatcher.stop_campaign()
        return counts, queued

    def test_even_a_b_cohort_is_exactly_half_and_randomized(self):
        counts, queued = self.run_without_worker(self.make_leads(20))
        self.assertEqual(counts, {"Angle A": 10, "Angle B": 10})
        self.assertEqual(len(queued), 20)
        self.assertEqual(len({lead["_ab_run_id"] for lead in queued}), 1)
        for lead in queued:
            self.assertEqual(lead["_ab_template_id"], 11 if lead["_ab_variant_name"] == "Angle A" else 22)
            self.assertEqual(lead["_ab_subject_tmpl"], "A subject" if lead["_ab_variant_name"] == "Angle A" else "B subject")

    def test_odd_a_b_cohort_assigns_the_extra_to_a_random_variant(self):
        counts, queued = self.run_without_worker(self.make_leads(5))
        self.assertEqual(len(queued), 5)
        self.assertEqual(abs(counts["Angle A"] - counts["Angle B"]), 1)
        self.assertEqual(sum(counts.values()), 5)

    def test_bracketed_company_name_fails_before_run_is_queued(self):
        lead = self.make_leads(1)[0]
        lead["company_name"] = "[in]trigue"
        variants = [
            {"name": "Angle A", "template_id": 11, "subject": "Subject", "body": "Help {{company_name}}."},
            {"name": "Angle B", "template_id": 22, "subject": "Subject", "body": "Help {{company_name}}."},
        ]
        dispatcher = CampaignDispatcher()
        with patch("campaign_dispatcher.get_sent_email_set", return_value=set()), \
             patch("campaign_dispatcher.is_government_affiliated", return_value=(False, "")), \
             patch("campaign_dispatcher.dispatch_queue.create_run") as create_run, \
             patch("campaign_dispatcher.threading.Thread") as thread_cls:
            with self.assertRaisesRegex(ValueError, "company_name.*bracket"):
                dispatcher.start_campaign([lead], "Subject", "Body", variants=variants)
        create_run.assert_not_called()
        thread_cls.assert_not_called()

    def test_new_even_cohort_randomizes_variant_order_and_stays_balanced(self):
        leads = self.make_leads(6)

        def interleave_variants(items):
            if items and "template_id" in items[0]:
                items[:] = [items[index] for index in (0, 3, 1, 4, 2, 5)]

        with patch("campaign_database.random.shuffle", side_effect=interleave_variants):
            counts, queued = self.run_without_worker(leads)

        by_lead = {lead["lead_id"]: lead["_ab_template_id"] for lead in queued}
        self.assertEqual(counts, {"Angle A": 3, "Angle B": 3})
        self.assertEqual([by_lead[f"ab_lead_{index}"] for index in range(6)], [11, 22, 11, 22, 11, 22])

    def test_repeat_and_new_process_restart_reuse_each_saved_template_assignment(self):
        leads = self.make_leads(7)
        assignment_shuffle_count = 0

        def deterministic_shuffle(items):
            nonlocal assignment_shuffle_count
            if items and "template_id" in items[0]:
                assignment_shuffle_count += 1
                if assignment_shuffle_count % 2 == 0:
                    items.reverse()
            else:
                items.reverse()

        with patch("campaign_dispatcher.random.shuffle", side_effect=deterministic_shuffle):
            _, first_queue = self.run_without_worker(leads)
            _, repeat_queue = self.run_without_worker(leads, list(reversed(self.variants)))
        expected = {lead["lead_id"]: lead["_ab_template_id"] for lead in first_queue}
        self.assertEqual(expected, {lead["lead_id"]: lead["_ab_template_id"] for lead in repeat_queue})

        extended_leads = self.make_leads(11)
        _, extended_queue = self.run_without_worker(extended_leads, list(reversed(self.variants)))
        extended_assignments = {lead["lead_id"]: lead["_ab_template_id"] for lead in extended_queue}
        self.assertEqual(expected, {lead_id: extended_assignments[lead_id] for lead_id in expected})
        new_template_counts = {
            template_id: sum(extended_assignments[f"ab_lead_{index}"] == template_id for index in range(7, 11))
            for template_id in (11, 22)
        }
        self.assertEqual(new_template_counts, {11: 2, 22: 2})
        expected = extended_assignments
        leads = extended_leads

        child_script = r"""
import json
import sys
from unittest.mock import patch
from campaign_dispatcher import CampaignDispatcher

leads = json.loads(sys.stdin.read())
variants = [
    {"name": "Angle A", "template_id": 11, "subject": "A subject", "body": "A body"},
    {"name": "Angle B", "template_id": 22, "subject": "B subject", "body": "B body"},
]
dispatcher = CampaignDispatcher()
with patch("campaign_dispatcher.get_sent_email_set", return_value=set()), patch("campaign_dispatcher.is_government_affiliated", return_value=(False, "")), patch("campaign_dispatcher.random.shuffle", side_effect=lambda items: items.reverse()), patch("campaign_dispatcher.threading.Thread") as thread_cls:
    dispatcher.start_campaign(leads, "fallback subject", "fallback body", variants=variants)
queued = thread_cls.call_args.kwargs["args"][0]
print(json.dumps({lead["lead_id"]: lead["_ab_template_id"] for lead in queued}, sort_keys=True))
"""
        child_env = os.environ.copy()
        child_env["OUTBOUNDER_DB_PATH"] = str(self.db_path)
        child_env["ENABLE_LIVE_DISPATCH"] = "false"
        completed = subprocess.run(
            [sys.executable, "-c", child_script],
            cwd=Path(__file__).resolve().parents[1],
            env=child_env,
            input=json.dumps(leads),
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )
        self.assertEqual(expected, json.loads(completed.stdout))


if __name__ == "__main__":
    unittest.main()
