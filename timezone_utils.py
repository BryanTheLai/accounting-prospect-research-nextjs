"""
Time Zone & Business Hours Calculator for Outbound Telephony
Path: timezone_utils.py
"""
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Dict, Any

def normalize_phone_e164(phone: str, default_country: str = "MY") -> str:
    """
    Normalizes raw telephone numbers to strict international E.164 format.
    Example:
        '012-345 6789', default='MY' -> '+60123456789'
        '(415) 555-0199', default='US' -> '+14155550199'
        '6591234567', default='SG' -> '+6591234567'
    """
    if not phone or not phone.strip():
        return ""
    clean = re.sub(r"[^\d+]", "", phone.strip())
    if clean.startswith("+"):
        return clean
    if default_country == "SG":
        if len(clean) == 8:
            return f"+65{clean}"
    elif default_country == "MY":
        if clean.startswith("0"):
            return f"+60{clean[1:]}"
        elif clean.startswith("60"):
            return f"+{clean}"
    elif default_country == "US":
        if len(clean) == 10:
            return f"+1{clean}"
        elif clean.startswith("1") and len(clean) == 11:
            return f"+{clean}"
    return f"+{clean}"

def evaluate_lead_timezone(hq_location: str, facility_location: str = "") -> Dict[str, Any]:
    """
    Evaluates local time zone and determines whether the current moment is
    within acceptable B2B calling hours (09:00 - 17:30 local time, Mon-Fri).
    """
    loc = f"{hq_location or ''} {facility_location or ''}".lower()
    
    # Regional classification
    if any(k in loc for k in ["california", "san francisco", "palo alto", "seattle", "los angeles", "silicon valley", "bay area"]):
        tz_name = "America/Los_Angeles"
        label = "US Pacific (PT)"
    elif any(k in loc for k in ["new york", "boston", "miami", "atlanta", "charlotte", "philadelphia", "brooklyn"]):
        tz_name = "America/New_York"
        label = "US Eastern (ET)"
    elif any(k in loc for k in ["chicago", "austin", "dallas", "houston"]):
        tz_name = "America/Chicago"
        label = "US Central (CT)"
    elif any(k in loc for k in ["united states", "remote", "delaware", "us"]):
        tz_name = "America/Los_Angeles"
        label = "US Pacific (PT / YC)"
    elif "singapore" in loc:
        tz_name = "Asia/Singapore"
        label = "Singapore (SGT)"
    else:
        tz_name = "Asia/Kuala_Lumpur"
        label = "Malaysia (MYT)"

    local_dt = datetime.now(ZoneInfo(tz_name))
    hour = local_dt.hour
    weekday = local_dt.weekday()  # 0 = Monday, 6 = Sunday

    # Evaluation gates
    if weekday >= 5:
        is_safe = False
        badge_text = f"🔴 WEEKEND ({local_dt.strftime('%A')} - DO NOT CALL)"
        bg_color = "#7f1d1d"
        border_color = "#ef4444"
        greeting = "Good day"
    elif hour < 9:
        is_safe = False
        badge_text = f"🔴 TOO EARLY ({local_dt.strftime('%I:%M %p')} - DO NOT CALL)"
        bg_color = "#7f1d1d"
        border_color = "#ef4444"
        greeting = "Good morning"
    elif hour >= 18:
        is_safe = False
        badge_text = f"🔴 AFTER HOURS ({local_dt.strftime('%I:%M %p')} - CLOSED)"
        bg_color = "#7f1d1d"
        border_color = "#ef4444"
        greeting = "Good evening"
    elif 12 <= hour < 13:
        is_safe = True
        badge_text = f"🟡 LUNCH BREAK ({local_dt.strftime('%I:%M %p')} - CAUTION)"
        bg_color = "#78350f"
        border_color = "#f59e0b"
        greeting = "Good afternoon"
    elif (9 <= hour < 11 and local_dt.minute >= 30) or (15 <= hour < 17):
        is_safe = True
        badge_text = f"🟢 PRIME CALL WINDOW ({local_dt.strftime('%I:%M %p')} - OPTIMAL)"
        bg_color = "#064e3b"
        border_color = "#10b981"
        greeting = "Good morning" if hour < 12 else "Good afternoon"
    else:
        is_safe = True
        badge_text = f"🟢 BUSINESS HOURS ({local_dt.strftime('%I:%M %p')} - SAFE)"
        bg_color = "#064e3b"
        border_color = "#10b981"
        greeting = "Good morning" if hour < 12 else "Good afternoon"

    return {
        "timezone_name": tz_name,
        "label": label,
        "local_time_str": local_dt.strftime("%I:%M %p %Z"),
        "is_safe": is_safe,
        "badge_text": badge_text,
        "bg_color": bg_color,
        "border_color": border_color,
        "time_greeting": greeting
    }
