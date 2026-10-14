# Appendix B: Funnel Economics, Capacity & Outbound Volume Models

**Date of Model:** 2026-10-01  
**Project:** Outbounder Malaysian SME Accounting Outbound OS  
**Benchmark Currency Rate:** 1 USD = 4.08 MYR (Bank Negara Malaysia reference benchmark late Sept / Oct 1 2026)

---

## 1. Outbound Volume Decomposition: Modeling 500 Messages / Week

The prompt specifies modeling up to 500 outbound email messages per week. A critical failure mode in outbound sales modeling is confusing **total email messages sent** with **unique first-touch prospects**.

In a professional B2B email sequence, prospects receive multiple touches over a structured cadence (e.g. initial outreach + 1 to 3 follow-ups). If every follow-up is counted as a "new prospect," capacity is miscalculated by 200% to 400%.

### Mathematical Volume Model (500 Sends / Week = 100 Sends / Day over 5 Business Days)

Let $P$ be the number of unique first-touch prospects introduced each week at steady state.  
Accounting for attrition:
- Step 1: Delivered to $P$. Bounces ($b = 3\%$), Opt-outs ($o_1 = 1\%$), Positive/Negative Replies ($r_1 = 2\%$). Eligible for Step 2 = $P \times (1 - 0.06) = 0.94 P$.
- Step 2: Delivered to $0.94 P$. Opt-outs ($o_2 = 1\%$), Replies ($r_2 = 1.5\%$). Eligible for Step 3 = $0.94 P \times (1 - 0.025) = 0.916 P$.
- Step 3: Delivered to $0.916 P$.

| Sequence Structure | Total Weekly Outbound | Unique First-Touch Prospects / Week | Follow-Up Touches / Week | Unique Prospects / Month (4.33 wks) | Active In-Flight Leads in Pipeline |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1 Touch (No follow-up)** | 500 | **500** | 0 | 2,165 | 500 |
| **2 Touches (Initial + 1 follow-up)** | 500 | **258** | 242 | 1,117 | 500 |
| **3 Touches (Initial + 2 follow-ups) [Standard]** | 500 | **174** | **326** | **755** | **500** |
| **4 Touches (Initial + 3 follow-ups)** | 500 | **133** | 367 | 576 | 500 |

### Crucial Operational Takeaways:
1. Under an industry-standard **3-touch sequence** (Day 1, Day 4, Day 8), **500 total sends/week requires only 174 unique qualified prospects per week** (~35 per business day).
2. The remaining 326 sends per week are automated follow-ups sent to non-responders.
3. Attempting to source 500 *unique* qualified Malaysian SME accounting prospects every week (2,165/month) will exhaust the reachable target market within 60 to 90 days. Sourcing 174 carefully vetted, high-fit accounts per week is sustainable and preserves list quality.

---

## 2. Mailbox and Domain Capacity Architecture

### Challenging the "50 Sends / Day / Mailbox" User Hypothesis
A common user assumption in cold email discussions is that an inbox can safely dispatch 50 cold emails per day. In 2026, **this assumption is extremely dangerous and empirically disproven by email service provider (ESP) enforcement data**.

#### Evidence Against 50 Sends/Day on Cold Infrastructure:
1. **Google Email Sender Guidelines (Updated 2024–2026):**
   - Google strictly enforces a **0.30% maximum spam complaint threshold** as measured in Google Postmaster Tools. Google strongly recommends keeping complaint rates below **0.10%** (1 complaint per 1,000 emails).
   - At 50 emails/day per mailbox (1,000 emails/month per mailbox), **just 3 spam complaints across an entire month pushes the mailbox to 0.30%**, triggering domain-wide spam folder placement or account suspension.
2. **Microsoft 365 Exchange Online Limits & Enforcement:**
   - Microsoft enforces an External Recipient Rate (ERR) limit of 2,000 external recipients per 24 hours. While 50/day is well below the hard cap, Microsoft's automated outbound spam heuristics monitor sending patterns.
   - Mailboxes sending identical templates to unengaged external recipients trigger behavioral flags, placing the account into the admin "Restricted Users" quarantine.
3. **Practitioner Consensus (Reddit ColdEmailing & Deliverability Engineers):**
   - Sustainable sending capacity for cold outreach mailboxes is **15 to 25 cold emails per day** (excluding warmup traffic).
   - Above 35 sends/day, inbox lifespan drops precipitously, with domains burning within 6 to 12 weeks.

### Mailbox and Domain Requirements Matrix

To send 100 emails/day (500/week) across 5 business days:

| Strategy | Daily Capacity / Mailbox | Mailboxes Required | Secondary Domains Required | Mailbox Distribution | Risk Level & Expected Lifespan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Conservative (Recommended)** | **20 sends/day** | **5 mailboxes** | **2 domains** | Domain 1: 3 inboxes<br>Domain 2: 2 inboxes | **Low Risk.** Clean reputation; 12+ month domain stability. |
| **Moderate** | **25 sends/day** | **4 mailboxes** | **2 domains** | Domain 1: 2 inboxes<br>Domain 2: 2 inboxes | **Moderate Risk.** Requires strict bounce (<2%) and reply monitoring. |
| **Aggressive (User Hypothesis)** | **50 sends/day** | **2 mailboxes** | **1 domain** | Domain 1: 2 inboxes | **High Risk.** Likely spam folder placement within 4–8 weeks; high burn rate. |
| **Pilot Phase (Week 1–4)** | **15–20 sends/day** | **2 mailboxes** | **1 domain** | Domain 1: 2 inboxes | **Minimal Risk.** 30–40 sends/day (150–200/wk). Ideal for initial offer testing. |

---

## 3. Funnel Math: What Must Be True to Win 2 New Clients / Week?

The user goal states: *"A target of two new clients per week, with explicit funnel math showing what must be true for that target to happen."*

We model the path from unique prospect to closed client across three transparent scenarios:
1. **Low Scenario:** Scraped directory emails, unverified economic buyer, generic outreach template.
2. **Base Scenario:** Workload-signaled accounts, verified Owner/MD, personalized trigger-based hook.
3. **High Scenario:** Urgent event trigger (e-invoicing audit notice, accounting resignation), direct executive contact, strong offer fit.

### Funnel Conversion Rates & Outcomes

| Conversion Stage | Low Scenario | Base Scenario | High Scenario | Description / Evidence Basis |
| :--- | :--- | :--- | :--- | :--- |
| **Delivery Rate ($D$)** | 90.0% | 96.0% | 98.0% | Low reflects unverified directory scrape; Base reflects multi-engine verification. |
| **Positive Reply Rate ($R_{pos}$)** | 0.50% | 2.00% | 4.00% | Percentage of delivered unique prospects expressing commercial interest. |
| **Meeting Booking Rate ($M_{book}$)** | 40.0% | 60.0% | 70.0% | Conversion from positive reply to scheduled discovery call. |
| **Meeting Show Rate ($M_{show}$)** | 60.0% | 75.0% | 85.0% | Prospects who actually attend the scheduled call. |
| **Proposal Rate ($Prop$)** | 50.0% | 70.0% | 80.0% | Qualified calls that advance to a formal pricing/scope proposal. |
| **Proposal Close Rate ($Close$)** | 20.0% | 30.0% | 40.0% | Proposals that convert into a signed contract / paid retainer. |
| **Cumulative Conversion ($P \to \text{Client}$)** | **0.0108%** | **0.1814%** | **0.7464%** | **Product of all intermediate stage conversion probabilities.** |
| **Unique Prospects Needed for 1 Client** | **9,259** | **551** | **134** | Calculated as $1 / \text{Cumulative Conversion}$. |

### Funnel Yield Under 500 Outbound Sends / Week

#### Under Standard 3-Touch Sequence (174 Unique Prospects / Week):
- **Low Scenario:** 0.019 clients/week $\implies$ **1 client every 53 weeks** (~0.08 clients/month).
- **Base Scenario:** 0.316 clients/week $\implies$ **1 client every 3.2 weeks** (~1.37 clients/month).
- **High Scenario:** 1.302 clients/week $\implies$ **1.3 clients/week** (~5.64 clients/month).
- **Prospects Needed for 2 Clients/Week:**
  - Base Scenario requires **1,102 unique prospects/week** (which translates to ~3,150 total outbound sends/week under 3 touches!).
  - High Scenario requires **268 unique prospects/week** (which translates to ~768 total outbound sends/week).

#### Under 1-Touch Sequence (500 Unique Prospects / Week):
- **Low Scenario:** 0.054 clients/week (1 client every 19 weeks).
- **Base Scenario:** 0.907 clients/week (~3.93 clients/month, or ~1 client/week).
- **High Scenario:** 3.732 clients/week (~16.16 clients/month).

### The Mathematical Verdict on the "2 Clients / Week" Target:
To close 2 new clients per week from 500 total weekly sends (174 unique prospects under a standard 3-touch sequence), the required prospect-to-client conversion rate is:
$$\text{Required Conversion} = \frac{2}{174} = \mathbf{1.15\%}$$

If intermediate sales stages perform at healthy benchmarks ($D=96\%$, $M_{book}=65\%$, $M_{show}=80\%$, $Prop=75\%$, $Close=33\%$), the required positive response rate is:
$$R_{pos} = \frac{1.15\%}{0.96 \times 0.65 \times 0.80 \times 0.75 \times 0.33} = \frac{1.15\%}{0.1235} = \mathbf{9.31\%}$$

A **9.3% positive reply rate from cold email is an extreme outlier** that cannot be relied upon in planning. Realistic positive reply rates for cold B2B service offers range from 1.0% to 2.5%.

**Conclusion:** Target of 2 clients/week from 500 sends/week is **premature and statistically unsupported** by cold email alone. Bryan should plan for **1 to 2 new clients per month** at steady state during the initial phase.

---

## 4. Sales Cycle Lag & Cohort Closing Dynamics

A critical flaw in weekly outbound forecasting is assuming that emails sent in Week $N$ will close in Week $N$.

### Real-World Sales Cycle for Malaysian SME Accounting Services:
As documented in the primary discovery interview (`hydroball-shannon-choo-2026-09-30.md`), when Shannon Choo engaged with Outbounder:
1. She requested a price range to take to management.
2. She indicated she would discuss with management the following week (Monday–Thursday).
3. Follow-up calls were required to inspect past tax filings, confirm entity structures (Malaysia vs. Singapore), and verify transaction volumes.

A standard SME accounting sales cycle takes **3 to 6 weeks**:
- **Week 1:** Email sent, read, initial positive reply.
- **Week 2:** Discovery / consultation call held; transaction volumes and current software reviewed.
- **Week 3:** Proposal submitted; SME owner reviews pricing, consults partners or existing tax agent.
- **Week 4–6:** Contract signed, bank access / software credentials handed over, first invoice paid.

### Cohort Attribution Timeline:
```
Campaign Week 1: 174 Prospects Contacted
  ├── Week 1: 4 Positive Replies
  ├── Week 2: 2 Discovery Calls Held
  ├── Week 3: 1 Proposal Issued
  └── Week 5: 1 Client Closed (1st Revenue Recognized)
```
**Operational Implication:** Outbound initiated in Month 1 will produce zero closed clients in the first 21 days. Client acquisition will lag outbound activity by 30 to 45 days.

---

## 5. Economic Modeling: RM600 Profit Sensitivity & Break-Even

The user prompt specifies an estimated RM600 profit per client as an unverified user-supplied scenario. We evaluate this figure under two distinct commercial models:

### Scenario A: RM600 is a One-Time Setup / Advisory Fee
- Monthly client acquisition at Base rate: 1.37 clients/month.
- Gross Monthly Profit: $1.37 \times \text{RM600} = \mathbf{\text{RM822/month}}$.
- Outbound Stack Running Cost (5 mailboxes + sequencer + verifier): ~RM356/month.
- **Net Monthly Profit:** $\text{RM822} - \text{RM356} = \mathbf{\text{RM466/month}}$ (~$114 USD).
- Founder Labor: Managing campaigns, reviewing drafts, holding 5 discovery calls, writing proposals, and onboarding 1.3 clients takes roughly 15 to 25 hours per month.
- **Effective Founder Hourly Return:** $\approx \mathbf{\text{RM18 to RM31 / hour}}$ ($4.50 to $7.50 USD/hr).
- **Verdict:** Commercially unviable. The business model collapses if RM600 is one-time profit.

### Scenario B: RM600 is a Monthly Recurring Retainer Profit (Retainer = RM1,200–RM1,500/mo; 40–50% Margin)
- Month 1: 1 client closed $\implies$ RM600 MRR. Net profit: $\text{RM600} - \text{RM356} = \mathbf{\text{RM244/mo}}$.
- Month 3 (with 90% monthly retention): 3.5 active clients $\implies$ RM2,100 MRR. Net profit: $\mathbf{\text{RM1,744/mo}}$.
- Month 6 (with 90% monthly retention): 6.8 active clients $\implies$ RM4,080 MRR. Net profit: $\mathbf{\text{RM3,724/mo}}$ (~$912 USD/mo).
- Month 12: 11.2 active clients $\implies$ RM6,720 MRR. Net profit: $\mathbf{\text{RM6,364/mo}}$ (~$1,560 USD/mo).
- **Annualized Net Profit at Month 12:** $\mathbf{\text{RM76,368/year}}$.
- **Verdict:** Highly viable. Accounting services are recurring utility infrastructure. Outbounder **must** price on monthly retainers or recurring partner revenue-share.

### Break-Even Sensitivity Matrix (Monthly Fixed Stack Cost = RM356 / $87.33 USD)

| Margin Per Client | One-Time or Recurring | Clients Needed Per Month to Break Even | Cumulative Prospects Needed (at Base Conv 0.181%) |
| :--- | :--- | :--- | :--- |
| **RM300 / mo** | Recurring | 1.19 clients | 656 prospects |
| **RM600 / mo** | Recurring | **0.59 clients** | **327 prospects** |
| **RM1,000 / mo** | Recurring | 0.36 clients | 196 prospects |
| **RM600 flat** | One-time | 0.59 clients / mo | 327 prospects / mo |
| **RM300 flat** | One-time | 1.19 clients / mo | 656 prospects / mo |
