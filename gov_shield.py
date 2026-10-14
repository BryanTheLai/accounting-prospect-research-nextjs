"""
Government & Public-Sector Entity Shield (Gov-Shield)
Detects and enforces a strict block on any government bodies, ministries,
statutory boards, municipal councils (Majlis), GLCs, and military/educational entities
across Malaysia and Singapore.

Path: gov_shield.py
"""

import re
from typing import Tuple, Dict, Any, Optional

# Blocked TLDs and domain patterns
GOV_TLD_PATTERNS = [
    r"\.gov(\.[a-z]{2})?$",      # .gov, .gov.my, .gov.sg
    r"\.mil(\.[a-z]{2})?$",      # .mil, .mil.my
    r"\.edu(\.[a-z]{2})?$",      # .edu, .edu.my, .edu.sg
    r"\.ac\.[a-z]{2}$",          # .ac.uk, .ac.id
    r"\.gc\.ca$",
]

# Specific Government & Public Authority Keywords
# Case-insensitive substring matching against company name and summary
GOV_KEYWORDS_MALAYSIA = [
    # Federal / Ministries / Agencies
    "kementerian", "ministry of", "jabatan", "department of",
    "pejabat", "suruhanjaya", "commission of", "lembaga", "board of",
    "perbadanan", "corporation of", "dewan bahasa", "kastam", "customs",
    "lhdn", "hasil dalam negeri", "kwsp", "epf", "perkeso", "socso",
    "polis", "police", "tentera", "military", "angkatan tentera",
    # Statutory Boards & Development Authorities
    "mida", "matrade", "seda", "mcmc", "skmm", "ssm", "companies commission",
    "irda", "iskandar regional development", "jcorp", "johor corporation",
    "mara", "felda", "felcra", "risda", "fama", "bernama",
    # Local Municipal Councils (Pihak Berkuasa Tempatan)
    "majlis perbandaran", "majlis bandaraya", "majlis daerah",
    "mbjb", "mbip", "mpku", "mpbp", "mppg", "dbkl", "mbpj", "mbsa",
    "dewan bandaraya", "pihak berkuasa tempatan", "pbt",
    # Malaysian Federal GLCs / Sovereign Wealth
    "khazanah", "petronas", "tenaga nasional", "telekom malaysia",
    "prasarana", "keretapi tanah melayu", "ktmb", "pos malaysia",
    "syabas", "air selangor", "saj ranhill", "indah water"
]

GOV_KEYWORDS_SINGAPORE = [
    # Singapore Statutory Boards & Agencies
    "statutory board", "govtech", "jtc corporation", "edb", "economic development board",
    "mas", "monetary authority of singapore", "iras", "inland revenue",
    "cpf board", "central provident fund", "hdb", "housing & development board",
    "sla", "singapore land authority", "lta", "land transport authority",
    "nea", "national environment agency", "public utilities board", "pub singapore", "singapore's national water agency",
    "ura", "urban redevelopment authority", "enterprise singapore",
    "temasek holdings", "gic private", "singhealth", "national healthcare group"
]

ALL_GOV_KEYWORDS = GOV_KEYWORDS_MALAYSIA + GOV_KEYWORDS_SINGAPORE

def is_government_domain(domain: str) -> Tuple[bool, Optional[str]]:
    """Checks if domain matches government, military, or education TLD patterns."""
    if not domain:
        return False, None
    clean_dom = domain.lower().strip().replace("http://", "").replace("https://", "").split("/")[0]
    for pat in GOV_TLD_PATTERNS:
        if re.search(pat, clean_dom):
            return True, f"Domain matches restricted TLD pattern: '{clean_dom}'"
    return False, None

def is_government_affiliated(
    company_name: str,
    root_domain: str = "",
    contact_email: str = "",
    summary: str = ""
) -> Tuple[bool, str]:
    """
    Evaluates whether an entity is government-affiliated, a public authority,
    a municipal council, an educational body, or a state-owned enterprise (GLC).

    Returns:
        (is_gov: bool, reason: str)
    """
    # 1. Check root domain and email domain
    for d in [root_domain, contact_email.split("@")[-1] if "@" in contact_email else ""]:
        is_gov, reason = is_government_domain(d)
        if is_gov:
            return True, f"⛔ GOV SHIELD: {reason}"

    # 2. Check Company Name
    comp_clean = company_name.lower().strip()
    for kw in ALL_GOV_KEYWORDS:
        # Match whole words or exact boundary (prevents substring matching like 'edb' inside 'LanceDB' or 'epf' inside 'Stepful')
        pattern = rf"\b{re.escape(kw.lower())}\b"
        if re.search(pattern, comp_clean):
            return True, f"⛔ GOV SHIELD: Matched public-sector keyword '{kw}' in company name"

    # 3. Check Summary / Description
    if summary:
        sum_clean = summary.lower()
        for kw in ["ministry", "statutory board", "municipal council", "government-linked", "agency under the ministry"]:
            if kw in sum_clean:
                return True, f"⛔ GOV SHIELD: Matched government affiliation '{kw}' in summary"

    return False, "✅ PRIVATE SME (Clear for research)"

def filter_leads_for_government(leads: list) -> Tuple[list, list]:
    """
    Separates a list of lead dictionaries into (clean_private_leads, blocked_gov_leads).
    """
    clean = []
    blocked = []
    for lead in leads:
        comp = lead.get("company_name", "")
        dom = lead.get("root_domain", "")
        em = lead.get("contact_email", "")
        summ = lead.get("company_summary", "") or lead.get("bro_summary", "")
        
        is_gov, reason = is_government_affiliated(comp, dom, em, summ)
        if is_gov:
            lead_copy = dict(lead)
            lead_copy["gov_shield_reason"] = reason
            blocked.append(lead_copy)
        else:
            clean.append(lead)
    return clean, blocked
