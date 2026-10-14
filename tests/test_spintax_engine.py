"""
Unit Tests for Spintax Parsing & Template Rendering Engine
Path: tests/test_spintax_engine.py
"""
import unittest
from spintax_engine import (
    parse_spintax,
    validate_spintax,
    render_email_template,
    SpintaxSyntaxError,
    CAMPAIGN_ANGLES
)

class TestSpintaxEngine(unittest.TestCase):
    def test_basic_spintax_resolution(self):
        """Ensures simple {A|B|C} resolves to one of the options."""
        pattern = "{Hi|Hello|Hey}"
        options = {"Hi", "Hello", "Hey"}
        results = {parse_spintax(pattern) for _ in range(30)}
        self.assertTrue(results.issubset(options))
        self.assertGreater(len(results), 1, "Should exhibit random variation across multiple runs")

    def test_nested_spintax(self):
        """Ensures nested spintax like {Hi|{Hello|Hey}} resolves cleanly without curly braces."""
        pattern = "{Good morning|{Hello|Hey}} there"
        valid_prefixes = ["Good morning there", "Hello there", "Hey there"]
        for _ in range(30):
            res = parse_spintax(pattern)
            self.assertIn(res, valid_prefixes)
            self.assertNotIn("{", res)
            self.assertNotIn("}", res)

    def test_syntax_validation_catches_unbalanced_braces(self):
        """Ensures malformed spintax raises SpintaxSyntaxError immediately."""
        with self.assertRaises(SpintaxSyntaxError):
            validate_spintax("{Hi|Hello")  # Missing closing brace
        
        with self.assertRaises(SpintaxSyntaxError):
            validate_spintax("Hi|Hello}")  # Unexpected closing brace

        with self.assertRaises(SpintaxSyntaxError):
            validate_spintax("{Hi|{Hello|Hey}")  # Unbalanced nested

    def test_render_email_template_with_lead_dict(self):
        """Ensures {{field}} tokens are replaced before spintax is parsed."""
        template = "{Hi|Hello} {{buyer_name}}, does {{company_name}} use {{accounting_software}}?"
        lead = {
            "buyer_name": "Michael",
            "company_name": "Advancelab",
            "accounting_software": "AutoCount"
        }
        res = render_email_template(template, lead)
        self.assertIn("Michael", res)
        self.assertIn("Advancelab", res)
        self.assertIn("AutoCount", res)
        self.assertNotIn("{{", res)
        self.assertNotIn("}}", res)

    def test_missing_buyer_name_uses_safe_greeting_fallback(self):
        self.assertEqual(
            render_email_template("Hey {{buyer_name}},", {"buyer_name": ""}),
            "Hey there,",
        )

    def test_company_name_with_bracket_markup_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "company_name.*bracket"):
            render_email_template(
                "We can help {{company_name}}.",
                {"company_name": "[in]trigue"},
            )

    def test_campaign_angles_validity(self):
        """Validates that all default campaign angles contain valid spintax syntax."""
        sample_lead = {
            "buyer_name": "John Doe",
            "company_name": "Acme Corp",
            "accounting_software": "SQL Account"
        }
        for name, data in CAMPAIGN_ANGLES.items():
            sub = render_email_template(data["subject"], sample_lead)
            body = render_email_template(data["body"], sample_lead)
            self.assertNotIn("{", sub, f"Unresolved brace in subject for {name}")
            self.assertNotIn("{", body, f"Unresolved brace in body for {name}")
            self.assertIn("Acme Corp", sub + body, f"Company name missing in {name}")

if __name__ == "__main__":
    unittest.main()
