"""
Autonomous Campaign & Outbound Framework (CLI & API)
Provides programmatic and command-line control for the AI agent and human operator
to manage mailboxes, launch campaign playbooks, source leads, and monitor deliverability.

Usage Examples:
    py campaign_framework.py status
    py campaign_framework.py mailbox list
    py campaign_framework.py mailbox add --email user@openclose-desk.com --pass secret --name "Bryan @ Outbounder"
    py campaign_framework.py mailbox test --email user@openclose-desk.com
    py campaign_framework.py campaign list
    py campaign_framework.py campaign show jobstreet_hiring_pain
    py campaign_framework.py campaign create --id my_angle --name "My Angle" --wedge "Pitch"
    py campaign_framework.py ingest --file leads.csv --campaign jobstreet_hiring_pain
    py campaign_framework.py prompt --campaign jobstreet_hiring_pain
"""

import sys
import os
import io

# Ensure UTF-8 output encoding across Windows consoles and subprocess pipes
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import argparse
import json
import csv
import smtplib
from pathlib import Path
from typing import Dict, List, Any, Optional

import campaign_database as db
from spintax_engine import render_email_template, parse_spintax

BASE_DIR = Path(__file__).resolve().parent

# ==============================================================================
# LEAD SOURCING STRATEGIES REGISTRY
# ==============================================================================

class LeadSourcingStrategy:
    """Base class for campaign lead sourcing recipes."""
    def __init__(self, campaign_id: str, name: str, description: str, platforms: List[str]):
        self.campaign_id = campaign_id
        self.name = name
        self.description = description
        self.platforms = platforms

    def get_agent_prompt(self, target_count: int = 25, location: str = "Johor / Singapore") -> str:
        raise NotImplementedError

class JobStreetHiringPainStrategy(LeadSourcingStrategy):
    def __init__(self):
        super().__init__(
            campaign_id="jobstreet_hiring_pain",
            name="Active JobStreet / Indeed Recruitment Reverse-Pitch",
            description="Find companies actively hiring an Accounts Assistant or Clerk in Johor offering RM2,500–RM4,100/mo.",
            platforms=["JobStreet Malaysia", "Ricebowl.my", "Indeed Malaysia", "SSM e-Info", "Google Maps"]
        )

    def get_agent_prompt(self, target_count: int = 25, location: str = "Johor (JB, Senai, Kulai, Pasir Gudang)") -> str:
        return f"""You are the Outbounder Lead Scout.
Target Campaign: JobStreet Hiring Pain (Active Recruitment Reverse-Pitch)
Task: Find {target_count} active job advertisements for accounting roles in {location}.

Target Roles:
- Accounts Assistant, Accounts Clerk, Junior Accountant, Bookkeeper.

Platforms to search:
1. JobStreet Malaysia (my.jobstreet.com/jobs/accounting-jobs-in-johor)
2. Ricebowl.my (accounting jobs in Johor)
3. Indeed Malaysia

Data to extract for each company:
- company_name: Official registered name (e.g. Advancelab Sdn. Bhd.)
- job_title: Advertised position
- salary_offered: Advertised monthly salary range (e.g. RM 2,800 - RM 3,500)
- location: Specific facility location (e.g. Senai Airport City, Kulai)
- proof_link: Direct link to the active job posting
- buyer_name: Managing Director, General Manager, or Owner (from SSM / Google Maps / LinkedIn)
- contact_email: Corporate contact email (MD, info@, or hr@)
- contact_phone: Office telephone or direct line (+60 7-...)
- accounting_software: AutoCount, SQL Account, or Xero
- sg_my_wedge: Reverse-pitch statement comparing RM3.5k salary + EPF to RM800/mo done-for-you ledger.

Output as CSV or append to leads.db using:
py campaign_framework.py ingest --file <output.csv> --campaign jobstreet_hiring_pain
"""

class CrossBorderIndustrialStrategy(LeadSourcingStrategy):
    def __init__(self):
        super().__init__(
            campaign_id="hydroball_clones",
            name="Cross-Border Industrial SG HQ + Johor Factory Arbitrage",
            description="Find Singapore engineering and manufacturing firms with a Johor plant generating 5–20 invoices/mo.",
            platforms=["Federation of Malaysian Manufacturers (FMM)", "Singapore Manufacturing Federation (SMF)", "ACRA BizFile", "SSM"]
        )

    def get_agent_prompt(self, target_count: int = 25, location: str = "Johor Industrial Hubs (Senai, Tebrau, Pasir Gudang)") -> str:
        return f"""You are the Outbounder Cross-Border Lead Scout.
Target Campaign: Cross-Border Industrial Corridor (The 15-Invoice Wedge)
Task: Find {target_count} Singapore manufacturers/engineering firms with Malaysian facilities in {location}.

Profile:
- Singapore HQ (Jurong, Tuas, Ubi, Woodlands).
- Secondary Malaysian plant, warehouse, or assembly facility in Johor.
- Transaction volume: 5 to 20 Malaysian invoices/month (too small for resident accountant; huge waste to hire full-time).

Data to extract:
- company_name: Malaysian operating entity (e.g. Hydroball Asia Sdn. Bhd.)
- headquarters: Singapore address / parent company
- malaysia_facility: Exact industrial park in Johor
- sector: Precision engineering, metal fabrication, chemicals, electronics, distribution
- estimated_transactions_mo: Estimated 5–15 invoices/mo
- buyer_name: Managing Director / Group Finance Controller
- contact_email: Director or executive email
- contact_phone: Malaysian or Singapore phone number
- sg_my_wedge: Pitching RM800/mo ledger over RM4,000 resident accountant hire.

Ingest command:
py campaign_framework.py ingest --file <output.csv> --campaign hydroball_clones
"""

class CpaFirmSubcontractingStrategy(LeadSourcingStrategy):
    def __init__(self):
        super().__init__(
            campaign_id="accounting_firm_partners",
            name="Accounting & Audit Firm White-Label Back-Office",
            description="Find boutique 1–5 partner CPA, audit, and tax firms facing staff turnover or high SGD labor costs.",
            platforms=["ISCA Public Directory", "MIA Member Directory", "Google Maps 'Firma Perakaunan'"]
        )

    def get_agent_prompt(self, target_count: int = 25, location: str = "Singapore & Johor Bahru") -> str:
        return f"""You are the Outbounder Partner Scout.
Target Campaign: CPA & Audit Firm Subcontracting
Task: Find {target_count} boutique accounting, audit, and tax firms in {location}.

Profile:
- 1 to 5 partner boutique practices.
- Stressed with peak season audit workloads, SST/GST filings, and bookkeeping clerk turnover.

Data to extract:
- company_name: Firm name (e.g. K.T. Tan & Co.)
- buyer_name: Managing Partner, Principal, or Sole Proprietor
- contact_email: Official partner email
- contact_phone: Office phone
- sg_my_wedge: White-label Malaysian bookkeeping fulfillment at wholesale RM rates while they bill SGD/premium advisory.

Ingest command:
py campaign_framework.py ingest --file <output.csv> --campaign accounting_firm_partners
"""

class LhdnEinvoicingUrgencyStrategy(LeadSourcingStrategy):
    def __init__(self):
        super().__init__(
            campaign_id="lhdn_einvoicing_urgency",
            name="LHDN MyInvois e-Invoicing Compliance Panic",
            description="Find Malaysian B2B distributors and trade suppliers on AutoCount / SQL facing e-invoicing Phase 2/3 mandates.",
            platforms=["SSM e-Info", "Yellow Pages Malaysia", "AutoCount / SQL Accounting user directories"]
        )

    def get_agent_prompt(self, target_count: int = 25, location: str = "Klang Valley & Johor") -> str:
        return f"""You are the Outbounder Compliance Scout.
Target Campaign: LHDN e-Invoicing Urgent Compliance
Task: Find {target_count} Malaysian B2B distributors, wholesalers, and industrial traders in {location}.

Profile:
- Annual turnover RM5M – RM25M (Phase 2 & Phase 3 LHDN mandate).
- Running on-premise AutoCount or SQL Accounting.
- Need automated e-invoicing XML generation, validation, and real-time portal submission without expensive ERP migration.

Data to extract:
- company_name: Company name
- buyer_name: Finance Director or Business Owner
- contact_email: Direct email
- contact_phone: Office line
- accounting_software: AutoCount, SQL Account, or UBS
- sg_my_wedge: Automated LHDN e-invoicing middleware + monthly reconciliation with zero software migration.

Ingest command:
py campaign_framework.py ingest --file <output.csv> --campaign lhdn_einvoicing_urgency
"""

class YcUsExpansionStrategy(LeadSourcingStrategy):
    def __init__(self):
        super().__init__(
            campaign_id="yc_us_expansion",
            name="YC Startups (W20-S25) US Delaware C-Corp Finance Desk",
            description="Find active, revenue-generating Y Combinator startups (batches 2020-2025) with team size >= 4 or active hiring.",
            platforms=["Y Combinator Directory (yc-oss Algolia sync)", "Hacker News Launches", "LinkedIn Founder Profiles"]
        )

    def get_agent_prompt(self, target_count: int = 25, location: str = "United States / Global YC") -> str:
        return f"""You are the Outbounder US Startup Scout.
Target Campaign: YC US Expansion (Delaware C-Corp Finance Desk)
Task: Find {target_count} active, revenue-generating Y Combinator companies from 2020-2025 batches.

Profile:
- YC Batch: W20 through S25.
- Status: Active.
- Revenue proxy: team_size >= 4 OR actively hiring on YC Jobs.
- Business model: B2B SaaS, Fintech, Marketplaces, DevTools, Healthcare Ops.

Data to extract:
- company_name: Company name
- buyer_name: Founder / CEO / Co-Founder
- contact_email: Direct founder email (firstname@domain.com)
- website: Root domain
- team_size: Team headcount
- batch: YC Batch (e.g. W22)
- offer_wedge: $800/mo flat chartered accounting desk vs Pilot turnover + Oct 15 tax extension catch-up.

Ingest command:
py harvest_yc_5year_master.py
py ingest_yc_pipeline.py --campaign yc_us_expansion
"""

STRATEGY_REGISTRY: Dict[str, LeadSourcingStrategy] = {
    "jobstreet_hiring_pain": JobStreetHiringPainStrategy(),
    "hydroball_clones": CrossBorderIndustrialStrategy(),
    "accounting_firm_partners": CpaFirmSubcontractingStrategy(),
    "lhdn_einvoicing_urgency": LhdnEinvoicingUrgencyStrategy(),
    "yc_us_expansion": YcUsExpansionStrategy(),
}

# ==============================================================================
# CLI HANDLERS
# ==============================================================================

def handle_status(args):
    """Outputs overall deliverability, mailbox health, and campaign metrics."""
    db.init_campaign_tables()
    db.seed_default_campaigns()
    mailboxes = db.get_all_mailboxes()
    sends_today = db.get_sends_today_count()
    sends_hour = db.get_sends_last_hour_count()
    suppression_count = len(db.get_suppressed_emails())
    lead_counts = db.get_campaign_lead_counts()
    campaigns = db.get_all_campaigns()

    print("\n" + "=" * 65)
    print(" 🚀 OUTBOUNDER OUTBOUND ENGINE TELEMETRY SNAPSHOT")
    print("=" * 65)
    print(f" Daily Sends Today:      {sends_today} sends")
    print(f" Rolling Hour Sends:     {sends_hour} sends")
    print(f" Suppressed Addresses:   {suppression_count} emails (Bounces/DNC)")
    print("-" * 65)
    print(f" Active Mailboxes Pool:  {len(mailboxes)} registered")
    for mb in mailboxes:
        status_sym = "🟢" if mb["status"] == "ACTIVE" else ("🟡" if mb["status"] == "COOLDOWN" else "🔴")
        print(f"   {status_sym} [{mb['mailbox_id']}] {mb['email']} | Limits: {mb['hourly_limit']}/hr, {mb['daily_limit']}/day | Status: {mb['status']}")
    print("-" * 65)
    print(f" Campaign Playbooks:     {len(campaigns)} defined")
    for cp in campaigns:
        cid = cp["campaign_id"]
        cnt = lead_counts.get(cid, 0)
        print(f"   🎯 [{cid}] {cp['name']} ({cnt} leads)")
    print("=" * 65 + "\n")

def handle_mailbox(args):
    """Subcommand router for mailbox operations."""
    action = args.mailbox_action
    if action == "list":
        mailboxes = db.get_all_mailboxes()
        if not mailboxes:
            print("No mailboxes configured in pool.")
            return
        print(f"\nConfigured Mailbox Pool ({len(mailboxes)} mailboxes):")
        for mb in mailboxes:
            print(f"- ID: {mb['mailbox_id']} | Email: {mb['email']} | User: {mb['smtp_user']} | Name: {mb['sender_name']} | Quotas: {mb['hourly_limit']}/hr, {mb['daily_limit']}/day | Status: {mb['status']}")
    
    elif action == "add":
        if not args.email or not args.password:
            print("Error: --email and --password are required.")
            return
        mb_id = db.upsert_mailbox(
            email=args.email,
            smtp_user=args.user or args.email,
            smtp_password=args.password,
            sender_name=args.name or "Bryan @ Outbounder",
            daily_limit=args.daily_limit,
            hourly_limit=args.hourly_limit,
            smtp_server=args.server,
            smtp_port=args.port
        )
        print(f"✅ Mailbox [{args.email}] added/updated with ID: {mb_id}")

    elif action == "delete":
        if not args.email and not args.id:
            print("Error: Specify --email or --id to delete.")
            return
        mailboxes = db.get_all_mailboxes()
        target = None
        for mb in mailboxes:
            if args.id and mb["mailbox_id"] == args.id:
                target = mb
                break
            if args.email and mb["email"].lower() == args.email.lower():
                target = mb
                break
        if target:
            db.delete_mailbox(target["mailbox_id"])
            print(f"🗑️ Deleted mailbox: {target['email']} (ID: {target['mailbox_id']})")
        else:
            print("Mailbox not found.")

    elif action == "test":
        mailboxes = db.get_all_mailboxes()
        targets = [mb for mb in mailboxes if not args.email or mb["email"].lower() == args.email.lower()]
        if not targets:
            print("No matching mailboxes found to test.")
            return
        for mb in targets:
            print(f"Testing SMTP handshake for {mb['email']} ({mb['smtp_server']}:{mb['smtp_port']})...")
            try:
                s = smtplib.SMTP(mb["smtp_server"], mb["smtp_port"], timeout=15)
                s.ehlo()
                s.starttls()
                s.ehlo()
                s.login(mb["smtp_user"], mb["smtp_password"])
                s.quit()
                print(f"  ✅ SUCCESS: Authenticated successfully with {mb['email']}")
                db.record_mailbox_success(mb["mailbox_id"])
            except smtplib.SMTPAuthenticationError as e:
                print(f"  ❌ AUTH ERROR (535): {e}")
                db.record_mailbox_error(mb["mailbox_id"], 535, str(e))
            except Exception as e:
                print(f"  ❌ CONNECTION ERROR: {e}")
                db.record_mailbox_cooldown(mb["mailbox_id"], 15, error_msg=str(e))

def handle_campaign(args):
    """Subcommand router for campaign playbook operations."""
    action = args.campaign_action
    if action == "list":
        db.seed_default_campaigns()
        campaigns = db.get_all_campaigns()
        counts = db.get_campaign_lead_counts()
        print(f"\nAvailable Campaign Playbooks ({len(campaigns)}):")
        for cp in campaigns:
            cid = cp["campaign_id"]
            cnt = counts.get(cid, 0)
            print(f"- [{cid}] {cp['name']} ({cnt} leads) | Status: {cp['status']}")
            print(f"    Tagline: {cp['tagline']}")
            print(f"    Template: {cp['default_template_name']}")

    elif action == "show":
        if not args.id:
            print("Error: Specify campaign id (e.g. py campaign_framework.py campaign show jobstreet_hiring_pain)")
            return
        cp = db.get_campaign_by_id(args.id)
        if not cp:
            print(f"Campaign '{args.id}' not found.")
            return
        counts = db.get_campaign_lead_counts()
        print("\n" + "=" * 70)
        print(f" 🎯 CAMPAIGN PLAYBOOK: {cp['name']}")
        print("=" * 70)
        print(f" ID:                 {cp['campaign_id']}")
        print(f" Status:             {cp['status']}")
        print(f" Leads Assigned:     {counts.get(cp['campaign_id'], 0)}")
        print(f" Tagline:            {cp['tagline']}")
        print(f" Description:        {cp['description']}")
        print("-" * 70)
        print(f" 👥 Target Criteria:\n{cp['target_criteria']}")
        print("-" * 70)
        print(f" 🔍 Sourcing Strategy (How we find leads):\n{cp['sourcing_strategy']}")
        print("-" * 70)
        print(f" ⚡ Offer Wedge:\n{cp['offer_wedge']}")
        print("-" * 70)
        print(f" 📝 Default Template: {cp['default_template_name']}")
        print("=" * 70 + "\n")

    elif action == "create":
        if not args.id or not args.name:
            print("Error: --id and --name are required.")
            return
        db.upsert_campaign(
            campaign_id=args.id,
            name=args.name,
            tagline=args.tagline or "",
            description=args.description or "",
            target_criteria=args.criteria or "",
            sourcing_strategy=args.sourcing or "",
            agent_prompt_spec=args.prompt or "",
            offer_wedge=args.wedge or "",
            default_template_name=args.template or "Angle 1",
            status="ACTIVE"
        )
        print(f"✅ Campaign '{args.name}' [{args.id}] created and saved to database.")

    elif action == "delete":
        if not args.id:
            print("Error: Specify campaign id with --id")
            return
        db.delete_campaign(args.id)
        print(f"🗑️ Deleted campaign: {args.id}")

def handle_ingest(args):
    """Ingests a CSV or JSON file of leads into a specific campaign playbook."""
    if not args.file or not args.campaign:
        print("Error: --file and --campaign are required.")
        return
    file_path = Path(args.file)
    if not file_path.exists():
        print(f"Error: File not found: {file_path}")
        return

    records = []
    if file_path.suffix.lower() == ".json":
        with open(file_path, "r", encoding="utf-8") as f:
            records = json.load(f)
            if isinstance(records, dict):
                records = [records]
    elif file_path.suffix.lower() == ".csv":
        with open(file_path, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            records = [row for row in reader]
    else:
        print(f"Unsupported file format: {file_path.suffix}. Use CSV or JSON.")
        return

    ins, upd = db.ingest_leads_to_campaign(records, args.campaign)
    print(f"✅ Ingestion Complete for campaign [{args.campaign}]:")
    print(f"   - New Leads Inserted: {ins}")
    print(f"   - Existing Leads Updated: {upd}")
    print(f"   - Total Processed: {len(records)}")

def handle_template(args):
    """Subcommand router for email templates."""
    action = args.template_action
    if action == "list":
        tmpls = db.get_all_templates()
        if not tmpls:
            print("No templates stored in database.")
            return
        print(f"\nAvailable Outbound Email Templates ({len(tmpls)}):")
        for t in tmpls:
            def_badge = " [DEFAULT]" if t.get("is_default") else ""
            print(f"- [{t['template_id']}] {t['name']}{def_badge}")
            print(f"    Subject: {t['subject']}")
            print(f"    Updated: {t.get('updated_at')}")

    elif action == "show":
        tmpls = db.get_all_templates()
        target = None
        for t in tmpls:
            if str(t['template_id']) == args.name_or_id or t['name'].lower() == args.name_or_id.lower() or args.name_or_id.lower() in t['name'].lower():
                target = t
                break
        if not target:
            print(f"Template '{args.name_or_id}' not found.")
            return
        print("\n" + "=" * 65)
        print(f" 📝 TEMPLATE: {target['name']}")
        print("=" * 65)
        print(f" Subject: {target['subject']}")
        print("-" * 65)
        print(f" Body:\n{target['body']}")
        print("=" * 65 + "\n")

    elif action == "update":
        tmpls = db.get_all_templates()
        target = None
        for t in tmpls:
            if t['name'].lower() == args.name.lower() or args.name.lower() in t['name'].lower():
                target = t
                break
        if not target:
            print(f"Template matching '{args.name}' not found.")
            return
        subj = args.subject if args.subject is not None else target['subject']
        body = args.body if args.body is not None else target['body']
        is_def = 1 if args.is_default else target.get('is_default', 0)
        db.save_template(target['name'], subj, body, is_default=is_def)
        print(f"✅ Template '{target['name']}' updated successfully.")

    elif action == "create":
        if not args.name or not args.subject or not args.body:
            print("Error: --name, --subject, and --body are required.")
            return
        db.save_template(args.name, args.subject, args.body, is_default=1 if args.is_default else 0)
        print(f"✅ Created template '{args.name}'.")

    elif action == "delete":
        tmpls = db.get_all_templates()
        target = next((t for t in tmpls if t['name'].lower() == args.name.lower() or str(t['template_id']) == args.name), None)
        if target:
            db.delete_template(target['template_id'])
            print(f"🗑️ Deleted template: {target['name']}")
        else:
            print(f"Template '{args.name}' not found.")

def handle_audit_emails(args):
    """Audits leads in database and classifies email quality tiers."""
    from email_intelligence import classify_email, generate_email_permutations
    campaign_id = args.campaign
    leads = db.get_leads_by_campaign(campaign_id)
    if not leads:
        print("No leads found to audit.")
        return

    tier_counts = {1: 0, 2: 0, 3: 0, 4: 0}
    generic_leads = []

    for l in leads:
        em = l.get("contact_email", "")
        buyer = l.get("buyer_name", "")
        analysis = classify_email(em, buyer_name=buyer)
        tier_counts[analysis["tier"]] = tier_counts.get(analysis["tier"], 0) + 1
        if analysis["is_generic"]:
            domain = analysis["domain"] or l.get("root_domain", "")
            perms = generate_email_permutations(buyer, domain)
            generic_leads.append((l, analysis, perms))

    total = len(leads)
    print("\n" + "=" * 65)
    print(" 📧 B2B EMAIL INTELLIGENCE & QUALITY AUDIT")
    print("=" * 65)
    print(f" Total Prospects Audited:  {total}")
    print(f" 🟢 Tier 1 (Direct Personal/MD):  {tier_counts.get(1, 0):3d} ({tier_counts.get(1, 0)*100/total:.1f}%)")
    print(f" 🔵 Tier 2 (HR / Hiring / Dept):  {tier_counts.get(2, 0):3d} ({tier_counts.get(2, 0)*100/total:.1f}%)")
    print(f" 🟡 Tier 3 (Generic info@/admin@): {tier_counts.get(3, 0):3d} ({tier_counts.get(3, 0)*100/total:.1f}%)")
    print(f" 🔴 Tier 4 (System / Invalid):    {tier_counts.get(4, 0):3d} ({tier_counts.get(4, 0)*100/total:.1f}%)")
    print("-" * 65)
    
    limit = args.limit or 5
    if generic_leads:
        print(f" Sample of {min(limit, len(generic_leads))} Generic 'info@' Emails with Suggested Direct Alternatives:")
        for idx, (lead, analysis, perms) in enumerate(generic_leads[:limit]):
            comp = lead.get("company_name", "Unknown")
            curr = lead.get("contact_email", "")
            buyer = lead.get("buyer_name", "")
            print(f" {idx+1}. {comp} | Contact: {buyer} | Current: {curr}")
            if perms:
                sugg_str = ", ".join([p[0] for p in perms[:3]])
                print(f"    Suggested upgrades: {sugg_str}")
    print("=" * 65 + "\n")

def handle_prompt(args):
    """Outputs the ready-to-run lead sourcing prompt for an agent or scraper."""
    campaign_id = args.campaign or "jobstreet_hiring_pain"
    strategy = STRATEGY_REGISTRY.get(campaign_id)
    if strategy:
        prompt = strategy.get_agent_prompt(target_count=args.count or 25)
        print("\n" + prompt)
    else:
        cp = db.get_campaign_by_id(campaign_id)
        if cp and cp.get("agent_prompt_spec"):
            print(f"\n{cp['agent_prompt_spec']}\n")
        else:
            print(f"No specific sourcing prompt found for '{campaign_id}'.")

def handle_verify_email(args):
    """Pre-flight verification of an email address (DNS MX, RFC syntax, host fingerprint)."""
    from email_verifier import EmailVerifier
    verifier = EmailVerifier()
    res = verifier.verify(args.email)

    if getattr(args, "json", False):
        print(json.dumps({
            "email": res.email,
            "syntax_valid": res.is_valid_syntax,
            "has_mx": res.has_mx_records,
            "primary_mx": res.primary_mx,
            "status_chip": res.status_chip,
            "evidence_score": res.deliverability_score,
            "recommendation": res.recommendation
        }, indent=2))
        return

    print("\n" + "=" * 65)
    print(" 🛡️ EMAIL ADDRESS PREFLIGHT REPORT")
    print("=" * 65)
    print(f" Target Email:        {res.email}")
    print(f" Status:              {res.status_chip}")
    print(f" Evidence Score:      {res.deliverability_score}/100 (not mailbox verification)")
    print(f" RFC Syntax Valid:    {'✅ YES' if res.is_valid_syntax else '❌ NO'}")
    print(f" DNS MX Records:      {'✅ ACTIVE' if res.has_mx_records else '❌ NONE'}")
    if res.primary_mx:
        print(f" Primary Mail Host:   {res.primary_mx}")
    print(f" Recommendation:      {res.recommendation}")
    print("=" * 65 + "\n")

def handle_discover_emails(args):
    """Crawls company domain and optional job listing to discover real verified emails."""
    from email_discovery import DomainEmailCrawler, extract_emails_from_job_posting
    from email_verifier import EmailVerifier
    from email_intelligence import classify_email

    domain = args.domain.strip().lower()
    proof_url = getattr(args, "proof_link", "") or ""

    print(f"\n🔍 Starting Zero-Cost Discovery for: {domain}")
    crawler = DomainEmailCrawler(domain)
    web_res = crawler.crawl_and_discover()

    job_emails = []
    if proof_url:
        print(f"📄 Scraping job listing: {proof_url}")
        job_emails = extract_emails_from_job_posting(proof_url)

    all_found = sorted(list(set(web_res.get("emails_found", []) + job_emails)))

    if getattr(args, "json", False):
        print(json.dumps({
            "domain": domain,
            "website_emails": web_res.get("emails_found", []),
            "job_emails": job_emails,
            "all_found": all_found,
            "pages_crawled": web_res.get("pages_crawled", 0)
        }, indent=2))
        return

    print("\n" + "=" * 65)
    print(f" 🌐 ZERO-COST EMAIL DISCOVERY REPORT: {domain}")
    print("=" * 65)
    print(f" Contact Pages Crawled: {web_res.get('pages_crawled', 0)}")
    print(f" Total Real Emails Found: {len(all_found)}")
    print("-" * 65)

    if not all_found:
        print(" ⚠️ No real emails found in common contact pages or job posting.")
        print("    Recommendation: Review website manually or check LinkedIn profile.")
    else:
        verifier = EmailVerifier()
        for idx, em in enumerate(all_found):
            v_res = verifier.verify(em)
            q_res = classify_email(em)
            tier_label = f"Tier {q_res['tier']}: {q_res['tier_name']}"
            source = "Job Listing" if em in job_emails else "Website Contact Hub"
            print(f" {idx+1}. {em}")
            print(f"    Source: {source} | Quality: {tier_label} | MX: {v_res.status_chip}")
    print("=" * 65 + "\n")

# ==============================================================================
# MAIN CLI ENTRYPOINT
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Outbounder Autonomous Outbound & Campaign Framework",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # status
    p_status = subparsers.add_parser("status", help="Show system deliverability snapshot and active metrics")
    p_status.set_defaults(func=handle_status)

    # mailbox
    p_mb = subparsers.add_parser("mailbox", help="Manage multi-mailbox pool")
    p_mb_subs = p_mb.add_subparsers(dest="mailbox_action", help="Mailbox action")
    
    p_mb_list = p_mb_subs.add_parser("list", help="List all configured mailboxes")
    p_mb_add = p_mb_subs.add_parser("add", help="Add or update a sending mailbox")
    p_mb_add.add_argument("--email", required=True, help="Sender email address")
    p_mb_add.add_argument("--password", required=True, help="SMTP password or App Password")
    p_mb_add.add_argument("--user", help="SMTP username (defaults to email)")
    p_mb_add.add_argument("--name", help="Display sender name (e.g. 'Bryan @ Outbounder')")
    p_mb_add.add_argument("--daily-limit", type=int, default=50, help="Max emails per day (default: 50)")
    p_mb_add.add_argument("--hourly-limit", type=int, default=10, help="Max emails per hour (default: 10)")
    p_mb_add.add_argument("--server", default="smtp.office365.com", help="SMTP server host")
    p_mb_add.add_argument("--port", type=int, default=587, help="SMTP port")

    p_mb_del = p_mb_subs.add_parser("delete", help="Delete a mailbox")
    p_mb_del.add_argument("--email", help="Email of mailbox to delete")
    p_mb_del.add_argument("--id", type=int, help="ID of mailbox to delete")

    p_mb_test = p_mb_subs.add_parser("test", help="Test SMTP handshake")
    p_mb_test.add_argument("--email", help="Optional specific mailbox email to test")

    p_mb.set_defaults(func=handle_mailbox)

    # campaign
    p_cp = subparsers.add_parser("campaign", help="Manage campaign playbooks & targeting angles")
    p_cp_subs = p_cp.add_subparsers(dest="campaign_action", help="Campaign action")

    p_cp_list = p_cp_subs.add_parser("list", help="List all campaign playbooks")
    p_cp_show = p_cp_subs.add_parser("show", help="Show details of a campaign playbook")
    p_cp_show.add_argument("id", help="Campaign ID (e.g. jobstreet_hiring_pain)")

    p_cp_add = p_cp_subs.add_parser("create", help="Create a new campaign playbook")
    p_cp_add.add_argument("--id", required=True, help="Unique campaign ID slug")
    p_cp_add.add_argument("--name", required=True, help="Display title")
    p_cp_add.add_argument("--tagline", help="Short 1-line summary")
    p_cp_add.add_argument("--description", help="Full context")
    p_cp_add.add_argument("--criteria", help="Targeting criteria")
    p_cp_add.add_argument("--sourcing", help="How to find leads (channels & platforms)")
    p_cp_add.add_argument("--wedge", help="Offer wedge")
    p_cp_add.add_argument("--prompt", help="AI agent scraping prompt")
    p_cp_add.add_argument("--template", help="Linked default template name")

    p_cp_del = p_cp_subs.add_parser("delete", help="Delete a campaign")
    p_cp_del.add_argument("--id", required=True, help="Campaign ID to delete")

    p_cp.set_defaults(func=handle_campaign)

    # template
    p_tmpl = subparsers.add_parser("template", help="Manage email pitch templates & angles")
    p_tmpl_subs = p_tmpl.add_subparsers(dest="template_action", help="Template action")

    p_tmpl_list = p_tmpl_subs.add_parser("list", help="List all saved templates")
    p_tmpl_show = p_tmpl_subs.add_parser("show", help="Show template details")
    p_tmpl_show.add_argument("name_or_id", help="Template name or ID")

    p_tmpl_upd = p_tmpl_subs.add_parser("update", help="Update template subject and body")
    p_tmpl_upd.add_argument("--name", required=True, help="Name of template to update")
    p_tmpl_upd.add_argument("--subject", help="New subject line")
    p_tmpl_upd.add_argument("--body", help="New email body")
    p_tmpl_upd.add_argument("--default", dest="is_default", action="store_true", help="Set as default")

    p_tmpl_add = p_tmpl_subs.add_parser("create", help="Create a new template")
    p_tmpl_add.add_argument("--name", required=True, help="Template name")
    p_tmpl_add.add_argument("--subject", required=True, help="Subject line")
    p_tmpl_add.add_argument("--body", required=True, help="Email body")
    p_tmpl_add.add_argument("--default", dest="is_default", action="store_true", help="Set as default")

    p_tmpl_del = p_tmpl_subs.add_parser("delete", help="Delete a template")
    p_tmpl_del.add_argument("--name", required=True, help="Template name or ID to delete")

    p_tmpl.set_defaults(func=handle_template)

    # audit-emails
    p_audit = subparsers.add_parser("audit-emails", help="Audit lead email quality tiers and suggest direct alternatives")
    p_audit.add_argument("--campaign", help="Optional campaign ID to filter audit")
    p_audit.add_argument("--limit", type=int, default=5, help="Number of sample generic emails to display")
    p_audit.set_defaults(func=handle_audit_emails)

    # ingest
    p_ing = subparsers.add_parser("ingest", help="Ingest leads from CSV or JSON into a campaign")
    p_ing.add_argument("--file", required=True, help="Path to CSV or JSON file")
    p_ing.add_argument("--campaign", required=True, help="Campaign ID to assign leads to")
    p_ing.set_defaults(func=handle_ingest)

    # prompt
    p_prm = subparsers.add_parser("prompt", help="Get autonomous agent lead sourcing prompt for a campaign")
    p_prm.add_argument("--campaign", default="jobstreet_hiring_pain", help="Campaign ID")
    p_prm.add_argument("--count", type=int, default=25, help="Number of prospects to source")
    p_prm.set_defaults(func=handle_prompt)

    # verify-email
    p_vfy = subparsers.add_parser("verify-email", help="Verify RFC syntax and DNS MX records for an email")
    p_vfy.add_argument("email", help="Email address to verify")
    p_vfy.add_argument("--json", action="store_true", help="Output JSON format")
    p_vfy.set_defaults(func=handle_verify_email)

    # discover-emails
    p_disc = subparsers.add_parser("discover-emails", help="Discover real emails by crawling domain and job posting")
    p_disc.add_argument("--domain", required=True, help="Company root domain (e.g. alliancecosmetics.com)")
    p_disc.add_argument("--proof-link", help="Optional job posting or careers link")
    p_disc.add_argument("--json", action="store_true", help="Output JSON format")
    p_disc.set_defaults(func=handle_discover_emails)

    args = parser.parse_args()
    if not hasattr(args, "func"):
        parser.print_help()
        return

    args.func(args)

if __name__ == "__main__":
    main()
