# Appendix A: Current-State Data Inventory & Lead Quality Audit

**Date of Audit:** 2026-10-01  
**Project:** Outbounder Malaysian SME Accounting Outbound OS  
**Auditor:** Senior B2B Growth-Systems Researcher & Revenue Operator  
**Scope:** Forensic, read-only audit across `accounting-prospect-research`, `leadgen`, `outbounder-landing-page`, and related historical assets.

---

## 1. Inventory of Relevant Repositories, Workbooks & Assets

| Repository / Asset Path | Primary File(s) | Format & Size | Declared Role vs. Actual State |
| :--- | :--- | :--- | :--- |
| `accounting-prospect-research/` | `lead-routes/Outbounder_Lead_Routes.xlsx` | XLSX (5.2 MB) | **Active Route Register**: Pre-allocated with 20,001 rows; contains exactly **313 non-empty lead rows** and **6,542 rank history rows** across 29 research rounds (R01–R29). |
| `accounting-prospect-research/` | `master_leads.xlsx` | XLSX (5.2 MB) | **Consolidated Research Register**: Built on 2026-09-30 from 828 source files. Contains 5,074 master rows, 126 buyer signals, 7,013 route evidence records, and 17,891 legacy workbook rows. |
| `accounting-prospect-research/` | `lead-routes/OPEN_CLOSE_LEAD_GEN_GOAL_PROMPT.md` | Markdown (12 KB) | **Coordinator Prompt Pack**: 20-route agent prompt pack and coordinator rules. Run in discrete batches on Sept 26–27, 2026. |
| `accounting-prospect-research/` | `lead-routes/R01-RN.json` to `R29-RN.json` | JSON (~1.5 MB total) | **Batch Route Files**: Sourced candidate outputs from round 1 to 29. |
| `accounting-prospect-research/` | `baseline-research/` | CSV & Scripts (1.8 MB) | **Historical Baseline**: Contains `PROSPECTS_1000.csv` (1,000 raw directory rows from 2026-09-20), `SOURCE_LOG.md`, and `validate_research.py`. Historical reference only. |
| `accounting-prospect-research/` | `interviews/` | Markdown (8.5 KB) | **Primary Discovery Evidence**: Two qualitative interviews captured on 2026-09-30 (`hydroball-shannon-choo-2026-09-30.md` and `shiyi-aseline-accounting-shuqi-aunty.md`). |
| `leadgen/` | `stackifier/prospects.csv` | CSV (24 KB) | **Stackifier Niche Register**: 40 rows targeting B2B wholesalers/distributors in Klang Valley for order/invoice automation. |
| `leadgen/` | `stackifier/MEMORY.md` | Markdown (9.3 KB) | **Durable Agent Memory**: Logs for stackifier niche. Last updated 2026-09-09. |
| `leadgen/` | `stackifier/runs/` | Markdown | **Run Logs**: Last executed runs are dated 2026-09-08 (`2026-09-08-scout.md`, `2026-09-08-writer.md`). |
| `outbounder-landing-page/` | `index.html`, `llms.txt`, `llms-full.txt` | HTML / Text (48 KB) | **Public Offer & Claims**: Live service copy at `https://openclose.sh/`. Claims 40% savings, ACCA/ICAEW/CA/CPA review, US WhatsApp contact `+1 628 303 5544`. |

---

## 2. Authoritative Source of Truth & File Relationships

A major operational confusion in prior sessions was the relationship between `Outbounder_Lead_Routes.xlsx`, `master_leads.xlsx`, and `leadgen/stackifier/prospects.csv`. The exact relationships are mapped below:

```
[External Sources: JobStreet, Ricebowl, Google, Directories]
             │
             ▼
[lead-routes/R01-R29 JSON Batches]
             │ (append_route_batch.mjs)
             ▼
┌─────────────────────────────────────────────────────────────┐
│ lead-routes/Outbounder_Lead_Routes.xlsx                      │
│ - Canonical, active register for route-based accounting research │
│ - 313 populated candidate rows, 6,542 ranking events         │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼ (extract_inputs.py + build_master.mjs on 2026-09-30)
┌─────────────────────────────────────────────────────────────┐
│ master_leads.xlsx                                           │
│ - Downstream consolidated inspection & normalization register│
│ - 5,074 rows aggregated from 828 source files:               │
│   • 2,285 accounting provider/firm rows (partners/competitors) │
│   • 1,000 FMM directory rows (raw Malaysian manufacturers)   │
│   • 662 archived outreach rows                               │
│   • 313 rows from Outbounder_Lead_Routes.xlsx                 │
│   • 40 rows from leadgen/stackifier/prospects.csv           │
│   • 126 filtered rows in "Buyer Signals" sheet               │
└─────────────────────────────────────────────────────────────┘
                             ▲
                             │ (isolated niche - zero shared pipeline)
┌────────────────────────────┴────────────────────────────────┐
│ leadgen/stackifier/prospects.csv                            │
│ - Strict repository fence: targets invoice OCR / order entry │
│ - Not an accounting outsourcing register                     │
└─────────────────────────────────────────────────────────────┘
```

### Source-of-Truth Hierarchy:
1. **For Outbounder Route Research:** `lead-routes/Outbounder_Lead_Routes.xlsx` is the canonical operational register. It is the only file with active ranking formulas and round-by-round snapshots.
2. **For Cross-Project Inventory & Deduplication:** `master_leads.xlsx` is a point-in-time consolidated index (as of 2026-09-30). It is **not** a live CRM and must not be used as an operational sending register.
3. **For Stackifier:** `leadgen/stackifier/prospects.csv` is isolated to its niche. It has a strict repository fence and must not be merged into Outbounder accounting outreach.

---

## 3. Forensic Data Breakdown & Current Lead Counts

A forensic audit of the records using read-only Python scripts (`inspect_routes_lead_register.py` and `inspect_master_leads.py`) established the following counts as of 2026-10-01:

### A. Active Route Register (`Outbounder_Lead_Routes.xlsx`)
- **Total Physical Rows:** 20,001 (table grid pre-allocated).
- **Populated Non-Empty Rows:** **313**.
- **Unique Lead IDs:** 313 (100% unique ID integrity).
- **Unique Normalized Companies:** 313.
- **Unique Root Domains (excluding unknown):** 273 (40 companies share no independent web domain or use free social/marketplaces).
- **Named Economic Decision Makers:** **1** (99.7% of rows list `UNKNOWN` for named contact).
- **Public Business Contacts Present:** 297 rows (94.9%). However, breakdown reveals:
  - Generic company emails (`enquiry@`, `info@`, `admin@`, free `@gmail.com`): ~110 rows.
  - General office telephone numbers only: ~120 rows.
  - Marketplace seller chat paths (Shopee, Lazada, Facebook): ~25 rows.
  - Web contact forms: ~42 rows.
- **DNC / Suppression Verification:** **0 of 313 checked** (100% marked `"Not checked"`).
- **Prior Contact Verification:** **0 of 313 checked** (100% marked `"Not checked"`).
- **Lead Stage Distribution:**
  - `Hold`: **216** (69.0%) — Sourced, but SME revenue fit, contact ownership, or scope is unverified.
  - `Raw candidate`: **66** (21.1%) — Needs independent evidence reopening and dedupe.
  - `Legacy dedupe pending`: **29** (9.3%) — Pending match against legacy lists.
  - `Signal verified`: **2** (0.6%) — Workload verified, but buyer route unverified.
  - `Qualified / Ready to Send`: **0 (0.0%)**.

### B. Consolidated Master Register (`master_leads.xlsx`)
- **Total Master Leads Rows:** 5,074.
- **Source Breakdown:**
  - Historical accounting provider/firm observations: **2,285** (45.0%) — Note: These are accounting firms, secretarial firms, and Xero partners (potential delivery partners or competitors, **not** SME buyers).
  - Historical SME directory observations (FMM directory): **1,000** (19.7%) — Raw directory listings with zero verified accounting pain or hiring intent.
  - Historical outreach / lead observations: **662** (13.0%) — Legacy tests from earlier workbooks.
  - Current & historical route observations: **808** (15.9%).
  - Leadgen prospect observations: **40** (0.8%).
  - Other: **279** (5.5%).
- **Contact Usability in Master Leads:**
  - Rows with usable email: 1,519 (29.9%).
  - Rows with telephone: 2,286 (45.1%).
  - Rows with named person: 2,877 (56.7% — heavily skewed by accounting partner directories where partners list their names).
  - Unique normalized domains: 1,910 across 3,192 valid domain entries.
- **"Buyer Signals" Filtered Sheet:**
  - Total records: **126** (all derived from `Outbounder_Lead_Routes.xlsx`).
  - Named buyer present: **1** (0.8%).
  - Public email present: 82 (65.1%).
  - Stage: 95 on Hold, 29 Legacy dedupe pending, 2 Signal verified, **0 Ready to Send**.

### C. Leadgen Stackifier Register (`leadgen/stackifier/prospects.csv`)
- **Total Records:** 40.
- **Named Buyer Verified:** 7 rows (17.5%), of which 2 are quarantined in `needs-human` due to circular evidence. 33 rows have buyer = `Unable to verify` (persona placeholders only).
- **Tiers:** Tier A = 10, Tier B = 25, Tier C = 5.
- **Target Persona:** Wholesale/manufacturing companies (order-intake automation), not accounting partner matching.

---

## 4. Automation Verification: Reality vs. Aspiration

The prompt explicitly requires: *"Identify existing automation that actually runs, its schedule/runtime/dependencies, and what is only aspirational or documented. Do not claim '24/7' unless verified."*

### Empirical Verification Findings:
1. **Windows Task Scheduler:** An inspection of Windows Task Scheduler (`Get-ScheduledTask`) found **zero active tasks** registered for leadgen, outbounder, scrape, paseo, or codex.
2. **Local Background Processes:** Running processes include node runtimes for local MCP servers (Google Ads, DaVinci Resolve) and OpenAI Codex sandbox runtimes. No crawler, scraper, or scheduler process was executing.
3. **Paseo Cloud Schedules (`leadgen`):** The repository documentation describes 5 scheduled workers (Scout, Writer, Designer, Responder, Analyst). However, run logs in `leadgen/stackifier/runs/` confirm the last executed run was on **2026-09-08** (23 days ago). Local execution halted following the Phase 3 dry-run.
4. **Route Generation (`accounting-prospect-research`):** Batches R01 through R29 were executed manually or via prompt sessions on **2026-09-26 and 2026-09-27**. No cron or continuous scraper has run since.
5. **Verdict:** **There is currently NO 24/7 or continuous automation running.** All lead generation was executed in manual, operator-initiated prompt batches. Describing the system as "continuously scraping 24/7" is completely ungrounded.

---

## 5. Lead Quality & Buyer Signal Analysis

### The "Accounts Clerk Hiring" Signal Deconstructed
The core hypothesis of Outbounder's route research has been: *"Find Malaysian SMEs hiring Accounts Assistants, Accounts Clerks, or Bookkeepers, and offer them outsourced accounting support."*

A critical review of the 313 route records reveals why this hypothesis has severe commercial conversion friction:
1. **Clerk Hiring $\neq$ Outsourcing Intent:**
   - Every single evaluated record in `Outbounder_Lead_Routes.xlsx` carries the explicit note: *"Hiring indicates workload only; outsourcing intent is not established."*
   - In Malaysian SMEs (20–100 staff), an "Accounts Clerk" earning RM2,000–RM3,000/month is rarely doing pure double-entry bookkeeping. They issue physical delivery orders, answer the office phone, chase warehouse paperwork, prepare payment vouchers, and run daily banking errands.
   - Outsourcing the accounting ledger to an external firm does **not** eliminate the SME owner's need for an on-site administrative clerk.
2. **The "Wrong Recipient" Trap:**
   - Public job postings on JobStreet, Ricebowl, and Maukerja list the HR department, hiring manager, or a generic recruiting inbox (`hr@company.com`, `careers@company.com`).
   - Sourcing these contact paths results in emailing HR personnel who have zero mandate or authority to outsource the company's financial operations.
3. **The Missing Economic Buyer:**
   - 312 out of 313 records lack a named decision-maker (Managing Director, Owner, Founder, or Finance Director).
   - Cold emails sent to `enquiry@` or `info@` asking if the company wants to outsource its accounting have an estimated positive response rate of <0.5%.

### Top 5 Failure Modes Preventing Records from Being "Ready to Send"
1. **Unidentified Economic Buyer (99.7% of records):** Only generic business contacts exist; decision-maker identity is unmapped.
2. **Unverified SME Revenue Fit (68.4% of records):** Company turnover is unknown. Sourcing includes micro-enterprises (turnover <RM300k, unable to afford retainers) and large groups (turnover >RM50m, requires full-time in-house department).
3. **Zero DNC & Prior-Contact Scrubbing (100% of records):** No cross-check has been performed against past outreach logs, bounced addresses, or opt-out requests.
4. **Channel Mismatch (18.5% of records):** Contact routes include Shopee/Lazada marketplace seller chats or generic web forms where B2B sales pitches violate platform terms.
5. **Stale Evidence Risk:** Many job postings captured in earlier September batches may already be filled or closed, rendering the timing hook obsolete.

---

## 6. Small Recommended Next Research Batch

Before any sending infrastructure is purchased, Bryan should run a small, highly targeted research batch of **25 high-probability accounts** following strict qualification criteria:

### Target Profile:
- **Sector:** B2B Trading, Engineering Services, Wholesale Distribution, or Professional Services in Klang Valley.
- **Headcount:** 15 to 60 employees (large enough to have painful transaction volume, small enough that the Owner/MD is directly reachable).
- **Core Signal (Dual Hook):**
  1. Active accounting workload (e.g. hiring accounts staff OR explicit mention of AutoCount/SQL Account/UBS).
  2. Public trigger event: LHDN e-invoicing Phase 2/3 compliance deadline pressure, or recent new branch opening.
- **Required Data Standards Before Approval:**
  - Named Owner, Managing Director, or Partner (verified via SSM registry, company website "About Us", or LinkedIn).
  - Verified business email (direct or dedicated executive inbox; syntax + MX + SMTP ping passed).
  - Verified WhatsApp mobile number for follow-up.
  - Zero match in historical suppression / prior contact.
