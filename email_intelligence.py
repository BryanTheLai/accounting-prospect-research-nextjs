"""
B2B Email Intelligence & Quality Hierarchy Engine
Analyzes, classifies, scores, and generates decision-maker email permutations.

Quality Hierarchy:
  - Tier 1 (Direct Personal Decision Maker): first.last@, first@, md@, director@, ceo@, owner@
  - Tier 2 (Department / Hiring Lead): hr@, careers@, recruitment@, finance@, accounts@
  - Tier 3 (Generic Corporate Inbox): info@, admin@, contact@, enquiry@, office@, sales@
  - Tier 4 (System / Low Quality): support@, billing@, noreply@, newsletter@

Path: email_intelligence.py
"""

import re
from typing import Dict, List, Any, Optional, Tuple

TIER_1_ROLES = {
    "md", "director", "managing.director", "ceo", "cfo", "coo", "cto",
    "founder", "owner", "partner", "principal", "general.manager", "gm"
}

TIER_2_ROLES = {
    "hr", "careers", "recruitment", "jobs", "talent", "hiring",
    "humanresources", "human.resources", "finance", "accounts",
    "accounting", "account", "acc"
}

TIER_3_GENERIC = {
    "info", "admin", "contact", "enquiry", "enquiries", "general",
    "mail", "office", "sales", "marketing", "customer", "customercare",
    "reception", "desk", "inquiry", "inquiries"
}

TIER_4_LOW_QUALITY = {
    "support", "billing", "help", "noreply", "no-reply", "donotreply",
    "newsletter", "alerts", "notifications", "service", "ticketing", "webmaster"
}

HONORIFICS = {
    "mr", "mr.", "ms", "ms.", "mrs", "mrs.", "dr", "dr.", "dato", "datuk",
    "tan sri", "puan", "encik", "ts.", "ir.", "prof", "prof."
}

def clean_name_tokens(full_name: str) -> List[str]:
    """Cleans a name and extracts alpha tokens, stripping honorifics and job titles."""
    if not full_name:
        return []
    
    # Strip parentheses and common titles like (Director)
    name_clean = re.sub(r"\(.*?\)", "", full_name)
    name_clean = re.sub(r"[/\\].*", "", name_clean)
    words = re.findall(r"[A-Za-z]+", name_clean.lower())
    
    tokens = [w for w in words if w not in HONORIFICS and len(w) > 1]
    return tokens

def classify_email(email_address: str, buyer_name: str = "") -> Dict[str, Any]:
    """
    Classifies an email address into quality tier, badge, and descriptive rationale.
    """
    if not email_address or "@" not in email_address:
        return {
            "tier": 4,
            "tier_name": "INVALID",
            "badge": "🔴 Invalid Email",
            "score": 0,
            "is_generic": True,
            "local_part": "",
            "domain": "",
            "reason": "Missing or malformed email address."
        }

    email_clean = email_address.strip().lower()
    local_part, domain = email_clean.split("@", 1)
    norm_local = local_part.replace(".", "").replace("-", "").replace("_", "")

    # 1. Check if matches Tier 4 (System / Low quality)
    if local_part in TIER_4_LOW_QUALITY or any(local_part.startswith(prefix) for prefix in ("noreply", "support", "billing")):
        return {
            "tier": 4,
            "tier_name": "TIER_4_SYSTEM",
            "badge": "🔴 Low Quality / System",
            "score": 20,
            "is_generic": True,
            "local_part": local_part,
            "domain": domain,
            "reason": f"System/support address ({local_part}@). Low reply rate."
        }

    # 2. Check if matches Tier 1 Role Aliases (MD, Director, CEO)
    if local_part in TIER_1_ROLES:
        return {
            "tier": 1,
            "tier_name": "TIER_1_EXECUTIVE",
            "badge": "🟢 Direct (Executive Role)",
            "score": 95,
            "is_generic": False,
            "local_part": local_part,
            "domain": domain,
            "reason": f"Direct executive role mailbox ({local_part}@)."
        }

    # 3. Check if matches Tier 2 Department (HR / Hiring / Finance)
    if local_part in TIER_2_ROLES or any(local_part.startswith(prefix) for prefix in ("hr", "career", "recruit", "finance", "account")):
        return {
            "tier": 2,
            "tier_name": "TIER_2_DEPARTMENT",
            "badge": "🔵 HR / Hiring Lead",
            "score": 85,
            "is_generic": False,
            "local_part": local_part,
            "domain": domain,
            "reason": f"Departmental hiring/finance mailbox ({local_part}@). Ideal for recruitment reverse-pitch."
        }

    # 4. Check if matches Tier 3 Generic (info@, admin@, etc.)
    if local_part in TIER_3_GENERIC:
        return {
            "tier": 3,
            "tier_name": "TIER_3_GENERIC",
            "badge": "🟡 Generic Catch-All (info@)",
            "score": 50,
            "is_generic": True,
            "local_part": local_part,
            "domain": domain,
            "reason": f"Generic catch-all inbox ({local_part}@). Gatekeeper triage risk."
        }

    # 5. Check if local_part matches buyer_name tokens (Personal Address)
    name_tokens = clean_name_tokens(buyer_name)
    if name_tokens:
        first = name_tokens[0]
        last = name_tokens[-1] if len(name_tokens) > 1 else ""
        if (first and first in norm_local) or (last and last in norm_local) or ("." in local_part):
            return {
                "tier": 1,
                "tier_name": "TIER_1_PERSONAL",
                "badge": "🟢 Direct Personal (Named)",
                "score": 100,
                "is_generic": False,
                "local_part": local_part,
                "domain": domain,
                "reason": f"Personal decision maker email ({local_part}@) matching '{buyer_name}'."
            }

    # If it's a named pattern (e.g. has dot, or doesn't match generic dictionary)
    if "." in local_part or "_" in local_part:
        return {
            "tier": 1,
            "tier_name": "TIER_1_NAMED",
            "badge": "🟢 Direct (Named Person)",
            "score": 90,
            "is_generic": False,
            "local_part": local_part,
            "domain": domain,
            "reason": f"Personal name pattern ({local_part}@)."
        }

    # Fallback default: unknown individual or small mailbox
    return {
        "tier": 2,
        "tier_name": "TIER_2_UNKNOWN_INDIVIDUAL",
        "badge": "🔵 Custom Mailbox",
        "score": 75,
        "is_generic": False,
        "local_part": local_part,
        "domain": domain,
        "reason": f"Dedicated mailbox ({local_part}@)."
    }

def generate_email_permutations(buyer_name: str, domain: str) -> List[Tuple[str, str]]:
    """
    Generates high-probability B2B decision-maker and departmental email permutations.
    Returns list of tuples: (email_address, description).
    """
    if not domain or "." not in domain:
        return []

    domain = domain.strip().lower()
    if "@" in domain:
        domain = domain.split("@", 1)[1]

    tokens = clean_name_tokens(buyer_name)
    perms: List[Tuple[str, str]] = []

    if tokens:
        first = tokens[0]
        last = tokens[-1] if len(tokens) > 1 else ""

        if first and last:
            perms.append((f"{first}.{last}@{domain}", f"First.Last ({first}.{last})"))
            perms.append((f"{first}@{domain}", f"First Name ({first})"))
            perms.append((f"{first[0]}{last}@{domain}", f"Initial + Last ({first[0]}{last})"))
            perms.append((f"{first}_{last}@{domain}", f"First_Last ({first}_{last})"))
            perms.append((f"{last}.{first}@{domain}", f"Last.First ({last}.{first})"))
        elif first:
            perms.append((f"{first}@{domain}", f"First Name ({first})"))
            perms.append((f"{first}.tan@{domain}" if "tan" not in first else f"{first}.lee@{domain}", "First.Surname"))

    # Executive & Departmental Role Aliases
    perms.append((f"md@{domain}", "Managing Director (md@)"))
    perms.append((f"director@{domain}", "Executive Director (director@)"))
    perms.append((f"hr@{domain}", "HR / Hiring Lead (hr@)"))
    perms.append((f"careers@{domain}", "Careers / Recruitment (careers@)"))
    perms.append((f"finance@{domain}", "Finance Department (finance@)"))

    # Deduplicate while preserving order
    seen = set()
    unique_perms = []
    for em, desc in perms:
        if em not in seen:
            seen.add(em)
            unique_perms.append((em, desc))

    return unique_perms

def analyze_lead_email(lead: Dict[str, Any]) -> Dict[str, Any]:
    """
    Complete audit of a lead's email contact info.
    Returns tier, badge, suggested upgrades if generic, and recommendations.
    """
    contact_email = str(lead.get("contact_email") or "").strip()
    buyer_name = str(lead.get("buyer_name") or "").strip()
    root_domain = str(lead.get("root_domain") or "").strip()

    classification = classify_email(contact_email, buyer_name=buyer_name)
    domain_to_use = classification["domain"] or root_domain

    permutations = generate_email_permutations(buyer_name, domain_to_use)

    recommendations = []
    if classification["is_generic"]:
        recommendations.append(f"Current address ({contact_email}) is a generic catch-all.")
        if permutations:
            best_direct = permutations[0][0]
            recommendations.append(f"Recommended upgrade: Try direct contact '{best_direct}' or HR '{domain_to_use}' for hiring pitches.")
    elif classification["tier"] == 1:
        recommendations.append("High quality personal/decision-maker address. Maximum inbox reach.")
    elif classification["tier"] == 2:
        recommendations.append("Departmental / HR address. Highly responsive to recruitment and operational pitches.")

    return {
        **classification,
        "permutations": permutations,
        "recommendations": recommendations
    }
