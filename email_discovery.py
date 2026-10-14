"""
Zero-Cost Email Discovery Engine for Outbounder
Crawls company website contact hubs, decodes Cloudflare protected emails,
and extracts real recruiter/HR emails from active job postings without third-party fees.

Path: email_discovery.py
"""

import re
from typing import List, Set, Dict, Any, Optional
from urllib.parse import urljoin, urlparse
import requests

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
MAILTO_REGEX = re.compile(r'href=["\']mailto:([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)["\']', re.IGNORECASE)
CF_EMAIL_REGEX = re.compile(r'data-cfemail=["\']([0-9a-fA-F]+)["\']')

class DomainEmailCrawler:
    """Crawls company website contact hubs to extract real emails without third-party fees."""

    COMMON_PATHS = [
        "",  # Homepage
        "/contact",
        "/contact-us",
        "/contactus",
        "/about",
        "/about-us",
        "/our-team",
        "/team",
        "/management",
        "/careers",
        "/jobs",
    ]

    def __init__(self, root_domain: str, timeout: int = 4):
        self.root_domain = root_domain.strip().lower().replace("http://", "").replace("https://", "").strip("/")
        if self.root_domain.startswith("www."):
            self.root_domain = self.root_domain[4:]
        self.base_url = f"https://{self.root_domain}"
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    @staticmethod
    def decode_cloudflare_email(cf_hex: str) -> Optional[str]:
        """Decodes Cloudflare email protection XOR cipher."""
        try:
            key = int(cf_hex[:2], 16)
            chars = [chr(int(cf_hex[i:i+2], 16) ^ key) for i in range(2, len(cf_hex), 2)]
            return "".join(chars)
        except Exception:
            return None

    def _extract_emails_from_html(self, html: str) -> Set[str]:
        """Extracts emails from mailto tags, raw text, and Cloudflare protected elements."""
        found: Set[str] = set()

        # 1. Mailto links
        for mailto in MAILTO_REGEX.findall(html):
            clean = mailto.split("?")[0].strip().lower()
            if self._is_target_domain_email(clean):
                found.add(clean)

        # 2. Cloudflare protected emails
        for cf_hex in CF_EMAIL_REGEX.findall(html):
            decoded = self.decode_cloudflare_email(cf_hex)
            if decoded and self._is_target_domain_email(decoded):
                found.add(decoded.lower())

        # 3. Raw text regex
        for email in EMAIL_REGEX.findall(html):
            clean = email.strip().lower().rstrip(".")
            if self._is_target_domain_email(clean):
                found.add(clean)

        return found

    def _is_target_domain_email(self, email: str) -> bool:
        """Ensures email belongs to target domain or its subdomains."""
        if "@" not in email:
            return False
        _, domain = email.split("@", 1)
        domain = domain.lower()
        # Accept domain or subdomains (e.g. mail.domain.com or domain.com.my)
        root_base = self.root_domain.split(".")[0]
        return domain == self.root_domain or domain.endswith("." + self.root_domain) or root_base in domain

    def crawl_and_discover(self) -> Dict[str, Any]:
        """
        Executes targeted crawl of high-probability pages.
        Returns discovered emails grouped by source path.
        """
        if not self.root_domain or "." not in self.root_domain:
            return {
                "root_domain": self.root_domain,
                "emails_found": [],
                "pages_crawled": 0,
                "status": "INVALID_DOMAIN",
                "errors": ["Domain is missing or invalid."]
            }

        discovered_emails: Set[str] = set()
        visited_pages: List[str] = []
        errors: List[str] = []

        for path in self.COMMON_PATHS:
            target_url = f"https://{self.root_domain}{path}"
            try:
                resp = self.session.get(target_url, timeout=self.timeout, allow_redirects=True)
                if resp.status_code == 200 and resp.text:
                    visited_pages.append(target_url)
                    emails_on_page = self._extract_emails_from_html(resp.text)
                    discovered_emails.update(emails_on_page)
                    # If high-priority hiring or personal addresses found, stop early to minimize latency
                    if any(e.startswith(("hr@", "careers@", "recruitment@", "md@")) for e in discovered_emails):
                        break
            except requests.exceptions.SSLError:
                # Fallback to HTTP if SSL fails
                try:
                    target_url_http = f"http://{self.root_domain}{path}"
                    resp = self.session.get(target_url_http, timeout=self.timeout, allow_redirects=True)
                    if resp.status_code == 200:
                        visited_pages.append(target_url_http)
                        discovered_emails.update(self._extract_emails_from_html(resp.text))
                except Exception as e:
                    errors.append(f"{target_url}: {type(e).__name__}")
            except Exception as e:
                errors.append(f"{target_url}: {type(e).__name__}")

        return {
            "root_domain": self.root_domain,
            "emails_found": sorted(list(discovered_emails)),
            "pages_crawled": len(visited_pages),
            "status": "SUCCESS" if discovered_emails else "NO_EMAILS_FOUND",
            "errors": errors[:3]
        }


def extract_emails_from_job_posting(proof_url: str, timeout: int = 4) -> List[str]:
    """Extracts direct recruiter/HR contact emails from a JobStreet / Indeed / careers posting."""
    if not proof_url or not str(proof_url).startswith("http"):
        return []
    try:
        resp = requests.get(proof_url, headers=HEADERS, timeout=timeout)
        if resp.status_code == 200:
            found = EMAIL_REGEX.findall(resp.text)
            # Filter out portal system emails like apply@jobstreet.com or noreply@
            filtered = [
                e.lower().rstrip(".") for e in found
                if not any(portal in e.lower() for portal in ["jobstreet", "indeed", "ricebowl", "maukerja", "google", "w3.org", "sentry"])
            ]
            return sorted(list(set(filtered)))
    except Exception:
        pass
    return []

def discover_emails_for_lead(lead: Dict[str, Any]) -> Dict[str, Any]:
    """
    Combines website crawling and job listing proof link scraping for a specific lead.
    """
    root_domain = lead.get("root_domain") or ""
    proof_link = lead.get("proof_link") or ""

    website_results = DomainEmailCrawler(root_domain).crawl_and_discover() if root_domain else {"emails_found": []}
    job_emails = extract_emails_from_job_posting(proof_link) if proof_link else []

    all_emails = set(website_results.get("emails_found", []))
    all_emails.update(job_emails)

    return {
        "lead_id": lead.get("lead_id"),
        "company_name": lead.get("company_name"),
        "root_domain": root_domain,
        "website_emails": website_results.get("emails_found", []),
        "job_posting_emails": job_emails,
        "all_discovered": sorted(list(all_emails)),
        "pages_crawled": website_results.get("pages_crawled", 0)
    }
