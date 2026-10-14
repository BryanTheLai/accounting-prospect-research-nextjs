"""Pure tests for campaign-local business-hour schedules."""

import unittest
from datetime import datetime, timezone

from campaign_schedule import (
    CampaignSchedule,
    is_within_campaign_hours,
    next_campaign_opening,
)


class TestCampaignSchedule(unittest.TestCase):
    def setUp(self):
        self.schedule = CampaignSchedule("America/Los_Angeles")

    def test_california_window_boundaries_are_start_inclusive_end_exclusive(self):
        # March 6 is PST (UTC-8); 09:00 PST is 17:00 UTC.
        self.assertFalse(is_within_campaign_hours(
            self.schedule, datetime(2026, 3, 6, 16, 59, tzinfo=timezone.utc)))
        self.assertTrue(is_within_campaign_hours(
            self.schedule, datetime(2026, 3, 6, 17, 0, tzinfo=timezone.utc)))
        # 17:59:59.999... is inside; 18:00 is outside.
        self.assertTrue(is_within_campaign_hours(
            self.schedule, datetime(2026, 3, 7, 1, 59, 59, 999999, tzinfo=timezone.utc)))
        self.assertFalse(is_within_campaign_hours(
            self.schedule, datetime(2026, 3, 7, 2, 0, tzinfo=timezone.utc)))

    def test_weekends_are_closed_in_campaign_local_time(self):
        # Saturday 10:00 in California, even though UTC is also Saturday.
        self.assertFalse(is_within_campaign_hours(
            self.schedule, datetime(2026, 3, 7, 18, 0, tzinfo=timezone.utc)))

    def test_spring_dst_keeps_nine_am_california_open(self):
        before_dst = datetime(2026, 3, 6, 17, 0, tzinfo=timezone.utc)  # 09:00 PST
        after_dst = datetime(2026, 3, 9, 16, 0, tzinfo=timezone.utc)  # 09:00 PDT
        one_minute_before_after_dst = datetime(2026, 3, 9, 15, 59, tzinfo=timezone.utc)

        self.assertEqual(before_dst.astimezone(self.schedule.timezone).utcoffset().total_seconds(), -8 * 3600)
        self.assertEqual(after_dst.astimezone(self.schedule.timezone).utcoffset().total_seconds(), -7 * 3600)
        self.assertTrue(is_within_campaign_hours(self.schedule, before_dst))
        self.assertTrue(is_within_campaign_hours(self.schedule, after_dst))
        self.assertFalse(is_within_campaign_hours(self.schedule, one_minute_before_after_dst))

    def test_fall_dst_keeps_nine_am_california_open(self):
        before_dst_end = datetime(2026, 10, 30, 16, 0, tzinfo=timezone.utc)  # 09:00 PDT
        after_dst_end = datetime(2026, 11, 2, 17, 0, tzinfo=timezone.utc)  # 09:00 PST
        one_minute_before_after_dst_end = datetime(2026, 11, 2, 16, 59, tzinfo=timezone.utc)

        self.assertEqual(before_dst_end.astimezone(self.schedule.timezone).utcoffset().total_seconds(), -7 * 3600)
        self.assertEqual(after_dst_end.astimezone(self.schedule.timezone).utcoffset().total_seconds(), -8 * 3600)
        self.assertTrue(is_within_campaign_hours(self.schedule, before_dst_end))
        self.assertTrue(is_within_campaign_hours(self.schedule, after_dst_end))
        self.assertFalse(is_within_campaign_hours(self.schedule, one_minute_before_after_dst_end))

    def test_next_opening_uses_same_day_before_open_and_next_weekday_after_close(self):
        before_open = datetime(2026, 3, 6, 16, 0, tzinfo=timezone.utc)  # Fri 08:00 PST
        during_open = datetime(2026, 3, 6, 18, 0, tzinfo=timezone.utc)  # Fri 10:00 PST
        after_close_friday = datetime(2026, 3, 7, 3, 0, tzinfo=timezone.utc)  # Fri 19:00 PST

        self.assertEqual(
            next_campaign_opening(self.schedule, before_open),
            datetime(2026, 3, 6, 17, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(next_campaign_opening(self.schedule, during_open), during_open)
        # The next opening is Monday 09:00 PDT, so the UTC offset has changed.
        self.assertEqual(
            next_campaign_opening(self.schedule, after_close_friday),
            datetime(2026, 3, 9, 16, 0, tzinfo=timezone.utc),
        )

    def test_next_opening_from_weekend_is_monday_in_local_zone(self):
        saturday = datetime(2026, 3, 7, 18, 0, tzinfo=timezone.utc)
        expected = datetime(2026, 3, 9, 9, 0, tzinfo=self.schedule.timezone)
        self.assertEqual(next_campaign_opening(self.schedule, saturday), expected)

    def test_next_opening_after_dst_weekend_uses_new_offset(self):
        sunday_after_spring_transition = datetime(2026, 3, 8, 17, 0, tzinfo=timezone.utc)
        expected = datetime(2026, 3, 9, 9, 0, tzinfo=self.schedule.timezone)
        self.assertEqual(next_campaign_opening(self.schedule, sunday_after_spring_transition), expected)
        self.assertEqual(expected.utcoffset().total_seconds(), -7 * 3600)

    def test_invalid_timezone_and_window_are_rejected(self):
        with self.assertRaises(ValueError):
            CampaignSchedule("Mars/Olympus_Mons")
        with self.assertRaises(ValueError):
            CampaignSchedule("America/Los_Angeles", start_minute=-1)
        with self.assertRaises(ValueError):
            CampaignSchedule("America/Los_Angeles", end_minute=1441)
        with self.assertRaises(ValueError):
            CampaignSchedule("America/Los_Angeles", start_minute=1080, end_minute=1080)
        with self.assertRaises(ValueError):
            CampaignSchedule("America/Los_Angeles", start_minute=True)

    def test_naive_clock_is_rejected(self):
        with self.assertRaises(ValueError):
            is_within_campaign_hours(self.schedule, datetime(2026, 3, 6, 17, 0))
        with self.assertRaises(ValueError):
            next_campaign_opening(self.schedule, datetime(2026, 3, 6, 17, 0))


if __name__ == "__main__":
    unittest.main()
