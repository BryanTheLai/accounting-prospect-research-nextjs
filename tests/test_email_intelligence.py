"""
Unit Tests for B2B Email Intelligence, Quality Hierarchy & Permutation Generator
Path: tests/test_email_intelligence.py
"""
import unittest
import email_intelligence as ei

class TestEmailIntelligence(unittest.TestCase):
    def test_tier_1_executive_and_personal_classification(self):
        """Verifies that personal decision makers and C-level aliases are tagged as Tier 1."""
        c1 = ei.classify_email("michael.tan@advancelab.com.sg", buyer_name="Michael Tan")
        self.assertEqual(c1["tier"], 1)
        self.assertFalse(c1["is_generic"])
        self.assertIn("Direct", c1["badge"])

        c2 = ei.classify_email("md@precision-sg.com", buyer_name="Managing Director")
        self.assertEqual(c2["tier"], 1)
        self.assertIn("Executive Role", c2["badge"])

        c3 = ei.classify_email("director@factory.com.my", buyer_name="John Doe")
        self.assertEqual(c3["tier"], 1)

    def test_tier_2_department_classification(self):
        """Verifies that HR, hiring, and finance inboxes are tagged as Tier 2."""
        c1 = ei.classify_email("hr@advancelab.com.my")
        self.assertEqual(c1["tier"], 2)
        self.assertFalse(c1["is_generic"])
        self.assertIn("HR / Hiring", c1["badge"])

        c2 = ei.classify_email("careers@techcorridor.com")
        self.assertEqual(c2["tier"], 2)

        c3 = ei.classify_email("finance@wholesaler.com.my")
        self.assertEqual(c3["tier"], 2)

    def test_tier_3_generic_classification(self):
        """Verifies that info@, admin@, and enquiry@ are flagged as Tier 3 generic catch-alls."""
        c1 = ei.classify_email("info@sengli.com.my")
        self.assertEqual(c1["tier"], 3)
        self.assertTrue(c1["is_generic"])
        self.assertIn("Generic Catch-All", c1["badge"])

        c2 = ei.classify_email("admin@company.com")
        self.assertEqual(c2["tier"], 3)
        self.assertTrue(c2["is_generic"])

        c3 = ei.classify_email("enquiry@transport.com")
        self.assertEqual(c3["tier"], 3)
        self.assertTrue(c3["is_generic"])

    def test_tier_4_system_classification(self):
        """Verifies that system, noreply, and billing addresses are Tier 4 low quality."""
        c1 = ei.classify_email("noreply@portal.com")
        self.assertEqual(c1["tier"], 4)
        self.assertTrue(c1["is_generic"])

        c2 = ei.classify_email("billing@saas.com")
        self.assertEqual(c2["tier"], 4)

    def test_email_permutations_generation(self):
        """Verifies generation of B2B email permutations from name and domain."""
        perms = ei.generate_email_permutations("Michael Tan", "advancelab.com.sg")
        emails = [p[0] for p in perms]
        
        self.assertIn("michael.tan@advancelab.com.sg", emails)
        self.assertIn("michael@advancelab.com.sg", emails)
        self.assertIn("mtan@advancelab.com.sg", emails)
        self.assertIn("md@advancelab.com.sg", emails)
        self.assertIn("hr@advancelab.com.sg", emails)

    def test_lead_email_analysis_recommendations(self):
        """Verifies that analyze_lead_email flags generic emails with upgrade recommendations."""
        generic_lead = {
            "company_name": "Advancelab Sdn Bhd",
            "contact_email": "info@advancelab.com.my",
            "buyer_name": "Michael Tan",
            "root_domain": "advancelab.com.my"
        }
        res = ei.analyze_lead_email(generic_lead)
        self.assertTrue(res["is_generic"])
        self.assertEqual(res["tier"], 3)
        self.assertTrue(len(res["permutations"]) > 0)
        self.assertTrue(any("generic catch-all" in rec.lower() for rec in res["recommendations"]))

if __name__ == "__main__":
    unittest.main()
