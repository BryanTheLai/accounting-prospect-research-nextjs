# Appendix C: Provider Evaluation, Infrastructure Stack & Full Cost Matrix

**Date of Evaluation:** 2026-10-01  
**Project:** Outbounder Malaysian SME Accounting Outbound OS  
**Benchmark Currency Rate:** 1 USD = 4.08 MYR (Bank Negara Malaysia reference rate late Sept / Oct 1 2026)

---

## 1. Categorical Vendor Evaluation (8 Independent Layers)

To prevent vendor lock-in and structural confusion, the outreach operating system separates infrastructure into eight decoupled layers.

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Domain Registrar & DNS (Cloudflare / Namecheap / Porkbun)│
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Mailbox Infrastructure (Google Workspace / M365 / InboxKit)
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Sequencing & Orchestration Engine (Smartlead / Instantly) │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Lead Data, Scraping & Enrichment (Job boards, SSM, Custom)│
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Multi-Layer Email Verification (MillionVerifier / NeverBounce)
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Deliverability & Postmaster Monitoring (Google Postmaster)│
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. CRM, Lead Register & Global Suppression (SQLite + Excel)  │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Agentic Harness & Scheduling Layer (Codex, Antigravity)  │
└─────────────────────────────────────────────────────────────┘
```

### Layer 1: Domain Registrar & DNS
- **Cloudflare Registrar (Recommended):** At-cost domain pricing ($9.77 to $10.50/year for `.com`), enterprise-grade DNS propagation (<60 seconds), DNSSEC support, and zero renewal markups.
- **Namecheap / Porkbun (Alternative):** ~$10–$14/year. Reliable, but DNS propagation is slower than Cloudflare.
- **Mailforge / Reseller Domains ($14/year):** Convenient 1-click DNS configuration, but locks domain management inside the vendor dashboard.

### Layer 2: Mailbox Hosting Infrastructure

| Provider | Infrastructure Type | Monthly Cost / Mailbox | Minimum Order / Commitment | Automated DNS / Auth | Real Deliverability Reputation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Google Workspace (Direct)** | Real Google Cloud SaaS | $7.20 (monthly) / $6.00 (annual) | 1 user ($7.20/mo) | Manual DNS (guides provided) | **Highest (Gold Standard).** Best inbox placement in Gmail and Google Workspace recipients. |
| **Microsoft 365 (Direct)** | Real Exchange Online | $6.00 (annual) | 1 user ($6.00/mo) | Semi-automated via M365 admin | **Very High.** Best placement into corporate M365/Outlook recipients. |
| **InboxKit** | Managed M365 / Azure tenants | $3.00 (monthly) / $2.50 (annual) | **No minimum (1 mailbox OK)** | Fully automated SPF/DKIM/DMARC | **High.** Uses genuine M365/Google infrastructure via automated tenants. |
| **Primeforge** | Managed M365 / Google Workspace | $4.50 (monthly) / $3.75 (annual) | Slot-based capacity | Fully automated | **High.** Genuine workspace accounts; higher cost per slot. |
| **Mailforge** | Shared custom cloud SMTP | $3.00 (monthly) / $2.50 (annual) | **10 MAILBOX SLOTS ($30/mo MINIMUM)** | Fully automated (1-click) | **Moderate to Low.** Shared SMTP IP pool footprint flagged by strict enterprise filters. |
| **Maildoso** | Low-cost custom SMTP | $0.49 – $2.50 (volume-tiered) | Volume tiers (min 30 mailboxes) | Automated | **Low.** High burning rate; designed for aggressive churn-and-burn agencies. |

### Layer 3: Sequencing & Campaign Orchestration

| Platform | Entry Plan Price | Mailbox Connections | Active Contact Limit | Email Send Limit / Mo | Notes / Fit |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Smartlead.ai (Recommended)** | **$39 / mo** ($33 annual) | **Unlimited** | 2,000 active leads | 6,000 emails / mo | Best-in-class mailbox rotation, spintax, webhook triggers, API-first architecture. |
| **Instantly.ai** | **$47 / mo** ($37 annual) | **Unlimited** | 1,000 active contacts | 5,000 emails / mo | Solid UI, unibox, but contact limits are tighter on entry tier ($47 for 1,000 vs $39 for 2,000). |
| **Apollo.io** | **$59 / mo** ($49 annual) | Limited by plan seats | Credit-based | Credit-based | Great all-in-one US data + sequencer, but localized Malaysian SME data is very weak. |
| **Salesforge** | **$49 / mo** | Unlimited | Varies | Varies | Native Mailforge integration, but higher entry price than Smartlead. |

### Layer 4: Lead Data & Enrichment
- **Malaysian SME Sources:** JobStreet, Ricebowl, Maukerja, FMM Directory, MATRADE exporter registry, SSM (Companies Commission of Malaysia / e-Info / MyData).
- **Enrichment Tools:** Apollo / Kaspr / Hunter for corporate email syntax; Google Places API for verified phone and physical address.

### Layer 5: Email Verification (Mandatory Pre-Send)
- **MillionVerifier (Recommended):** $4.99 per 10,000 credits (no expiration). Extremely high accuracy on catch-all detection and SMTP verification.
- **NeverBounce:** $8.00 per 1,000 credits. Highly accurate, but 16x more expensive per credit.
- **Verification Rule:** Never send to addresses rated `Invalid`, `Disposable`, or `Spam Trap`. Catch-all addresses should only be contacted if a verified secondary channel (phone/WhatsApp) exists.

### Layer 6: Reputation & Authentication Monitoring
- **Google Postmaster Tools (Free):** Essential for monitoring domain reputation, IP reputation, spam complaint rate, and authentication success.
- **DMARC Monitoring (DMARC Digest / Cloudflare DMARC Management - Free):** Monitors aggregate XML reports to detect domain spoofing and authentication failures.

### Layer 7: CRM & Suppression List
- **Pilot Phase:** Local SQLite database (`leads.db`) with an automated Excel export view (`outbound_tracker.xlsx`).
- **Suppression Engine:** Master exclusion table in SQLite with normalized MD5 hashes of root domains, emails, and company names.

### Layer 8: Agentic Runtime & Scheduling
- **Local Coding Agents:** Google Antigravity, OpenAI Codex CLI, Claude Code.
- **Execution Model:** Operator-initiated batch scripts (`python -m scripts.run_scout`, `python -m scripts.draft_batch`) rather than unattended 24/7 loops.

---

## 2. Comprehensive Cost Matrix Across Stacks & Mailbox Counts

The table below models the exact cash outlay for **1, 2, 5, and 10 mailboxes** across the evaluated providers.
- **Assumptions:** 1 domain for 1–2 mailboxes; 2 domains for 5 mailboxes; 4 domains for 10 mailboxes. Domain cost benchmarked at $14/year ($1.17/mo).
- Sequencer: Smartlead Base ($39/mo or $388/yr).
- Verification: $10/mo ($120/yr) for 1,000–2,000 email checks.
- **FX Rate:** 1 USD = 4.08 MYR.

| Infrastructure Stack | Mailboxes | Domains | Mailbox Cost / Mo ($) | Total Monthly Cash ($ USD) | Total Monthly Cash (MYR) | Total First-Year Cash ($ USD) | Total First-Year Cash (MYR) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Google Workspace Direct + Smartlead** | 1 | 1 | $7.20 | **$57.37** | **RM 234.06** | **$594.44** | **RM 2,425.32** |
| **Microsoft 365 Direct + Smartlead** | 1 | 1 | $6.00 | **$56.17** | **RM 229.16** | **$594.44** | **RM 2,425.32** |
| **InboxKit + Smartlead** | 1 | 1 | $3.00 | **$53.17** | **RM 216.92** | **$552.44** | **RM 2,253.96** |
| **Mailforge (10-slot min) + Smartlead** | 1 | 1 | $30.00 | **$80.17** | **RM 327.08** | **$822.44** | **RM 3,355.56** |
| | | | | | | | |
| **Google Workspace Direct + Smartlead** | 2 | 1 | $14.40 | **$64.57** | **RM 263.43** | **$666.44** | **RM 2,719.08** |
| **Microsoft 365 Direct + Smartlead** | 2 | 1 | $12.00 | **$62.17** | **RM 253.64** | **$666.44** | **RM 2,719.08** |
| **InboxKit + Smartlead (Best Pilot)** | 2 | 1 | $6.00 | **$56.17** | **RM 229.16** | **$582.44** | **RM 2,376.36** |
| **Mailforge (10-slot min) + Smartlead** | 2 | 1 | $30.00 | **$80.17** | **RM 327.08** | **$822.44** | **RM 3,355.56** |
| | | | | | | | |
| **Google Workspace Direct + Smartlead (Rec)** | 5 | 2 | $36.00 | **$87.33** | **RM 356.32** | **$896.44** | **RM 3,657.48** |
| **Microsoft 365 Direct + Smartlead** | 5 | 2 | $30.00 | **$81.33** | **RM 331.84** | **$896.44** | **RM 3,657.48** |
| **InboxKit + Smartlead** | 5 | 2 | $15.00 | **$66.33** | **RM 270.64** | **$686.44** | **RM 2,800.68** |
| **Mailforge (10-slot min) + Smartlead** | 5 | 2 | $30.00 | **$81.33** | **RM 331.84** | **$836.44** | **RM 3,412.68** |
| | | | | | | | |
| **Google Workspace Direct + Smartlead** | 10 | 4 | $72.00 | **$125.67** | **RM 512.72** | **$1,284.44** | **RM 5,240.52** |
| **Microsoft 365 Direct + Smartlead** | 10 | 4 | $60.00 | **$113.67** | **RM 463.76** | **$1,284.44** | **RM 5,240.52** |
| **InboxKit + Smartlead** | 10 | 4 | $30.00 | **$83.67** | **RM 341.36** | **$864.44** | **RM 3,526.92** |
| **Mailforge (10-slot min) + Smartlead** | 10 | 4 | $30.00 | **$83.67** | **RM 341.36** | **$864.44** | **RM 3,526.92** |

### The Critical "Mailforge Minimum Trap" Uncovered:
1. **For a 1-to-2 Mailbox Pilot:** Mailforge is actually **$15 to $24/month MORE expensive** than Google Workspace or InboxKit! This is because Mailforge enforces a **10-mailbox base slot minimum ($30.00/month)**. Buying 2 mailboxes on Mailforge still incurs the full $30/month charge.
2. **At 5 Mailboxes (Target 500 Sends/Week):** Google Workspace Direct costs **$87.33/month** (RM 356.32), while Mailforge costs **$81.33/month** (RM 331.84). The price difference is a negligible **$6.00/month** (RM 24.48).
3. **The Deliverability Premium:** Paying $6.00/month extra for Google Workspace grants genuine, institutional Google-hosted mailboxes with zero shared-SMTP footprint, dramatically higher inbox delivery to corporate and personal Gmail inboxes, and immunity from SMTP IP blocklists.

---

## 3. Plain-English Technical Mail Architecture Guide

For Bryan to understand and audit the setup without needing a systems engineering background:

```
[Sending Server: Google Workspace / M365 / Mailforge]
   │
   ├── 1. Sends message to Recipient Mail Server
   │
   ▼
[Recipient Mail Server: Evaluates 4 DNS Records]
   ├── A. SPF Check: Is this sending IP authorized by sender's domain?
   ├── B. DKIM Check: Is the cryptographic signature valid and unaltered?
   ├── C. DMARC Check: Do From: domain and DKIM/SPF align? What is policy?
   └── D. MX Check: Can this domain actually receive reply mail?
   │
   ▼
[Recipient Verdict: Primary Inbox | Spam Folder | Hard Reject (550)]
```

### The 6 Core Protocols Explained:
1. **MX (Mail Exchange):** Directs inbound emails to your mail server. Secondary domains used for outbound must have valid MX records pointing to Google/M365 so that replies can be received.
2. **SPF (Sender Policy Framework):** A TXT record published in your DNS that lists every authorized IP address or mail server allowed to send email on behalf of your domain (e.g. `v=spf1 include:_spf.google.com ~all`).
3. **DKIM (DomainKeys Identified Mail):** A cryptographic public/private key pair. The sending server signs every outgoing email with a private key; the receiving server fetches the public key from your DNS TXT record to verify the email was not tampered with in transit.
4. **DMARC (Domain-based Message Authentication, Reporting & Conformance):** Tells receiving mail servers what to do if an email fails SPF or DKIM. Policies can be `p=none` (monitor only), `p=quarantine` (send to spam), or `p=reject` (block delivery). Google and Yahoo mandate DMARC records for all senders in 2024–2026.
5. **Custom Tracking Domain (CNAME):** By default, email sequencers track opens/clicks via their shared domain (e.g. `track.smartlead.ai`). Shared tracking domains get flagged by spam filters. A custom CNAME (e.g. `link.openclosehq.com`) ensures all tracking links match your authenticated sending domain.
6. **SMTP & IMAP:** SMTP (Simple Mail Transfer Protocol) is used to dispatch outbound emails. IMAP (Internet Message Access Protocol) is used by the sequencing platform to monitor the inbox for prospect replies and stop automated follow-ups immediately upon receiving a response.

---

## 4. Warm-Up Pools: Critical Reality Check vs. Vendor Claims

Many vendors (Instantly, Mailforge, Smartlead) market automated "warmup pools" as a magic bullet for deliverability.

### The Truth About Warmup Networks in 2026:
- **What Warmup Pools Actually Do:** They connect thousands of outbound mailboxes together. The platform automatically sends gibberish or AI-generated emails back and forth between accounts in the pool, marking them as "Not Spam" and archiving them.
- **Major ESP Detection (Google & Microsoft):** Google and Microsoft have extensive machine-learning models that analyze peer-to-peer traffic. They recognize the repetitive communication graphs, artificial open speeds, and synthetic text generated by warmup networks.
- **Google Policy Enforcement:** In 2023–2024, Google explicitly banned third-party warmup services from accessing Gmail consumer accounts via API.
- **The Verdict:** Warmup pools provide a mild benefit during the first 14 days of a new domain to establish initial baseline DNS activity, but **they cannot save a bad campaign**. If real human recipients mark your emails as spam, or if bounce rates exceed 2%, no warmup network can prevent domain reputation collapse.

---

## 5. Deliverability Stop & Pause Signals: The Operational Playbook

Bryan must immediately pause outbound campaigns if any of the following triggers occur:

| Metric / Signal | Warning Threshold | Hard Stop / Pause Threshold | Immediate Operational Response |
| :--- | :--- | :--- | :--- |
| **Bounce Rate** | **> 2.0%** | **> 4.0%** | **STOP CAMPAIGN.** Immediately halt queue. Re-verify entire lead list with MillionVerifier. Check if an entire company domain underwent a server migration. |
| **Google Spam Complaint Rate** | **> 0.10%** | **> 0.25%** | **STOP CAMPAIGN.** Check copy for aggressive sales language. Ensure opt-out link is prominent. Reduce daily send volume by 50%. |
| **SPF/DKIM/DMARC Failure** | 1 failure | Continuous failure | **STOP SENDS.** Use MXToolbox or Google Admin Dig to verify DNS records were not overwritten or dropped. |
| **Zero Replies in 300 Sends** | 0 replies in 200 sends | 0 replies in 400 sends | **PAUSE & AUDIT.** Send a test email from the sequencer to a personal Gmail and Outlook address to check if emails are landing in the Spam folder or Promotions tab. |
| **Unsubscribe Request** | Any request | Any request | **IMMEDIATE SUPPRESSION.** Add prospect domain and email to `leads.db` suppression table within 2 hours. Do not send any follow-ups. |
