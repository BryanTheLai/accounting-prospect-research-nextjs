"""
Automated 30-Day Domain & Mailbox Ramp-Up Engine
Calculates mailbox age, determines deliverability ramp stage,
    and applies recommended ceilings only when operator-controlled limits are disabled.

Path: warmup_ramper.py
"""

from datetime import datetime, timezone
from typing import Dict, Any, Tuple
from config import WARMUP_RAMP_TIERS

RAMP_TIERS = WARMUP_RAMP_TIERS

def calculate_mailbox_age_days(created_at_str: str) -> int:
    """Calculates days elapsed since mailbox creation."""
    if not created_at_str:
        return 1
    try:
        # SQLite CURRENT_TIMESTAMP format: YYYY-MM-DD HH:MM:SS
        created_dt = datetime.strptime(created_at_str.split(".")[0], "%Y-%m-%d %H:%M:%S")
        created_dt = created_dt.replace(tzinfo=timezone.utc)
        now_utc = datetime.now(timezone.utc)
        delta_days = (now_utc - created_dt).days + 1
        return max(1, delta_days)
    except Exception:
        return 1

def get_warmup_policy(created_at_str: str = "") -> Dict[str, Any]:
    """
    Returns the recommended daily cap, hourly cap, and phase for a mailbox
    based on its age in days.
    """
    age_days = calculate_mailbox_age_days(created_at_str)
    
    for max_day, daily_cap, hourly_cap, phase_name, min_del, max_del in RAMP_TIERS:
        if age_days <= max_day:
            return {
                "day_number": age_days,
                "daily_limit": daily_cap,
                "hourly_limit": hourly_cap,
                "phase_name": phase_name,
                "min_delay_seconds": min_del,
                "max_delay_seconds": max_del,
                "is_day_one": (age_days == 1)
            }
            
    # Default mature ceiling
    return {
        "day_number": age_days,
        "daily_limit": 25,
        "hourly_limit": 5,
        "phase_name": "Phase 6: Mature Ceiling",
        "min_delay_seconds": 60,
        "max_delay_seconds": 150,
        "is_day_one": False
    }

def enforce_warmup_limits(
    mailbox: Dict[str, Any],
    default_min_delay: int = 60,
    default_max_delay: int = 150,
) -> Dict[str, Any]:
    """
    Adjusts mailbox limits in-memory to not exceed the warmup schedule.
    """
    policy = get_warmup_policy(mailbox.get("created_at", ""))
    adjusted = dict(mailbox)
    manual = bool(mailbox.get("manual_limits", 0))
    configured_daily = mailbox.get("daily_limit", 50)
    adjusted["daily_limit"] = configured_daily if manual else min(configured_daily, policy["daily_limit"])
    configured_hourly = mailbox.get("hourly_limit", 10)
    adjusted["hourly_limit"] = configured_hourly if manual else min(configured_hourly, policy["hourly_limit"], adjusted["daily_limit"])
    configured_min_delay = mailbox.get("min_delay_seconds")
    configured_max_delay = mailbox.get("max_delay_seconds")
    min_delay = default_min_delay if configured_min_delay is None else int(configured_min_delay)
    max_delay = default_max_delay if configured_max_delay is None else int(configured_max_delay)
    min_delay = max(60, min(3600, min_delay))
    max_delay = max(min_delay, min(3600, max_delay))
    adjusted["effective_min_delay_seconds"] = min_delay if manual else max(min_delay, policy["min_delay_seconds"])
    # If the configured minimum exceeds the warmup ceiling, use that slower
    # minimum as both bounds; never shorten a configured minimum to fit warmup.
    adjusted["effective_max_delay_seconds"] = max(
        adjusted["effective_min_delay_seconds"],
        max_delay if manual else min(max_delay, policy["max_delay_seconds"]),
    )
    adjusted["warmup_info"] = policy
    return adjusted
