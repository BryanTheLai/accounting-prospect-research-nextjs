"""
Robust Recursive Spintax Engine with Syntax Validation & Campaign Angle Templates
Path: spintax_engine.py
"""
import re
import random
from typing import Dict, Any, Tuple

class SpintaxSyntaxError(ValueError):
    """Raised when spintax contains unbalanced or malformed braces."""
    pass

def validate_company_name(company_name: Any) -> str:
    value = "" if company_name is None else str(company_name).strip()
    if any(char in value for char in "[]"):
        raise ValueError("company_name contains bracket markup; provide a clean display name before sending")
    return value

def validate_spintax(text: str) -> None:
    """Verifies that curly braces are properly balanced and not malformed."""
    depth = 0
    for idx, char in enumerate(text):
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth < 0:
                raise SpintaxSyntaxError(f"Unexpected closing brace '}}' at character position {idx}")
    if depth != 0:
        raise SpintaxSyntaxError(f"Unclosed opening brace '{{' detected (unbalanced depth: {depth})")

def parse_spintax(text: str) -> str:
    """
    Recursively resolves innermost spintax variations.
    Example: '{Hi|{Hello|Hey}}' -> 'Hello'
    """
    validate_spintax(text)
    pattern = re.compile(r'\{([^{}]+)\}')
    
    while True:
        match = pattern.search(text)
        if not match:
            break
        options = match.group(1).split('|')
        chosen = random.choice(options)
        text = text[:match.start()] + chosen + text[match.end():]
        
    return text

def render_email_template(template: str, lead: Dict[str, Any]) -> str:
    """
    Safely substitutes lead variables {{field_name}} first, 
    then processes spintax variations.
    """
    rendered = template
    for key, value in lead.items():
        placeholder = f"{{{{{key}}}}}"
        str_val = "" if value is None else str(value).strip()
        if key == "company_name" and placeholder in rendered:
            str_val = validate_company_name(value)
        if key == "buyer_name" and not str_val:
            str_val = "there"
        rendered = rendered.replace(placeholder, str_val)
        
    return parse_spintax(rendered)

# ==============================================================================
# AUTHORITATIVE YC VENTURE OUTBOUND ANGLES (NO AI SLOP, NO BANNED WORDS)
# ==============================================================================

CAMPAIGN_ANGLES = {
    "🚀 Angle 1: Commercial Burn Cut ($800/mo vs Pilot)": {
        "subject": "bookkeeping for {{company_name}}",
        "body": """{Hey|Hi} {{buyer_name}},

Most YC founders are paying Pilot or traditional accounting firms $1,500 to $2,500/mo for slow closes and junior account managers who turn over every 90 days.

We run an AI-native accounting firm built specifically for early-stage venture startups:
- Books closed in 48 hours every month (Stripe, Mercury, Brex, Gusto auto-synced)
- Flat $800/mo (no revenue tax or transaction markups)
- Form 1120 tax extensions, 83(b), and Delaware franchise filings handled

Would you be open to a 30 minute call so we can help you focus on building your product instead of worrying about accounting?

Best,
Bryan Lai
Outbounder"""
    },
    "💡 Angle 2: Conversational Builder Approach (Stripe & Ledger In-House vs Outsourced)": {
        "subject": "{{company_name}}'s stripe / ledger",
        "body": """{Hey|Hi} {{buyer_name}},

Are you managing your own monthly books and Stripe reconciliation in-house right now, or did you outsource it to a firm?

This is not a sales pitch, we're building an AI-native accounting firm, and would love it if we could hop on a 30-minute call to help you eliminate your accounting headaches so you can focus on your product.

Let me know if this interests you!

Best,
Bryan Lai
Outbounder"""
    }
}

