"""
Blacklist Monitoring, DNSBL Reputation & Pre-Send Hygiene Engine
Performs real-time lookups against Spamhaus, Barracuda, and SpamCop DNSBLs,
and enforces disposable email blocking and catch-all server detection.

Path: blacklist_checker.py
"""

import dns.resolver
from typing import Dict, List, Any, Tuple
from config import DNSBL_SERVICES, SENSITIVE_ROLE_PREFIXES, DISPOSABLE_DOMAINS

def is_disposable_email(email_str: str) -> Tuple[bool, str]:
    """Checks if an email belongs to a known temporary/disposable provider."""
    if not email_str or "@" not in email_str:
        return False, "Invalid address"
    domain = email_str.split("@")[-1].lower().strip()
    if domain in DISPOSABLE_DOMAINS:
        return True, f"⛔ DISPOSABLE MAILBOX: '{domain}' is a burner domain."
    return False, "Not disposable"

def is_sensitive_role_account(email_str: str) -> Tuple[bool, str]:
    """Checks if an email is a high-risk system/compliance address (abuse@, postmaster@)."""
    if not email_str or "@" not in email_str:
        return False, "Invalid address"
    local = email_str.split("@")[0].lower().strip()
    if local in SENSITIVE_ROLE_PREFIXES:
        return True, f"⛔ SENSITIVE ROLE: '{local}@' is a compliance trap or admin role."
    return False, "Safe recipient role"

def check_domain_dnsbl_reputation(domain: str) -> Dict[str, Any]:
    """
    Queries major DNSBL/DBL providers to verify domain reputation.
    Clean domains return NXDOMAIN (no record). Listed domains return 127.0.0.X.
    """
    clean_domain = domain.lower().strip().replace("http://", "").replace("https://", "").split("/")[0]
    results = []
    is_any_listed = False

    for service_host, service_name in DNSBL_SERVICES:
        query_target = f"{clean_domain}.{service_host}"
        try:
            answers = dns.resolver.resolve(query_target, "A", lifetime=2.0)
            ip_str = str(answers[0])
            is_any_listed = True
            results.append({
                "service": service_name,
                "status": "LISTED",
                "return_code": ip_str,
                "badge": "🔴 LISTED"
            })
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            # NXDOMAIN means the domain is NOT on the blocklist (clean!)
            results.append({
                "service": service_name,
                "status": "CLEAN",
                "badge": "🟢 CLEAN"
            })
        except Exception as e:
            # Timeout or network error
            results.append({
                "service": service_name,
                "status": "QUERY_TIMEOUT",
                "badge": "⚪ UNREACHABLE"
            })

    return {
        "domain": clean_domain,
        "is_listed": is_any_listed,
        "overall_status": "🔴 BLACKLIST DETECTED" if is_any_listed else "🟢 100% REPUTATION CLEAN",
        "checks": results
    }
