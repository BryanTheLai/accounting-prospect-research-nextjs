"""
Outbounder - Centralized Configuration
Manages all application settings, system paths, deliverability defaults,
rate limits, CRM lifecycle stages, and government shield rules.

Architecture Principle:
- .env strictly holds private secrets (passwords, tokens).
- config.py defines all deterministic settings, constants, and schema mappings.

Path: config.py
"""

import os
from pathlib import Path
from typing import List, Dict, Tuple, Set
from dotenv import load_dotenv

# Load secrets from .env if present
load_dotenv()

# ==============================================================================
# 1. SYSTEM PATHS & DIRECTORIES
# ==============================================================================
BASE_DIR: Path = Path(__file__).resolve().parent
DB_PATH: Path = Path(os.getenv("OUTBOUNDER_DB_PATH", str(BASE_DIR / "leads.db"))).expanduser().resolve()
ZONE_PATH: Path = BASE_DIR / "cloudflare_dns.zone"
JSON_PATH: Path = BASE_DIR / "cloudflare_dns_records.json"
MASTER_XLSX_PATH: Path = BASE_DIR / "master_leads.xlsx"
LOGOS_DIR: Path = BASE_DIR / "logos"
ASSETS_DIR: Path = BASE_DIR / "assets"
ARCHIVE_DIR: Path = BASE_DIR / "archive"

# ==============================================================================
# 2. CREDENTIALS & SECRETS (From .env Only)
# ==============================================================================
DEFAULT_SMTP_USER: str = os.getenv("SMTP_USER", "")
DEFAULT_SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
DEFAULT_SENDER_NAME: str = os.getenv("SENDER_NAME", "Bryan @ Outbounder")
PRIMARY_DOMAIN: str = os.getenv("PRIMARY_DOMAIN", "openclose-desk.com")

# ==============================================================================
# 3. SAFETY GATES & ENVIRONMENT FLAGS
# ==============================================================================
# Live dispatch is locked to False by default to prevent accidental outbound sending.
ENABLE_LIVE_DISPATCH_DEFAULT: bool = False
FILTER_GOVERNMENT_ENTITIES_DEFAULT: bool = True

def is_live_dispatch_enabled() -> bool:
    """Returns True if live outbound dispatch is active via environment flag."""
    val = os.getenv("ENABLE_LIVE_DISPATCH", str(ENABLE_LIVE_DISPATCH_DEFAULT)).strip().lower()
    return val in ("true", "1", "yes")

def set_live_dispatch_enabled(enabled: bool) -> None:
    """Dynamically updates live dispatch status in runtime environment."""
    os.environ["ENABLE_LIVE_DISPATCH"] = "true" if enabled else "false"


# ==============================================================================
# 4. NETWORK & DELIVERABILITY DEFAULTS
# ==============================================================================
# SMTP Transport
DEFAULT_SMTP_SERVER: str = "smtp.office365.com"
DEFAULT_SMTP_PORT: int = 587

# IMAP Transport
DEFAULT_IMAP_SERVER: str = "outlook.office365.com"
DEFAULT_IMAP_PORT: int = 993
DEFAULT_IMAP_TIMEOUT: float = 10.0

# Rate Limiting & Cooldowns
DOMAIN_COOLDOWN_HOURS: int = 48
CONSECUTIVE_DEFERRAL_CIRCUIT_BREAKER: int = 3

# ==============================================================================
# 5. 30-DAY WARMUP RAMP SCHEDULE
# ==============================================================================
WARMUP_RAMP_TIERS: List[Tuple[int, int, int, str, int, int]] = [
    # (max_day, daily_limit, hourly_limit, phase_name, min_delay_sec, max_delay_sec)
    (1,  5,  2, "Phase 1: Day 1 Micro-Warmup (Ultra-Safe)", 180, 360),
    (3,  7,  2, "Phase 2: Seeding & Verification", 150, 300),
    (7,  10, 3, "Phase 3: Conservative Ramp", 120, 240),
    (14, 15, 3, "Phase 4: Linear Scaling", 90, 210),
    (30, 20, 4, "Phase 5: Steady State", 90, 180),
    (999, 50, 10, "Phase 6: Mature Ceiling (Max 50/day)", 60, 150),
]

# ==============================================================================
# 6. CRM LIFECYCLE STAGES
# ==============================================================================
CRM_STAGES: List[str] = [
    "Ready to Review",
    "Approved for Outreach",
    "In Sequence (Smartlead)",
    "Replied (Warm)",
    "Discovery Call Booked",
    "Proposal Sent",
    "Closed Won (Retainer Signed)",
    "Discovery in progress",
    "Nurture / Follow-up",
    "Bounced / 550 Invalid",
    "Discarded / DNC"
]

# ==============================================================================
# 7. DATABASE SCHEMA & COLUMN MAPPINGS
# ==============================================================================
COLUMN_MAP: Dict[str, str] = {
    "company_name": "Company Name",
    "bro_summary": "Plain English Summary",
    "company_summary": "Technical Summary",
    "buyer_name": "Decision Maker",
    "buyer_title": "Title / Role",
    "contact_phone": "Phone",
    "contact_email": "Email",
    "proof_link": "Proof / Source",
    "phone_script": "Call Script",
    "sector": "Sector",
    "quality_score": "Score",
    "status": "Status",
    "malaysia_facility": "Malaysia Facility",
    "headquarters": "Headquarters",
    "root_domain": "Website",
    "estimated_transactions_mo": "Est. Volume",
    "accounting_software": "Software",
    "sg_my_wedge": "Arbitrage Wedge",
    "campaign_id": "Campaign",
    "lead_id": "Lead ID"
}

DEFAULT_COLUMNS: List[str] = [
    "Company Name",
    "Plain English Summary",
    "Decision Maker",
    "Title / Role",
    "Phone",
    "Email",
    "Sector",
    "Score",
    "Status"
]

ALL_FRIENDLY_COLUMNS: List[str] = list(COLUMN_MAP.values())
REVERSE_COLUMN_MAP: Dict[str, str] = {v: k for k, v in COLUMN_MAP.items()}

# ==============================================================================
# 8. DNSBL REPUTATION PROVIDERS
# ==============================================================================
DNSBL_SERVICES: List[Tuple[str, str]] = [
    ("zen.spamhaus.org", "Spamhaus ZEN (SBL/XBL/PBL)"),
    ("dbl.spamhaus.org", "Spamhaus Domain Blocklist (DBL)"),
    ("bl.spamcop.net", "SpamCop Blocking List"),
    ("b.barracudacentral.org", "Barracuda Reputation Network"),
]

# ==============================================================================
# 9. DISPOSABLE EMAIL DOMAINS & SENSITIVE ROLES
# ==============================================================================
DISPOSABLE_DOMAINS: Set[str] = {
    "mailinator.com", "guerrillamail.com", "tempmail.com", "temp-mail.org",
    "10minutemail.com", "yopmail.com", "trashmail.com", "sharklasers.com",
    "throwawaymail.com", "getairmail.com", "fakemailgenerator.com",
    "dispostable.com", "maildrop.cc", "inboxkitten.com"
}

SENSITIVE_ROLE_PREFIXES: Set[str] = {
    "abuse", "postmaster", "hostmaster", "security", "legal",
    "spam", "compliance", "privacy", "noc", "root"
}
