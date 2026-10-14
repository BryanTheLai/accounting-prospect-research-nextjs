"""
Email address preflight checks.

Checks address syntax and domain mail routing. It does not establish that an
individual mailbox exists or accepts mail; public-source evidence is separate.

Path: email_verifier.py
"""

from functools import lru_cache
from dataclasses import dataclass
from typing import Optional, List
import dns.resolver

@dataclass
class VerificationResult:
    email: str
    is_valid_syntax: bool
    has_mx_records: bool
    primary_mx: Optional[str]
    is_catch_all: Optional[bool]
    status_chip: str
    deliverability_score: int
    recommendation: str

class EmailVerifier:
    @staticmethod
    def check_syntax(email: str) -> bool:
        """RFC 5322 compliance and sanity check."""
        if not email or "@" not in email:
            return False
        parts = email.strip().split("@")
        if len(parts) != 2:
            return False
        local, domain = parts
        if not local or not domain or "." not in domain:
            return False
        if len(local) > 64 or len(domain) > 255:
            return False
        return True

    @staticmethod
    def resolve_mx_records(domain: str) -> List[str]:
        """Resolves and sorts MX hosts by priority. Fallback to A record per RFC 5321."""
        if not domain or "." not in domain:
            return []
        try:
            answers = dns.resolver.resolve(domain, "MX")
            records = sorted([(r.preference, str(r.exchange).rstrip(".")) for r in answers], key=lambda x: x[0])
            return [r[1] for r in records]
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.LifetimeTimeout):
            # Fallback to A record per RFC 5321
            try:
                dns.resolver.resolve(domain, "A")
                return [domain]
            except Exception:
                return []
        except Exception:
            return []

    def verify(self, email: str, is_scraped: bool = False, is_permutation: bool = False) -> VerificationResult:
        """
        Executes domain/address preflight checks only:
        1. Syntax
        2. Domain mail-routing records
        3. Evidence label; no mailbox-level verification is attempted
        """
        email_clean = email.strip().lower()

        # Step 1: Syntax check
        if not self.check_syntax(email_clean):
            return VerificationResult(
                email=email_clean,
                is_valid_syntax=False,
                has_mx_records=False,
                primary_mx=None,
                is_catch_all=None,
                status_chip="🔴 INVALID SYNTAX",
                deliverability_score=0,
                recommendation="Malformed email syntax. Blocked."
            )

        domain = email_clean.split("@")[1]

        # Step 2: DNS MX Resolution
        mx_hosts = self.resolve_mx_records(domain)
        if not mx_hosts:
            return VerificationResult(
                email=email_clean,
                is_valid_syntax=True,
                has_mx_records=False,
                primary_mx=None,
                is_catch_all=None,
                status_chip="🔴 NO MAIL ROUTE",
                deliverability_score=0,
                recommendation="Domain has no MX or A records. Non-operational mail domain."
            )

        primary_mx = mx_hosts[0]

        # Step 3: Describe the evidence without claiming mailbox existence.
        if is_scraped:
            chip = "🟢 PUBLIC EMAIL FOUND · MAILBOX UNVERIFIED"
            score = 60
            rec = "This address was found on a public company surface and its domain has mail routing. The mailbox itself has not been checked."
        elif not is_permutation:
            chip = "🟡 MAIL ROUTE PRESENT · SOURCE UNREVIEWED"
            score = 35
            rec = "The domain has mail routing. This does not verify the address or the source; confirm the exact address on a current company-published page."
        else:
            chip = "🔵 GENERATED CANDIDATE · MAILBOX UNVERIFIED"
            score = 15
            rec = "Generated address candidate. Domain mail routing does not verify this individual mailbox; confirm a public source before outreach."

        return VerificationResult(
            email=email_clean,
            is_valid_syntax=True,
            has_mx_records=True,
            primary_mx=primary_mx,
            is_catch_all=None,
            status_chip=chip,
            deliverability_score=score,
            recommendation=rec
        )

# Module-level convenience functions
def verify_email(email: str, is_scraped: bool = False, is_permutation: bool = False) -> VerificationResult:
    return EmailVerifier().verify(email, is_scraped=is_scraped, is_permutation=is_permutation)

@lru_cache(maxsize=1024)
def detect_domain_esp(email_or_domain: str) -> str:
    """
    Inspects DNS MX records to identify recipient ESP provider:
    - 'GOOGLE': Google Workspace / Gmail
    - 'MICROSOFT': Microsoft 365 / Exchange Online
    - 'OTHER': Custom MTA, Proofpoint, Mimecast, etc.
    - 'UNKNOWN': No MX found or lookup failure
    """
    if not email_or_domain:
        return "UNKNOWN"
    domain = email_or_domain.split("@")[-1].strip().lower()
    mx_records = EmailVerifier.resolve_mx_records(domain)
    if not mx_records:
        return "UNKNOWN"
    primary_mx = mx_records[0].lower()
    if any(k in primary_mx for k in ["google.com", "googlemail.com", "aspmx"]):
        return "GOOGLE"
    if any(k in primary_mx for k in ["outlook.com", "protection.outlook.com", "microsoft.com"]):
        return "MICROSOFT"
    return "OTHER"
