# Outbounder Cross-Border Outbound Knowledge Base & Agent Playbook

**Owner:** Bryan  
**Role:** Canonical Strategy, Targeting & Technical Reference for AI Agents & Operator  
**Last Updated:** 2026-10-01  
**Project:** Outbounder Cross-Border Accounting Partner Matching (SG ⇄ MY ⇄ AU)

---

## 1. Executive Summary & Core Value Proposition

Outbounder operates as a **cross-border accounting partner desk**. We match Singapore and Australian companies operating Malaysian subsidiaries or remote teams with vetted, qualified Malaysian accounting practices.

### The Core Arbitrage Hook:
- **The Problem:** A Singapore or Australian SME with a Malaysian subsidiary (e.g. Johor manufacturing plant, KL sales office, tech team) typically generates only **2 to 10 transactions per month**. 
  - Hiring a full-time Malaysian accountant costs **RM 3,000–RM 4,000/mo** (massive financial waste for 5 invoices).
  - Hiring a local Singapore accounting firm costs **SGD $800–$2,000/mo (~RM 2,600–RM 6,500/mo)** because Singapore firms bill in SGD.
- **The Outbounder Solution:** Outbounder provides done-for-you bookkeeping, SST filing, and audit-ready ledgers via vetted Malaysian partner firms for **RM 800–RM 1,200/mo (~SGD $250–$350/mo)**.
- **The Customer ROI:** The client saves **60% to 70%** compared to Singapore accounting fees and eliminates the headache of Malaysian statutory compliance.
- **The Economics:** Outbounder pays the local accounting partner RM 500–RM 800/mo, retaining **RM 300–RM 600/mo net recurring margin**.

---

## 2. Target Markets & Regional Accounting Software

| Jurisdiction | Target Persona | Dominant Accounting Platforms | Key Regulatory & Tax Hooks |
| :--- | :--- | :--- | :--- |
| **Singapore (SG)** | HQ in Singapore with factory/warehouse/sales office in Johor or KL (e.g. JS-SEZ corridor: Senai, Pasir Gudang, Ulu Tiram). | **Xero** (overwhelming SME market leader, heavily subsidized by PSG grants), **QuickBooks Online**, **ABSS (formerly MYOB)**, **AutoCount Singapore**. | Malaysian SST registration, cross-border group consolidation, year-end statutory audit preparation, LHDN e-invoicing compliance. |
| **Australia (AU)** | Australian SMEs outsourcing back-office, engineering, or customer support to Malaysia. | **Xero** (~70%+ market share; Australian-born powerhouse), **MYOB** (legacy market leader), **QuickBooks Online**, **Reckon**. | Significant hourly rate arbitrage: Australian bookkeepers charge $50–$80 AUD/hr; Malaysian support costs ~$20 AUD/hr equivalent. Perth shares Malaysia's exact timezone (UTC+8). |
| **Malaysia (MY)** | Domestic trading, wholesale, distribution, and manufacturing SMEs (20–100 staff). | **AutoCount**, **SQL Account**, **Sage UBS**, **Bukku**, **Million**, Xero. | LHDN phased e-invoicing mandate (2024–2026), messy PDF/paper invoice backlogs, accounts staff turnover. |

*Rule for Outbound Messaging:* **Xero is the common standard linking Singapore and Australia.** Always emphasize Xero compatibility in cross-border campaigns.

---

## 3. High-Priority Target Titles vs. Red Flags

### ✅ High-Priority Economic Buyers (Pitch Directly):
- **Managing Director (MD)** (Highest conversion in SG/MY SMEs)
- **Director** / **Executive Director**
- **Owner** / **Co-Founder** / **Founder**
- **Chief Executive Officer (CEO)**
- **General Manager (GM)** (For mid-sized plants in Johor)
- **Director of Regional Operations** / **Country Manager**

### ❌ Red-Flag Titles (DO NOT CONTACT):
- **Accounts Clerk** / **Invoicing Clerk** (Zero outsourcing mandate; pitches will be ignored)
- **Accounts Executive** / **Junior Accountant** (Views outsourcing as a threat to their job)
- **HR Manager** / **Talent Acquisition** (Looking to fill vacancies, not hire accounting agencies)
- **Administrative Assistant** / **Receptionist**

---

## 4. Recognized Credibility Credentials

When pitching Singapore and Australian business owners, always reference the qualifications of our reviewing accounting partners:

1. **CA (Singapore) / ISCA:** The Institute of Singapore Chartered Accountants. The gold-standard domestic qualification recognized by ACRA.
2. **ACCA (Association of Chartered Certified Accountants):** Globally recognized; the standard qualification for senior practitioners in Singapore and Malaysia.
3. **CPA Australia:** Widely held and respected by business owners across Singapore, Malaysia, and Australia.
4. **CA (Malaysia) / MIA:** Malaysian Institute of Accountants designation required for statutory signing.

---

## 5. Ultra-Lean Outbound Tech Stack (Hard Cap: < RM 200 / Month)

Bryan's strict operational budget limit is **RM 200 / month (~$49 USD / month)**.

### The Budget Blueprint:
| Component | Provider & Tier | Cost (USD) | Cost (MYR at 4.08) | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Secondary Domain** | Cloudflare Registrar (`.com`) | $0.83 / mo ($10/yr) | **RM 3.40 / mo** | Isolates outbound email from primary website domain (`openclose.sh`). |
| **Outbound Mailboxes** | **InboxKit** (2 x M365 Business mailboxes) | $6.00 / mo ($3/mailbox) | **RM 24.50 / mo** | Automated DNS & genuine M365 email accounts. Zero mailbox slot minimum. |
| **Sequencing Platform** | **Smartlead.ai** (Base Tier) | $39.00 / mo | **RM 159.10 / mo** | Connects both mailboxes, handles rotation, email warmup, and unibox. |
| **Email Verification** | **MillionVerifier** (Pay-as-you-go) | ~$1.00 / mo ($4.99/10k) | **RM 4.08 / mo** | Validates email syntax, MX, and SMTP deliverability before sending. |
| **Total Monthly Outlay** | | **$46.83 / mo** | **RM 191.08 / mo** | **Strictly under the RM 200/mo cap!** |

---

## 6. Complete Cloudflare DNS Setup Cheat Sheet (SPF, DKIM, DMARC, MX)

When configuring your secondary sending domain (e.g. `openclose.sh` or `openclose.sh`) in Cloudflare:

### 1. MX Records (Inbound Reply Routing)
*If using Microsoft 365 via InboxKit:*
- Type: `MX` | Name: `@` | Priority: `0` | Target: `<tenant-name>.mail.protection.outlook.com`

*If using Google Workspace:*
- Type: `MX` | Name: `@` | Priority: `1` | Target: `ASPMX.L.GOOGLE.COM`
- Type: `MX` | Name: `@` | Priority: `5` | Target: `ALT1.ASPMX.L.GOOGLE.COM`

### 2. SPF Record (Sender Policy Framework)
- Type: `TXT` | Name: `@`
- Value: `v=spf1 include:spf.protection.outlook.com ~all` *(for M365)*
- Value: `v=spf1 include:_spf.google.com ~all` *(for Google Workspace)*

### 3. DKIM Record (DomainKeys Identified Mail)
- Type: `CNAME` or `TXT` (Provided directly in your mailbox admin dashboard)
- Example for M365:
  - Name: `selector1._domainkey` | Target: `selector1-<domain-guid>._domainkey.<tenant>.onmicrosoft.com`

### 4. DMARC Record (Domain-based Message Authentication)
- Type: `TXT` | Name: `_dmarc`
- Value: `v=DMARC1; p=none; rua=mailto:dmarc@openclosehq.com; pct=100; sp=none`
- *Note:* Start with `p=none` for the first 30 days to monitor deliverability.

### 5. Custom Tracking Domain (CNAME)
- Type: `CNAME` | Name: `track` | Target: `custom.smartlead.ai`
- **CRITICAL CLOUDFLARE SETTING:** Set Proxy Status to **DNS Only (Grey Cloud)**, NOT Proxied (Orange Cloud), to allow SSL handshake.
