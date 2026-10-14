"""Pure campaign-local business-hours scheduling helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


DEFAULT_START_MINUTE = 9 * 60
DEFAULT_END_MINUTE = 18 * 60


@dataclass(frozen=True)
class CampaignSchedule:
    """A weekday delivery window expressed in an IANA timezone and local minutes.

    The window is start-inclusive and end-exclusive. Weekends are always closed.
    Defaults match the intended YC California schedule: 09:00–18:00 local time.
    """

    timezone_name: str
    start_minute: int = DEFAULT_START_MINUTE
    end_minute: int = DEFAULT_END_MINUTE

    def __post_init__(self) -> None:
        if not isinstance(self.timezone_name, str) or not self.timezone_name.strip():
            raise ValueError("timezone_name must be a non-empty IANA timezone name")
        try:
            ZoneInfo(self.timezone_name)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"Unknown IANA timezone: {self.timezone_name!r}") from exc

        if type(self.start_minute) is not int or not 0 <= self.start_minute < 24 * 60:
            raise ValueError("start_minute must be an integer from 0 through 1439")
        if type(self.end_minute) is not int or not 1 <= self.end_minute <= 24 * 60:
            raise ValueError("end_minute must be an integer from 1 through 1440")
        if self.start_minute >= self.end_minute:
            raise ValueError("start_minute must be earlier than end_minute")

    @property
    def timezone(self) -> ZoneInfo:
        """Return the validated timezone; ZoneInfo applies current DST rules."""
        return ZoneInfo(self.timezone_name)


def _require_aware(now: datetime) -> None:
    if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be a timezone-aware datetime")


def _local_minute_of_day(now: datetime) -> int:
    return now.hour * 60 + now.minute


def is_within_campaign_hours(schedule: CampaignSchedule, now: datetime) -> bool:
    """Return whether an aware instant is within the campaign's local weekday window."""
    _require_aware(now)
    local_now = now.astimezone(schedule.timezone)
    if local_now.weekday() >= 5:
        return False

    minute = _local_minute_of_day(local_now)
    return schedule.start_minute <= minute < schedule.end_minute


def next_campaign_opening(schedule: CampaignSchedule, now: datetime) -> datetime:
    """Return the earliest campaign-allowed instant at or after ``now``.

    If the campaign is currently open, this returns ``now`` converted to its local
    timezone. Before opening on a weekday it returns that day's start; after close
    or on a weekend it returns the next weekday's start. The returned datetime is
    timezone-aware and reflects the timezone's DST offset on that date.
    """
    _require_aware(now)
    local_now = now.astimezone(schedule.timezone)
    minute = _local_minute_of_day(local_now)

    if local_now.weekday() < 5:
        if minute < schedule.start_minute:
            return _opening_at(schedule, local_now.date())
        if minute < schedule.end_minute:
            return local_now

    next_date = local_now.date() + timedelta(days=1)
    while next_date.weekday() >= 5:
        next_date += timedelta(days=1)
    return _opening_at(schedule, next_date)


def _opening_at(schedule: CampaignSchedule, day: date) -> datetime:
    hour, minute = divmod(schedule.start_minute, 60)
    # Campaign business-hour starts such as 09:00 are not in DST transition gaps.
    # Build the wall-clock opening with the zone attached for that calendar date.
    return datetime.combine(day, time(hour=hour, minute=minute), tzinfo=schedule.timezone)
