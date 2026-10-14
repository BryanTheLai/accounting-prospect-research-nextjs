# Appendix E: Legal, Privacy, Provider Policies & Deliverability Runbook

**Date of Runbook:** 2026-10-01  
**Project:** Outbounder Malaysian SME Accounting Outbound OS  
**Jurisdiction:** Malaysia (Primary) & International Sending Standards

---

## 1. Malaysian Legal & Privacy Framework (PDPA 2010 & 2024 Amendments)

*Disclaimer: This analysis provides technical and operational compliance guidance based on current statutes and regulatory releases. It does not constitute formal legal counsel.*

### Core Statutes:
1. **Personal Data Protection Act 2010 (Act 709 / PDPA):** Regulates the processing of personal data in commercial transactions.
2. **Personal Data Protection (Amendment) Act 2024 (Act A1723):** Passed in July 2024 and gazetted in August 2024; significantly increases non-compliance penalties up to **RM 1,000,000** and up to 3 years imprisonment, introduces mandatory 72-hour data breach notifications, and strengthens data subject rights.
3. **Communications and Multimedia Act 1998 (Act 588 / CMA):** Section 233 prohibits improper use of network facilities, including persistent transmission of unsolicited commercial communications that annoy or harass recipients.

### The "B2B Contact Information" Reality under Malaysian Law:
- **Generic Corporate Information:** Generic company contact details (`enquiry@company.com`, `info@company.com`, general office telephone lines) do **not** identify an individual and therefore do not fall within the definition of "personal data" under Section 4 of the PDPA.
- **Named Business Contacts:** Email addresses that identify a living individual (e.g. `tan.weiliang@company.com`, `shannon.choo@hydroball.com`) or direct mobile lines **ARE classified as personal data** under Malaysian law if processed in commercial transactions.
- **Section 43 (Direct Marketing Opt-Out):** A data subject has an absolute statutory right to issue a written notice requiring a data user to cease, or not begin, processing their personal data for direct marketing. Failure to comply with an opt-out notice is a direct statutory offense.

### Non-Negotiable System Compliance Rules for Outbounder:
1. **Frictionless Opt-Out in Every Message:** Every outbound email must conclude with an unambiguous, clear opt-out sentence:
   > *"If you would prefer not to receive updates regarding accounting support or partner matching, simply reply 'unsubscribe' and you will be permanently removed from all communications."*
2. **Zero Delay on Suppression:** When an opt-out request is received, the email and root domain must be added to the immutable suppression table (`suppression_list`) within **2 business hours**, halting all in-flight and future outreach across all projects.
3. **Sender Identification & Commercial Transparency:** Outbound emails must clearly state the commercial entity, sender identity, and a physical mailing address in the signature. Misleading headers or masked domain origins violate both PDPA and ESP anti-spam regulations.
4. **No Scraping Personal / Consumer Accounts:** Never scrape, enrich, or contact personal email addresses (`@gmail.com`, `@yahoo.com`, `@hotmail.com`) without verifiable prior consent. Outreach must be restricted strictly to corporate business domains.

---

## 2. Mailbox Provider Terms of Service & Acceptable Use Policies

### Google Workspace AUP & Spam Policies:
- **Policy:** Google Workspace's Acceptable Use Policy prohibits using services to send unsolicited bulk commercial email.
- **Enforcement Mechanisms:** Google relies on automated algorithmic detection rather than manual review:
  - If outbound messages trigger user spam reports exceeding **0.30%** (3 reports per 1,000 sent emails), the domain's reputation is downgraded to "Bad" or "Low" in Google Postmaster Tools.
  - If sudden spikes in outbound volume occur on newly provisioned accounts, Google imposes temporary sending limits (24-hour rate limiting) or administrative account suspensions.
- **Operational Rule:** Keep daily volume at **15–25 emails/day per mailbox**, ramp gradually over 3 weeks, and never send unverified generic blasts.

### Microsoft 365 Exchange Online Anti-Spam Guidelines:
- **Policy:** Microsoft prohibits sending unsolicited commercial emails and enforces an External Recipient Rate (ERR) limit of 2,000 external recipients per 24 hours.
- **Enforcement Mechanisms:** Exchange Online Protection (EOP) monitors outbound mail quality. If outbound emails generate high bounce rates (>4%) or trigger spam keywords, Microsoft places the mailbox into the **"Restricted Entities" quarantine**, preventing any further outbound email transmission until an administrator manually clears the flag.

---

## 3. Step-by-Step DNS Authentication & Setup Guide

For any secondary domain acquired for outbound outreach (e.g. `tryopenclose.com` or `tryopenclose.com`):

### Step 1: Registrar & DNS Configuration (Cloudflare)
1. Point domain nameservers to Cloudflare.
2. In Cloudflare DNS management, add the MX records provided by Google Workspace:
   - Priority 1: `ASPMX.L.GOOGLE.COM`
   - Priority 5: `ALT1.ASPMX.L.GOOGLE.COM`
   - Priority 5: `ALT2.ASPMX.L.GOOGLE.COM`
   - Priority 10: `ALT3.ASPMX.L.GOOGLE.COM`
   - Priority 10: `ALT4.ASPMX.L.GOOGLE.COM`

### Step 2: SPF Record Setup
Add a DNS TXT record at the root domain (`@`):
```text
v=spf1 include:_spf.google.com ~all
```
*Note: Never include more than 10 DNS lookups in an SPF record. Use `~all` (softfail) during ramp, transitioning to `-all` (hardfail) once all sending services are authenticated.*

### Step 3: DKIM Key Generation & Publishing
1. In Google Workspace Admin Console, navigate to `Apps > Google Workspace > Gmail > Authenticate email`.
2. Generate a 2048-bit DKIM key using selector `google`.
3. In Cloudflare DNS, add a TXT record:
   - Name: `google._domainkey`
   - Value: `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...`
4. Return to Google Admin Console and click **Start Authentication**.

### Step 4: DMARC Policy Deployment
Add a DNS TXT record at `_dmarc`:
```text
v=DMARC1; p=none; rua=mailto:dmarc-reports@openclosehq.com; pct=100; sp=none
```
*Start with policy `p=none` for the first 30 days to monitor aggregate delivery reports. Once SPF and DKIM pass with 100% alignment, upgrade policy to `p=quarantine`.*

### Step 5: Custom Tracking Domain (CNAME)
In Smartlead or Instantly, generate your custom tracking domain. Add a CNAME record in Cloudflare:
- Name: `track` (e.g. `track.openclosehq.com`)
- Target: `custom.smartlead.ai` (ensure Cloudflare proxy is set to **DNS Only / Grey Cloud**, not Orange Cloud, to allow SSL handshake).

---

## 4. Incident Response & Troubleshooting Playbooks

### Playbook A: Hard Bounce Spike (>3%)
1. **Immediate Action:** Pause the active campaign in Smartlead/Instantly immediately.
2. **Root Cause Analysis:** Export the bounce log. Check bounce error codes:
   - `550 5.1.1 User unknown`: The email address no longer exists (staff turnover or invalid scraping syntax).
   - `550 5.7.1 Service unavailable / Blocked`: The recipient server is blocking your IP or domain.
3. **Remediation:** Purge all unverified leads in the current batch. Re-run remaining leads through MillionVerifier. Resume campaign only when verified email rate is 100%.

### Playbook B: Recipient-Side Throttling or Deferrals (421 / 451 Errors)
1. **Symptoms:** Outbound emails are delayed or queued with "Temporarily deferred" messages.
2. **Root Cause:** Sending too many messages in a short burst from a single mailbox (the exact error observed in Outbounder's historical Gmail review).
3. **Remediation:**
   - In Smartlead, increase the minimum delay between emails from 30 seconds to **180–300 seconds (3 to 5 minutes)**.
   - Restrict sending window to local Malaysian business hours: **9:00 AM to 5:30 PM (MYT / UTC+8)**, Monday through Friday.
   - Distribute sends evenly across all active mailboxes using inbox rotation.
