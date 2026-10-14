import unittest
from unittest.mock import patch

from email_verifier import EmailVerifier
from ingest_yc_pipeline import enrich_single_company


class TestEmailPreflightLabels(unittest.TestCase):
    @patch.object(EmailVerifier, "resolve_mx_records", return_value=["mx.example.test"])
    def test_public_source_does_not_claim_mailbox_exists(self, _mx):
        result = EmailVerifier().verify("founder@example.com", is_scraped=True)
        self.assertIn("MAILBOX UNVERIFIED", result.status_chip)
        self.assertIn("has not been checked", result.recommendation)

    @patch.object(EmailVerifier, "resolve_mx_records", return_value=["mx.example.test"])
    @patch("ingest_yc_pipeline.detect_domain_esp", return_value="GOOGLE")
    def test_yc_ingestion_does_not_invent_founder_address(self, _esp, _mx):
        row = enrich_single_company({
            "slug": "example-company",
            "name": "Example Company",
            "website": "https://example.com",
        }, scrape_founders=False)
        self.assertEqual(row["contact_email"], "")
        self.assertEqual(row["deliverability_score"], 0)
        self.assertEqual(row["primary_mx"], "mx.example.test")


if __name__ == "__main__":
    unittest.main()
