"""Validation and safe summaries for local mailbox pacing controls."""

from __future__ import annotations

from typing import Any, Dict, Iterable

from warmup_ramper import enforce_warmup_limits


MAX_DAILY_CAP = 9_007_199_254_740_991
MAX_HOURLY_CAP = 9_007_199_254_740_991
MIN_DELAY_SECONDS = 60
MAX_DELAY_SECONDS = 3600
MIN_DELAY_SPAN_SECONDS = 30


class PacingInputError(ValueError):
    """Raised when a local pacing change falls outside safe bounds."""


def _integer(value: Any, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise PacingInputError(f"{label} must be a whole number from {minimum} to {maximum}.")
    return value


def validate_pacing_update(body: Any) -> Dict[str, int | None]:
    """Validate a confirmed per-mailbox pacing update without accepting secrets."""
    if not isinstance(body, dict):
        raise PacingInputError("Pacing settings are required.")
    shared = {"mailboxId", "dailyLimit", "hourlyLimit", "confirmed"}
    if "manualLimits" in body:
        if type(body["manualLimits"]) is not bool:
            raise PacingInputError("Choose manual or recommended warmup limits.")
        shared.add("manualLimits")
    inherit_delay = body.get("inheritDelay") is True
    allowed = shared | ({"inheritDelay"} if inherit_delay else {"minDelaySeconds", "maxDelaySeconds"})
    if set(body) != allowed:
        raise PacingInputError("Only mailbox pacing fields are accepted by this control.")
    if body.get("confirmed") is not True:
        raise PacingInputError("Confirm this mailbox pacing change before saving.")

    mailbox_id = _integer(body.get("mailboxId"), "Mailbox ID", 1, 2_147_483_647)
    daily = _integer(body.get("dailyLimit"), "Daily cap", 1, MAX_DAILY_CAP)
    hourly = _integer(body.get("hourlyLimit"), "Hourly cap", 1, MAX_HOURLY_CAP)
    if hourly > daily:
        raise PacingInputError("Hourly cap cannot exceed the daily cap.")
    if inherit_delay:
        minimum = maximum = None
    else:
        minimum = _integer(body.get("minDelaySeconds"), "Minimum delay", MIN_DELAY_SECONDS, MAX_DELAY_SECONDS)
        maximum = _integer(body.get("maxDelaySeconds"), "Maximum delay", MIN_DELAY_SECONDS, MAX_DELAY_SECONDS)
        if maximum - minimum < MIN_DELAY_SPAN_SECONDS:
            raise PacingInputError("Maximum delay must be at least 30 seconds above minimum delay.")

    return {
        "mailbox_id": mailbox_id,
        "daily_limit": daily,
        "hourly_limit": hourly,
        "min_delay_seconds": minimum,
        "max_delay_seconds": maximum,
        "manual_limits": body.get("manualLimits", True),
    }


def safe_mailbox_pacing_summary(
    mailboxes: Iterable[Dict[str, Any]],
    default_min_delay: int,
    default_max_delay: int,
) -> list[Dict[str, Any]]:
    """Return pacing/warmup state while dropping every SMTP credential field."""
    result: list[Dict[str, Any]] = []
    for mailbox in mailboxes:
        configured_daily = max(1, int(mailbox.get("daily_limit") or 1))
        configured_hourly = max(1, int(mailbox.get("hourly_limit") or 1))
        has_override = mailbox.get("min_delay_seconds") is not None and mailbox.get("max_delay_seconds") is not None
        configured_min = int(mailbox["min_delay_seconds"]) if has_override else int(default_min_delay)
        configured_max = int(mailbox["max_delay_seconds"]) if has_override else int(default_max_delay)
        effective = enforce_warmup_limits({**mailbox, "daily_limit": configured_daily, "hourly_limit": configured_hourly},
                                          default_min_delay=default_min_delay, default_max_delay=default_max_delay)
        policy = effective["warmup_info"]
        result.append({
            "mailboxId": int(mailbox["mailbox_id"]),
            "status": str(mailbox.get("status") or "UNKNOWN"),
            "sendsToday": int(mailbox.get("sends_today") or 0),
            "sendsThisHour": int(mailbox.get("sends_this_hour") or 0),
            "configuredDailyLimit": configured_daily,
            "configuredHourlyLimit": configured_hourly,
            "effectiveDailyLimit": effective["daily_limit"],
            "effectiveHourlyLimit": effective["hourly_limit"],
            "minDelaySeconds": configured_min,
            "maxDelaySeconds": configured_max,
            "hasDelayOverride": has_override,
            "manualLimits": bool(mailbox.get("manual_limits", 0)),
            "effectiveMinDelaySeconds": effective["effective_min_delay_seconds"],
            "effectiveMaxDelaySeconds": effective["effective_max_delay_seconds"],
            "warmup": {
                "dayNumber": int(policy["day_number"]),
                "phaseName": str(policy["phase_name"]),
                "recommendedDailyLimit": int(policy["daily_limit"]),
                "recommendedHourlyLimit": int(policy["hourly_limit"]),
                "recommendedMinDelaySeconds": int(policy["min_delay_seconds"]),
                "recommendedMaxDelaySeconds": int(policy["max_delay_seconds"]),
            },
        })
    return result
