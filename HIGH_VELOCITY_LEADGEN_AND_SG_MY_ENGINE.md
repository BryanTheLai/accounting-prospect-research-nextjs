# High-Velocity Lead-Gen & Cross-Border Outbound Engine (SG & MY)

**Operator:** Bryan  
**Role:** Senior B2B Growth-Systems Researcher & Revenue Operator  
**Date:** 2026-10-01  
**Target:** 100 to 500 Verified, High-Quality Prospects / Day  
**Corridor:** Singapore $\to$ Malaysia $\to$ Regional Cross-Border Arbitrage  
**Reference Archetype:** The "Hydroball" Lead (SG HQ/Admin + Low-Transaction Johor Subsidiary)

---

## 1. Deconstructing the "Hydroball" Wedge: Why Cross-Border is the Best Market

The qualitative discovery notes for **Hydroball** (`hydroball-shannon-choo-2026-09-30.md`) and the accounting veteran interview (`shiyi-aseline-accounting-shuqi-aunty.md`) reveal the ideal high-margin, low-friction customer profile:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SINGAPORE HEADQUARTERS                          │
│ - Admin / Management based in Singapore (e.g. Shannon Choo)            │
│ - High revenue turnover, SGD billing, high-ticket engineering contracts │
│ - Singapore accounting firm charges SGD $1,000–$2,500/mo                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Cross-border subsidiary / branch
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    MALAYSIAN SUBSIDIARY (JOHOR / KL)                   │
│ - e.g. Ulutiram / Senai / Pasir Gudang branch (HVAC / manufacturing)    │
│ - Only 1 to 10 transactions per month (factory rent, parts, local pay)  │
│ - TOO SMALL to hire an in-house Malaysian accountant (RM3,000/mo waste)│
│ - TOO EXPENSIVE to let a Singapore accounting firm bill in SGD ($$$)   │
│ - SST / LHDN compliance requirements unfulfilled                       │
│ - PAIN: Just needs clean monthly statutory books + tax filing done     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Outbounder Arbitrage
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        OUTBOUNDER PARTNER DESK                          │
│ - Matches client to vetted Malaysian partner firm                       │
│ - Charges Client: RM 800 – RM 1,500 / mo (~SGD $250 – $450/mo)         │
│   • Client saves 60% compared to Singapore accounting rates            │
│ - Pays Accounting Partner: RM 500 – RM 900 / mo (clean, simple margin) │
│ - Outbounder Net Margin: RM 300 – RM 600 / mo RECURRING per client      │
│ - Client effort: Snap photo / WhatsApp invoice (1–5 invoices / month)  │
└────────────────────────────────────────────────────────────────────────┘
```

### Who Else Fits This Exact Pattern?
1. **Johor-Singapore Special Economic Zone (JS-SEZ) Subsidiaries:**
   - Precision engineering, industrial automation, metal fabrication, plastics (Senai, Tebrau, Pasir Gudang, Gelang Patah, Kulai).
   - Food manufacturing, commercial bakery, FMCG brands with JB factories (e.g. Gardenia, Yeo's model applied to mid-market SMEs).
   - Regional warehousing, 3PL, and marine equipment distribution (PTP, Tanjung Langsat).
2. **Singapore Tech & E-Commerce Startups with Malaysian Tech/Support Teams:**
   - Incorporated in Singapore (ACRA) for venture capital / tax benefits, but with a Malaysian Sdn Bhd for developers, customer support, or operations.
   - Books in Malaysia are just payroll, office rent, and EPF/SOCSO/PCB submissions.
3. **Australian & UK Companies Operating in Malaysia:**
   - Shared services, software development agencies, and procurement offices in Kuala Lumpur / Penang.
   - Same timezone as Perth (+0h) and close to Sydney (+2h / +3h). English fluency and IFRS accounting standards make Malaysia their primary low-cost back-office hub.

---

## 2. Automated Sourcing Blueprint: How to Hunt Cross-Border Leads at Scale

To generate **100 to 500 unique prospects per day**, manual job-board searches must be replaced with programmatic sourcing vectors:

### Vector 1: ACRA (Singapore) $\leftrightarrow$ SSM (Malaysia) Cross-Border Registry Crawl
- **Concept:** Target Singapore companies registered with ACRA that have registered subsidiaries, branch offices, or common directors with a Malaysian Sdn Bhd.
- **Data Sources:**
  - Singapore Open Corporate Data / ACRA BizFile exports.
  - SSM (Suruhanjaya Syarikat Malaysia) e-Info / MyData director searches.
  - Singapore Business Federation (SBF) directory & Singapore Manufacturing Federation (SMF) directory.
- **Filter Query:** Companies with Singapore HQ address + Malaysian factory/branch/warehouse address listed on their corporate website.

### Vector 2: "Johor / Malaysia Branch" Singapore Corporate Footprints
- **Search Query Archetypes (Google Search / Exa API):**
  - `"Singapore" AND ("Johor Bahru" OR "Senai" OR "Pasir Gudang" OR "Ulu Tiram" OR "Klang") AND ("Sdn Bhd" OR "Pte Ltd") AND ("sales office" OR "factory" OR "subsidiary")`
  - `site:linkedin.com/company ("Singapore" AND "Malaysia" AND ("5..50 employees" OR "11..50 employees"))`
  - `"Pte Ltd" "Sdn Bhd" ("HVAC" OR "engineering" OR "wholesale" OR "trading" OR "packaging" OR "precision") "contact"`

### Vector 3: Cross-Border Recruitment Postings
- **The Signal:** A Singapore company posting job openings for roles physically located in Johor Bahru or Kuala Lumpur (e.g. "Customer Service (JB Office)", "Production Supervisor (Senai Plant)", "Admin Clerk (Johor Bahru)").
- **The Deduction:** The company has an operating entity in Malaysia, but management/finance sits in Singapore. Perfect fit for remote accounting management.

---

## 3. High-Speed Quality Filter Tool (Architecture & Python Spec)

The bottleneck identified is that manual review in Excel slows down lead flow. Below is the architecture for an automated, multi-stage filtering engine capable of processing 1,000 raw inputs into 100–300 contact-ready leads in minutes:

```
[Raw Ingest: CSV / Search API / Scraping Dumps]
                     │
                     ▼
  ┌────────────────────────────────────────────────┐
  │ Stage 1: Domain & Identity Deduplication       │
  │ - Strip subdomains, clean legal noise           │
  │ - Reject against SQLite master suppression list│
  └──────────────────┬─────────────────────────────┘
                     ▼
  ┌────────────────────────────────────────────────┐
  │ Stage 2: Entity & Cross-Border Linkage Filter │
  │ - Verify presence of both SG and MY footprints │
  │ - Score cross-border confidence (1–10)         │
  └──────────────────┬─────────────────────────────┘
                     ▼
  ┌────────────────────────────────────────────────┐
  │ Stage 3: Low-Transaction / High-Value Heuristic│
  │ - Sector match: Engineering, B2B trading,      │
  │   manufacturing, industrial equipment, agency. │
  │ - Exclude: High-volume retail / F&B POS piles. │
  └──────────────────┬─────────────────────────────┘
                     ▼
  ┌────────────────────────────────────────────────┐
  │ Stage 4: Economic Buyer Resolution             │
  │ - Scrape/enrich: Owner, Managing Director, CEO,│
  │   General Manager, Director.                   │
  │ - Reject records if only HR/Recruiter found.   │
  └──────────────────┬─────────────────────────────┘
                     ▼
  ┌────────────────────────────────────────────────┐
  │ Stage 5: Multi-Engine Verification Gate        │
  │ - MX record check + SMTP ping                  │
  │ - MillionVerifier API: Valid only (drop traps) │
  │ - Phone/WhatsApp validation (SG/MY regex)      │
  └──────────────────┬─────────────────────────────┘
                     ▼
  ┌────────────────────────────────────────────────┐
  │ Stage 6: Personalized Hook & Draft Prep        │
  │ - Auto-generate custom 3-touch sequence        │
  │ - Inject verified SG-MY arbitrage hook         │
  └──────────────────┬─────────────────────────────┘
                     ▼
[Output: leads.db + Read-Only Excel Dashboard View]
```

### Reference Implementation: `bin/fast_quality_filter.py`
```python
"""
High-Speed Cross-Border Quality Filter Engine
Filters raw company observations into high-value SG-MY prospects.
"""
import re
import sqlite3
from urllib.parse import urlparse

SECTOR_PRIORITY = {
    "engineering": 10, "industrial": 10, "trading": 9, 
    "manufacturing": 9, "automation": 10, "logistics": 8,
    "software": 8, "consulting": 7, "retail": 2, "f&b": 2
}

def normalize_domain(url_or_domain: str) -> str:
    url = url_or_domain.lower().strip()
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    netloc = urlparse(url).netloc
    if netloc.startswith('www.'):
        netloc = netloc[4:]
    return netloc

def score_lead(company_name: str, domain: str, text_corpus: str, contact_email: str) -> dict:
    score = 0
    flags = []
    
    # 1. Cross-border SG-MY footprint check
    has_sg = bool(re.search(r'\b(singapore|sg|pte ltd|\+65)\b', text_corpus, re.I))
    has_my = bool(re.search(r'\b(malaysia|my|sdn bhd|johor|kl|selangor|\+60)\b', text_corpus, re.I))
    
    if has_sg and has_my:
        score += 35
        flags.append("SG_MY_CROSS_BORDER_CONFIRMED")
    elif has_sg or has_my:
        score += 15
        flags.append("SINGLE_COUNTRY_ONLY")
    else:
        return {"passed": False, "score": 0, "reason": "No regional presence"}

    # 2. B2B Sector & Low-Transaction High-Ticket Match
    sector_score = 0
    for sector, weight in SECTOR_PRIORITY.items():
        if re.search(rf'\b{sector}\b', text_corpus, re.I):
            sector_score = max(sector_score, weight * 3)
            flags.append(f"SECTOR_{sector.upper()}")
    score += sector_score

    # 3. Decision-Maker Contact Verification
    is_personal_biz_email = bool(re.search(r'^[a-z0-9._%+-]+@(?!gmail|yahoo|hotmail)', contact_email, re.I))
    is_generic = bool(re.search(r'^(info|enquiry|sales|admin|support|contact)@', contact_email, re.I))
    
    if is_personal_biz_email and not is_generic:
        score += 25
        flags.append("NAMED_BUSINESS_EMAIL")
    elif is_generic:
        score += 10
        flags.append("GENERIC_OFFICE_EMAIL")

    # 4. Filter Gate
    # Threshold for Tier A: 65+ | Tier B: 50-64 | Reject: <50
    tier = "A" if score >= 65 else ("B" if score >= 50 else "REJECT")
    
    return {
        "passed": tier in ["A", "B"],
        "tier": tier,
        "score": score,
        "flags": flags,
        "domain": normalize_domain(domain)
    }
```

---

## 4. The Real-World 500 Sends / Day Outbound Tech Stack

If the objective is sending **500 emails per day** (2,500/week = 10,000–12,000/month):

### Infrastructure Requirements Matrix
- **Daily Volume:** 500 outbound sends / day.
- **Safe Outbound Capacity per Mailbox:** 20 to 25 sends / day (to keep spam rates <0.1% and prevent domain burn).
- **Total Mailboxes Required:** $500 / 20 = \mathbf{25\text{ mailboxes}}$.
- **Total Secondary Domains Required:** 2 mailboxes per domain = $\mathbf{12\text{ to }13\text{ secondary domains}}$.

### Recommended Fast-Provisioning Stack:
1. **Domains:** Buy 12 domains via Cloudflare or Porkbun ($9.77 to $10.50/year each). Example: `openclose-sg.com`, `outbounder-my.co`, `getoutbounder.biz`, `outbounder-tax.com`.
2. **Mailboxes (The Speed Choice):**
   - **Option A (InboxKit / Managed M365):** Provision 25 Microsoft 365 Business mailboxes ($3.00/mo per mailbox = **$75/month**). Instant automated SPF/DKIM/DMARC configuration.
   - **Option B (Mailforge):** Provision 25 shared SMTP/Cloud mailboxes ($3.00/mo = **$75/month**). Fast 1-click provisioning.
3. **Sequencer:** **Smartlead.ai Pro** ($94.00/month).
   - Unlimited connected email accounts.
   - Connect all 25 mailboxes with automatic **inbox rotation**.
   - Send limit: Smartlead distributes the 500 daily emails evenly across the 25 mailboxes (~20 emails per mailbox per day).
   - Smartlead **Unibox** routes all prospect replies into one master dashboard.
4. **Email Verification:** **MillionVerifier API** ($4.99 per 10,000 credits). Real-time verification on upload.
5. **Total Monthly Stack Cost:**
   - 25 Mailboxes: $75.00 / mo
   - 12 Domains (amortized): $10.50 / mo
   - Smartlead Pro: $94.00 / mo
   - Verifications: ~$5.00 / mo
   - **Total:** **$184.50 USD / month (RM 752.76 / month)**.

---

## 5. End-to-End Pipeline Tracking Architecture

To ensure complete visibility across leads, verification, sends, replies, calls, and revenue:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SQLITE DATABASE (leads.db)                      │
│ - Canonical, ACID-compliant local database                             │
│ - Tracks state transitions:                                            │
│   sourced -> filtered -> verified -> queued -> sent -> replied -> call│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ├── Webhook / Nightly Sync Script
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    LIVE OPERATOR DASHBOARD (Excel / Google Sheets)     │
│ - Read-only view for Bryan:                                            │
│   • Sourced Today: 450                                                 │
│   • Passed Quality Filter: 165 (Tier A: 45, Tier B: 120)               │
│   • Verified Deliverable: 152                                          │
│   • Dispatched in Sequencer: 500 (Step 1: 174, Step 2: 165, Step 3: 161) │
│   • Positive Replies: 4                                                │
│   • Calls Booked: 2                                                    │
│   • Contract Value (MRR): RM 1,800                                     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. The Cross-Border Outreach Copy Template (3-Touch Wedge)

### Touch 1: The Cross-Border Arbitrage Hook (Day 1)
**Subject:** Johor subsidiary accounting / [Company Name]  
**Preview:** managing Johor accounts from Singapore

> Hi [First Name],
>
> Saw that [Company Name] operates in both Singapore and Malaysia (with your Johor facility in [Location/Park]).
>
> Most Singapore companies we speak with find their Malaysian branch only does 3 to 10 transactions a month—way too low to hire a full-time Malaysian accountant (RM3,000/mo), but Singapore accounting firms charge SGD $800+/mo to touch it.
>
> We set up a cross-border accounting desk that takes care of your Malaysian subsidiary’s monthly ledgers, SST, and year-end audit readiness starting from RM800/mo (~SGD $250).
>
> Would you be open to a quick 10-minute scope check this week to see if we can take this off your plate?
>
> Best,  
> Bryan  
> Outbounder Cross-Border Accounting Desk  
> WhatsApp: [Direct Line]

### Touch 2: Low-Transaction Simplicity Hook (Day 4)
**Subject:** Re: Johor subsidiary accounting / [Company Name]

> Hi [First Name],
>
> Following up on this—if your Malaysian branch transaction count is small, you don't even need software licenses or complex handovers. 
>
> You simply WhatsApp receipts or invoice PDFs to our team, and our qualified Malaysian accounting partners maintain the double-entry ledgers and statutory compliance.
>
> Worth comparing against your current setup?

### Touch 3: Polite Breakaway (Day 8)
**Subject:** Closing loop: [Company Name] Malaysia books

> Hi [First Name],
>
> Assuming your Malaysian accounting and SST compliance are already handled seamlessly, I'll close the loop here.
>
> If you ever need overflow bookkeeping capacity or a clean audit handoff for your Malaysian entity down the line, feel free to keep my contact.
>
> Best,  
> Bryan
