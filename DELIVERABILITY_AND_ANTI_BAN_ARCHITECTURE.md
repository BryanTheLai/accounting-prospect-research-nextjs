# Outbounder Outbound OS: Master Deliverability & Anti-Ban Architecture
**Platform:** Microsoft 365 Exchange Online Protection (EOP)  
**Primary Domain:** `openclose.sh` (Targeting Singapore ⇄ Malaysia SME Corridor)  
**Philosophy:** Zero-SaaS (< RM20/mo), Single-Inbox Survival, High-Conversion Psychology  

---

## 1. Executive Summary & Deliverability Baseline
A single fresh domain and inbox cannot be treated like a high-volume marketing list. Sending cold outreach on Microsoft 365 without rigorous cryptographic alignment, behavioral pacing, and volume caps will trigger **Exchange Online Protection (EOP) Rule 550 5.1.8 (Bad Outbound Sender)** or silently divert outbound messages to the **High-Risk Delivery Pool (HRDP)**.

This operating architecture codifies the technical standards, human simulation heuristics, template engineering, and operational governance required to achieve 98%+ primary inbox placement.

---

## 2. Technical Infrastructure & DNS Cryptography

### 2.1 The Cryptographic Holy Trinity
Every outbound message must achieve strict domain alignment across three RFC standards:
1. **Sender Policy Framework (SPF - RFC 7208):**
   - Record: `v=spf1 include:spf.protection.outlook.com -all`
   - Target: `openclose.sh`
   - Hard-Fail (`-all`): Explicitly instructs receiving mail transfer agents (MTAs) to reject any server attempting to spoof your domain.
2. **DomainKeys Identified Mail (DKIM - RFC 6376):**
   - Two 2048-bit RSA keys published via CNAME records:
     - `selector1._domainkey.openclose.sh` ➔ `selector1-openclose.sh._domainkey.openclose.sh`
     - `selector2._domainkey.openclose.sh` ➔ `selector2-openclose.sh._domainkey.openclose.sh`
   - Status: Enabled and actively signing in Microsoft Defender (`security.microsoft.com`).
3. **Domain-based Message Authentication, Reporting & Conformance (DMARC - RFC 7489):**
   - Record: `v=DMARC1; p=none; pct=100; sp=none; rua=mailto:dmarc@openclose.sh; aspf=r; adkim=r;`
   - Ramp Protocol: Maintain `p=none` for Days 1–14 to monitor alignment reports. Once confirmed zero spoofing or SPF/DKIM misalignments occur, harden to `p=quarantine`.

### 2.2 Mailbox Identity & Header Hygiene
- **User Principal Name (UPN) Alignment:** The primary SMTP login and display envelope sender must be `BryanLai@openclose-desk.com`.
- **Bot Header Stripping:** Standard Python `smtplib` scripts inject `X-Mailer: Python/3.12` or `User-Agent`. These headers are immediate spam indicators. All bot headers are completely omitted by the Outbounder Dispatcher.
- **RFC 5322 Message-ID:** Generated with high entropy tied to the sending domain:
  `Message-ID: <[uuid4].[timestamp]@openclose-desk.com>`.

---

## 3. The 30-Day Domain & Mailbox Ramp Schedule

| Phase | Days | Daily Cold Outbound Cap | Hourly Cap | Delay Jitter Range | Key Milestone |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **0. Propagation** | Day 0 | 0 emails | 0/hr | N/A | DNS propagated globally; send 1 manual probe to personal Gmail. |
| **1. Seeding** | Day 1–3 | 0 cold emails | 0/hr | N/A | Peer-to-peer warmup / internal exchanges only. |
| **2. Micro-Ramp** | Day 4–7 | **5 emails/day** | 2/hr | 180s – 360s | Send exclusively to top JobStreet verified hiring pain targets. |
| **3. Linear Scale** | Day 8–14 | **10–15 emails/day** | 3/hr | 120s – 240s | Introduce software-native wedge (AutoCount / SQL Account). |
| **4. Steady State** | Day 15–30 | **20–25 emails/day** | 4–5/hr | 90s – 210s | Monitor bounce rate (<1%) and prospect replies. |
| **5. Mature Ceiling**| Day 31+ | **30–35 emails/day MAX** | 5/hr | 90s – 180s | Hard permanent ceiling for a single M365 mailbox. |

> **Horizontal Scaling Law:** To send 100 emails per day, operate **4 distinct mailboxes** sending 25 emails/day each. Never push 1 single inbox past 35 cold emails/day.

---

## 4. Human Simulation Mechanics (Bypassing EOP AI)

```
┌────────────────────────────────────────────────────────────────────────┐
│                   BEHAVIORAL SIMULATION MATRIX                         │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Poisson / Exponential Distribution:                                │
│    Simulates non-deterministic human arrival delays instead of         │
│    detectable periodic loops (sleep(120)).                             │
│                                                                        │
│ 2. Context-Switch Coffee Breaks:                                       │
│    Automatically triggers a 12 to 20-minute refractory cooldown       │
│    after every 4 consecutive sends.                                    │
│                                                                        │
│ 3. Singapore / Malaysia Business Hours Gatekeeper:                     │
│    Dispatches strictly between 09:00 - 17:30 SGT (UTC+8), Mon-Fri.     │
│    Pauses automatically during evenings, weekends, and holidays.       │
│                                                                        │
│ 4. 48-Hour Company Domain Cooldown:                                    │
│    Enforces a strict lock preventing contact with more than 1 person   │
│    at the same company domain within a 48-hour rolling window.         │
│                                                                        │
│ 5. Automated 421 / 451 Greylist Backoff:                              │
│    If M365 reports temporary server load or greylisting, backs off     │
│    for 180s * (2 ^ attempt) + jitter instead of hammering.            │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Template & Prompt Engineering (The 3 Core Pitch Angles)

### Angle 1: The Active JobStreet Hiring Pain Reverse Pitch
*Target Audience:* Companies currently advertising for an Accounts Assistant / Clerk on JobStreet or LinkedIn.  
*Core Psychology:* You are not selling software; you are eliminating an active, expensive recruitment pain.

```
Subject: Quick question regarding {{company_name}}'s hiring on JobStreet

Hi {{buyer_name}},

Saw that {{company_name}} is currently looking for an accounts assistant on JobStreet.

Most cross-border Managing Directors tell us that finding a reliable full-time accountant in Johor is a headache, especially when the local entity only generates 10 to 20 monthly transactions, and paying RM3,500/mo plus EPF and software seats for low monthly volume is inefficient.

We provide a dedicated done-for-you bookkeeping desk reviewed by certified chartered accountants (ACCA, CA Singapore) starting at RM800/mo (~S$250/mo), handling your monthly ledger, SST filing, and audit-ready schedules natively in AutoCount, SQL, or Xero.

Would you be open to a 10-minute Zoom next Tuesday to see if we can take this hiring headache off your plate?

Best regards,
Bryan
Founder, Outbounder (openclose.sh)

P.S. If you already filled the position, just reply and I won't follow up.
```

---

### Angle 2: The Cross-Border SG HQ + Johor Factory Arbitrage (The 15-Invoice Wedge)
*Target Audience:* Singapore companies operating manufacturing facilities, warehouses, or assembly lines in Senai, Pasir Gudang, or Kulai.  
*Core Psychology:* Expose the inefficiency of a full-time resident hire when monthly transaction volume is low.

```
Subject: Question on {{company_name}}'s Johor subsidiary books

Hi {{buyer_name}},

Saw that {{company_name}} operates across Singapore and Johor.

Most SG Managing Directors we speak with running a JB facility only generate 5 to 15 Malaysian expenses a month, making a full-time RM3.5k accountant in Johor wasteful, while Singapore accounting firms bill in SGD.

We provide done-for-you bookkeeping, SST filing, and audit-ready accounts handled by certified chartered accountants (ACCA, CA Singapore) starting at RM800/mo (~S$250/mo), natively on Xero, AutoCount, or SQL Account.

Would it make sense to take 10 minutes next Tuesday to see if we can take the Malaysian compliance off your plate?

Cheers,
Bryan
Founder, Outbounder (openclose.sh)

P.S. If you'd prefer I don't follow up, just let me know.
```

---

### Angle 3: The Software-Native Ledger Modernization
*Target Audience:* Established Malaysian and cross-border companies using legacy desktop accounting setups (AutoCount, SQL Account, Bukku).  
*Core Psychology:* Zero-friction ledger maintenance without migrating or changing their existing accounting software.

```
Subject: Question on {{company_name}}'s {{accounting_software}} ledger

Hi {{buyer_name}},

Noticed that {{company_name}} utilizes {{accounting_software}} for your regional accounting.

Managing Malaysian SST filings and cross-border expense reconciliations often creates friction between SG management and local bookkeepers, leading to messy statutory audit adjustments at year-end.

Our team plugs directly into your {{accounting_software}} ledger to maintain clean, real-time management accounts for RM800 to RM1,200/mo, supervised by CA Singapore and ACCA professionals with zero software migration required.

Open to a brief 10-minute chat next week to see how we streamline Malaysian books for SG teams?

Regards,
Bryan
Founder, Outbounder (openclose.sh)

P.S. Reply 'stop' and I will not contact you again.
```

---

## 6. The Master 100-Point Deliverability & Anti-Ban Checklist

### I. Infrastructure & DNS Alignment
- [x] 1. SPF record configured with `-all` hard fail mechanism.
- [x] 2. DKIM custom CNAME key pairs generated in Microsoft Defender.
- [x] 3. DKIM selector resolution verified externally via 1.1.1.1.
- [x] 4. DMARC policy published with `p=none` and valid reporting email.
- [x] 5. MX record priority 0 pointing to Exchange Online Protection (`mail.protection.outlook.com`).
- [x] 6. Autodiscover CNAME configured for Outlook endpoint resolution.
- [x] 7. Cloudflare DNS proxy mode set to **DNS Only (Grey Cloud)** for mail records.
- [x] 8. Domain root CNAME flattening verified (`openclose-desk.com` ➔ `openclose.sh`).
- [x] 9. Corporate egress IPs verified via Microsoft M365 infrastructure.
- [x] 10. Secondary domain isolation protecting primary brand (`openclose.sh`).
- [x] 11. Zero tracking domain CNAMEs on fresh 0-day domain.
- [x] 12. STARTTLS mandatory on port 587.
- [x] 13. Forward-confirmed reverse DNS (FCrDNS) handled by Microsoft transport.
- [x] 14. IPv4 and IPv6 dual-stack resolution enabled.
- [x] 15. WHOIS privacy enabled via Cloudflare Registrar.

### II. Mailbox & Identity Security
- [x] 16. User Principal Name (UPN) matches primary outbound address (`BryanLai@openclose-desk.com`).
- [x] 17. Authenticated SMTP explicitly enabled on CAS mailbox in M365 Admin Center.
- [x] 18. Secure credential storage via local `.env` and environment variables.
- [x] 19. Dedicated M365 App Password generation for 2FA-secured tenants.
- [x] 20. Elimination of shared marketing IPs (no SendGrid/Mailchimp shared pools).
- [x] 21. Single active SMTP connection per session (zero connection flooding).
- [x] 22. SMTP session gracefully terminated with `QUIT` after each dispatch batch.
- [x] 23. Outbound spam filter alerts configured in Microsoft Defender Security Center.
- [x] 24. No suspicious display name variations (consistent `Bryan @ Outbounder`).
- [x] 25. Daily mailbox cap hard-locked at 25 sends/day.

### III. Rate Limiting & Velocity Controls
- [x] 26. Maximum hourly cap hard-locked at 5 sends/hour.
- [x] 27. Minimum delay floor of 60 seconds between any two outbound emails.
- [x] 28. Refractory pause of 12–20 minutes after every 4 consecutive sends.
- [x] 29. Exponential backoff on transient M365 421/451 deferrals.
- [x] 30. Auto-pause circuit breaker tripped after 3 consecutive deferrals.
- [x] 31. Single-threaded dispatch queue preventing concurrency spikes.
- [x] 32. 48-hour cooldown per company domain.
- [x] 33. Total suppression of weekend sending (Saturday and Sunday).
- [x] 34. Singapore / Malaysia public holiday blackout enforcement.
- [x] 35. Ramp-up velocity capped at +2 emails/day during the initial 14 days.

### IV. Behavioral Pacing & Human Simulation
- [x] 36. Non-deterministic Poisson/exponential arrival delays.
- [x] 37. Gaussian micro-noise (±3 to 8 seconds) injected into every sleep interval.
- [x] 38. Stochastic morning dispatch start (between 09:12 and 09:34 SGT).
- [x] 39. Stochastic evening dispatch termination (between 17:08 and 17:26 SGT).
- [x] 40. Mid-day lunch window slowdown (12:30 to 14:00 SGT).
- [x] 41. In-process background worker daemon surviving browser tab closure.
- [x] 42. Thread-safe state locks preventing duplicate send threads.
- [x] 43. 1-click Emergency Stop button responsive within 500ms.
- [x] 44. Pause and resume stateful toggles without losing queue position.
- [x] 45. Live sub-second countdown timer rendered via `@st.fragment(run_every="1s")`.

### V. Email Header & Envelope Discipline
- [x] 46. Stripping of `X-Mailer` headers (no `Python/smtplib` signatures).
- [x] 47. Stripping of `User-Agent` headers.
- [x] 48. RFC 5322 compliant `Message-ID` referencing `@openclose-desk.com`.
- [x] 49. RFC 5322 `Date` header formatted with local time zone offset.
- [x] 50. Strict alignment between RFC 5321 `MAIL FROM` and RFC 5322 `From:`.
- [x] 51. Plain text format (`MIMEText("plain", "utf-8")`) for maximum inbox delivery.
- [x] 52. Zero attachments (no PDF, DOCX, or ZIP payloads in cold email #1).
- [x] 53. Zero 1x1 open-tracking pixel images.
- [x] 54. Zero click-tracking redirects or URL rewrites.
- [x] 55. Clean UTF-8 encoding preventing garbled characters (`=20`, `&amp;`).

### VI. Content Entropy & Anti-Spam Language
- [x] 56. Multi-tier recursive Spintax on salutation, problem, pitch, and CTA.
- [x] 57. Dynamic company name cleaning (stripping legal suffixes like `Sdn Bhd`).
- [x] 58. Ban on financial trigger tokens (`$`, `USD`, `SGD`, `RM` in subject lines).
- [x] 59. Ban on urgency buzzwords (`urgent`, `act now`, `expires today`).
- [x] 60. Ban on sales cliches (`100% guaranteed`, `no risk`, `free trial`).
- [x] 61. Ban on URL shorteners (`bit.ly`, `tinyurl.com`, `t.co`).
- [x] 62. Zero outbound hyperlinks in the initial outreach message.
- [x] 63. Sentence length variation (alternating 6-word and 18-word phrases).
- [x] 64. Professional, understated founder sign-off (`Bryan, Founder, Outbounder`).
- [x] 65. Friction-free opt-out notice (`P.S. If you'd prefer I don't follow up, let me know`).

### VII. Lead Quality & Bounce Shield
- [x] 66. Pre-flight RFC 5322 email syntax validation prior to dispatch.
- [x] 67. Lead list deduplicated globally in SQLite `leads.db`.
- [x] 68. Immediate permanent quarantine of 550 hard bounce recipients.
- [x] 69. Cross-referencing against verified JobStreet hiring listings.
- [x] 70. Exclusion of generic role addresses (`info@`, `admin@`, `support@`).
- [x] 71. Exclusion of disposable email domains (`mailinator`, `trashmail`).
- [x] 72. Decision-maker targeting (Managing Director, Founder, General Manager).
- [x] 73. High-intent corridor targeting (Singapore HQ with Johor facility).
- [x] 74. Quality score filtering (minimum score threshold enforced in UI).
- [x] 75. Maintenance of hard bounce rate strictly below 1.0%.

### VIII. Storage & Database Concurrency
- [x] 76. SQLite Write-Ahead Logging (`PRAGMA journal_mode = WAL;`).
- [x] 77. Database busy timeout set to 5000ms (`PRAGMA busy_timeout = 5000;`).
- [x] 78. Atomic logging of every send event with timestamp, subject, and status.
- [x] 79. Permanent suppression table preventing accidental duplicate contacts.
- [x] 80. Real-time daily send count calculated via localized SQL queries.
- [x] 81. Rolling hourly send calculation via SQLite time offsets.
- [x] 82. Non-blocking database reads for UI telemetry fragments.
- [x] 83. Schema indexing on `recipient_email` and `sent_at`.
- [x] 84. Lead status tracking synced with master CRM pipeline.
- [x] 85. Persistent error message capture for automated troubleshooting.

### IX. Multi-Channel & Sales Velocity
- [x] 86. Integrated 1-click direct phone call trigger in Cockpit (`tel:+60...`).
- [x] 87. 45-second phone script mapped directly to company wedge.
- [x] 88. 1-click LinkedIn profile discovery for key decision makers.
- [x] 89. Single-lead live preview drawer with inline editable copy.
- [x] 90. Personal email test-dispatch capability from the UI.
- [x] 91. 1-click quick selection of top 5 JobStreet hiring targets.
- [x] 92. Synchronized `master_leads.xlsx` pipeline export.
- [x] 93. Dynamic rendering of target accounting software logos.
- [x] 94. Interactive Tinder-style lead review (**🔥 Lead Swipe**).
- [x] 95. Visual pitch collateral generator and downloadable PDF flyers.

### X. Reputation Governance & Recovery Protocols
- [x] 96. Microsoft Defender Restricted Entities monitoring procedure.
- [x] 97. High-Risk Delivery Pool (HRDP) detection and emergency shutdown logic.
- [x] 98. Google Postmaster Tools reputation tracking readiness.
- [x] 99. Spamhaus ZEN and Barracuda Central reputation checking protocols.
- [x] 100. Ultimate north-star alignment: Focus on **paying cross-border retainer clients**, not vanity volume metrics.
