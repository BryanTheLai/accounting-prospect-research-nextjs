"""
Unit Tests for Zero-Cost Email Discovery and Pre-Flight Verification Engines
Path: tests/test_email_discovery.py
"""
import unittest
from unittest.mock import patch, MagicMock
from email_discovery import DomainEmailCrawler, extract_emails_from_job_posting, discover_emails_for_lead
from email_verifier import EmailVerifier, VerificationResult

class TestEmailDiscoveryAndVerification(unittest.TestCase):

    def test_cloudflare_email_xor_deobfuscation(self):
        """Verifies decoding of Cloudflare data-cfemail XOR-encoded strings."""
        # Encode 'recruiter@openclose-desk.com' with key 0x2b
        key = 0x2b
        plaintext = "recruiter@openclose-desk.com"
        cf_hex = f"{key:02x}" + "".join([f"{ord(c) ^ key:02x}" for c in plaintext])

        decoded = DomainEmailCrawler.decode_cloudflare_email(cf_hex)
        self.assertEqual(decoded, plaintext)

        # Invalid hex returns None
        self.assertIsNone(DomainEmailCrawler.decode_cloudflare_email("invalid_hex_string"))

    def test_html_email_extraction_including_mailto_and_cloudflare(self):
        """Verifies extraction of mailto, plaintext, and Cloudflare obfuscated emails from HTML."""
        crawler = DomainEmailCrawler("example.com")
        
        # Obfuscate 'cf-contact@example.com' with key 0x3a
        key = 0x3a
        plaintext = "cf-contact@example.com"
        cf_hex = f"{key:02x}" + "".join([f"{ord(c) ^ key:02x}" for c in plaintext])

        sample_html = f"""
        <html>
            <body>
                <h1>Contact Us</h1>
                <p>Reach out directly to <a href="mailto:hr@example.com">Our HR Team</a></p>
                <p>General inquiries: office@example.com</p>
                <p>Protected: <span class="__cf_email__" data-cfemail="{cf_hex}">[email protected]</span></p>
                <!-- Outside domain email should also be filtered or accepted -->
                <p>Support from partner: agent@externalpartner.com</p>
            </body>
        </html>
        """
        emails = crawler._extract_emails_from_html(sample_html)
        self.assertIn("hr@example.com", emails)
        self.assertIn("office@example.com", emails)
        self.assertIn("cf-contact@example.com", emails)

    @patch("requests.get")
    def test_job_posting_email_extraction_filters_portal_inboxes(self, mock_get):
        """Verifies extraction of recruiter emails from job postings while excluding job board system emails."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = """
        Job Title: Accounts Assistant
        Requirements: Full set accounts, LCCI.
        To apply: Please submit resume to talent.acquisition@synergycorp.com.my
        Do not reply to notifications@jobstreet.com or support@indeed.com
        """
        mock_get.return_value = mock_resp

        extracted = extract_emails_from_job_posting("https://www.jobstreet.com.my/job/123456")
        self.assertIn("talent.acquisition@synergycorp.com.my", extracted)
        self.assertNotIn("notifications@jobstreet.com", extracted)
        self.assertNotIn("support@indeed.com", extracted)

    def test_email_verifier_syntax_validation(self):
        """Verifies RFC 5322 email syntax validation."""
        self.assertTrue(EmailVerifier.check_syntax("john.doe@company.com"))
        self.assertTrue(EmailVerifier.check_syntax("hr+hiring@subsidiary.co.uk"))
        self.assertFalse(EmailVerifier.check_syntax("plainaddress"))
        self.assertFalse(EmailVerifier.check_syntax("@missingusername.com"))
        self.assertFalse(EmailVerifier.check_syntax("username@nodot"))
        self.assertFalse(EmailVerifier.check_syntax(""))

    def test_email_verifier_mx_resolution_real_domain(self):
        """Verifies real DNS MX resolution on standard internet domain."""
        mx_hosts = EmailVerifier.resolve_mx_records("google.com")
        self.assertTrue(len(mx_hosts) > 0)
        self.assertTrue(any("google" in host.lower() for host in mx_hosts))

    def test_email_verifier_nonexistent_domain(self):
        """Verifies that non-existent domains return empty MX lists and invalid status."""
        verifier = EmailVerifier()
        res = verifier.verify("fake_user_12345@nonexistent-domain-xyz-never-registered-999.com")
        self.assertFalse(res.has_mx_records)
        self.assertEqual(res.deliverability_score, 0)
        self.assertIn("NO MAIL ROUTE", res.status_chip)

    @patch("email_discovery.DomainEmailCrawler.crawl_and_discover")
    @patch("email_discovery.extract_emails_from_job_posting")
    def test_discover_emails_for_lead_orchestration(self, mock_job, mock_crawler):
        """Verifies lead-level orchestration of website crawl and job posting extraction."""
        mock_crawler.return_value = {
            "emails_found": ["finance@megafab.com.my"],
            "pages_crawled": 3
        }
        mock_job.return_value = ["hr@megafab.com.my"]

        lead = {
            "lead_id": 99,
            "company_name": "MegaFab Sdn Bhd",
            "root_domain": "megafab.com.my",
            "proof_link": "https://jobstreet.com.my/job/99"
        }
        res = discover_emails_for_lead(lead)
        self.assertEqual(res["lead_id"], 99)
        self.assertIn("finance@megafab.com.my", res["all_discovered"])
        self.assertIn("hr@megafab.com.my", res["all_discovered"])
        self.assertEqual(res["pages_crawled"], 3)

if __name__ == "__main__":
    unittest.main()
