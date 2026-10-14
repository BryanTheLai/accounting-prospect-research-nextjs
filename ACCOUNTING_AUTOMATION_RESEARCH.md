# Accounting Automation Research Brief

**Date:** 2026-09-19  
**Scope:** Read-only research and synthesis. No code, dependency, server, or Git implementation changes were made.

## Executive decision

The work is currently three related systems, not one finished product:

- `tax` is primarily **Outbounder**, an accounting reconciliation system, not a tax-calculation engine.
- `stackifier-the-wrapper` is a PDF intake, extraction, evidence-review, correction, and CSV-export proof.
- `ocr-inference-gpu` is OCR/document-processing infrastructure.

Do not merge these into a broad “AI accounting platform” yet. The strongest immediate commercial wedge is:

> **Month-End Document Exception Desk:** ingest a client’s messy PDFs or spreadsheets, preserve source evidence, surface reconciliation/categorization exceptions, let an accountant correct or approve them, and return a clean export in the firm’s existing format.

This is narrower than autonomous bookkeeping and fits the strongest existing trust model: the model proposes; deterministic code computes and validates; the accountant approves.

## What the sources show

The authenticated Google Doc is mainly an outreach and customer-discovery workspace containing Malaysia/San Francisco outreach, meeting notes, and a demo-video plan. The Google Sheet’s supplied `Sheet6` tab is empty; the relevant lead data is in the populated `User Tracker` tab and other tabs.

- [Accounting Outreach Doc](https://docs.google.com/document/d/1t6bwWr5eyEcZDhDnb050E9UuJL5NE6-GTZERYBaQsfQ/edit?tab=t.0)
- [Accounting Outreach Sheet](https://docs.google.com/spreadsheets/d/1pLU6smBg63ZxQOA3-xN56G_boBkbp201NB04GKw6AvU/edit?gid=932970603#gid=932970603)
- [Private GitHub tax repository](https://github.com/shannonruxin/tax)

The strongest customer evidence is:

- Siti: a ten-year-old firm with two branches and approximately 350 clients, with a preference for local software.
- Khadijah: a broad Malaysian accounting/bookkeeping/tax practice with pain around QuickBooks, SQL Accounting, PDF extraction, Excel formatting, chart-of-accounts nuance, and MBRS/XBRL conversion.
- Mr Chua: an accounting-firm owner recorded as agreed/onboarding.

These are design-partner signals, not proof of willingness to pay.

## Current system map

```text
accepted
  -> preflighted
  -> extracted
  -> normalized
  -> matched/reconciled
  -> categorized
  -> human-reviewed
  -> ready to post
  -> posted/exported
```

The states should remain independently observable. A document can be extracted successfully but still be unmatched, uncategorized, or awaiting approval.

## Repository findings

### Stackifier

Verified capabilities include FastAPI endpoints, fixed bank-statement/invoice profiles, PyMuPDF rendering, Reducto provider boundaries, SQLite persistence, evidence bboxes, review states, correction persistence, and CSV export.

- [server.py](C:/Users/wbrya/OneDrive/Documents/GitHub/stackifier-the-wrapper/stackifier/server.py:273)
- [processing.py](C:/Users/wbrya/OneDrive/Documents/GitHub/stackifier-the-wrapper/stackifier/processing.py:1031)
- [extraction_models.py](C:/Users/wbrya/OneDrive/Documents/GitHub/stackifier-the-wrapper/stackifier/extraction_models.py:98)
- [result_store.py](C:/Users/wbrya/OneDrive/Documents/GitHub/stackifier-the-wrapper/stackifier/result_store.py:113)
- [UI](C:/Users/wbrya/OneDrive/Documents/GitHub/stackifier-the-wrapper/stackifier/ui/index.html:484)

The test suite has broad structural coverage, but live Reducto compatibility, extraction accuracy, bbox hit rate, cost, latency, and current browser quality remain unverified. Provider tests mock Reducto rather than calling the live service.

Important inferred risks:

- restored batches may be difficult to process because the UI selects and filters around the newest batch;
- asynchronous progress is held in memory rather than durable state;
- legacy Fireworks/VLM, spreadsheet, demo-export, and WebSocket paths remain reachable;
- no dependency manifest or lockfile was found.

### tax / Outbounder

The PRD defines a reconciliation system: read source workbooks, propose relationships and parameters, require accountant approval, run deterministic matching, use a model only for unresolved decisions, and produce a code-generated verdict.

- [PRD](C:/Users/wbrya/OneDrive/Documents/GitHub/tax/notes/PRD.md:31)
- [P1 specification](C:/Users/wbrya/OneDrive/Documents/GitHub/tax/docs/p1-sheet-extractor/p1-spec.md:7)
- [P3 reconciliation specification](C:/Users/wbrya/OneDrive/Documents/GitHub/tax/docs/p3-recon/p3-recon-spec.md:29)
- [Agent loop](C:/Users/wbrya/OneDrive/Documents/GitHub/tax/docs/p3-recon/p3-agent-recon.md:22)

The strongest invariant is: **the model proposes; code computes, validates, persists, and judges**. Categorization and posting are deferred in the current P3 design.

## ICP hypothesis

> Owner-led Malaysian accounting, bookkeeping, tax, or secretarial firms serving roughly 100–400 SME entities, using local or desktop accounting software, receiving messy PDFs/spreadsheets, and repeatedly doing manual reconciliation, categorization, or format conversion.

Buyer: owner, partner, or managing director.  
Champion: senior accountant, outsourcing manager, or practice-operations lead.  
User: junior accounting/bookkeeping staff.

Strong buying signals:

- hiring bookkeeping/accounts staff;
- many client entities;
- documents arriving through WhatsApp, email, Drive, and mixed channels;
- repeated re-keying or review of PDF/spreadsheet data;
- existing cloud-accounting software but persistent manual exceptions.

Public comparison signals:

- [NHQ & Associates on Bukku](https://bukku.my/partners/nhq-associates)
- [AT Azry](https://atazry.com/about)
- [Malaysia accounting-firm jobs](https://my.jobstreet.com/accounting-firm-jobs/in-Malaysia)
- [Dext](https://help.dext.com/en/articles/416727-getting-started-with-dext-for-accountants-and-bookkeepers)
- [Tofu](https://www.gotofu.com/)
- [Bukku](https://bukku.my/splash)

## Commercial validation gate

Treat the following as hypotheses until verified:

- pilot price: RM1,500–RM3,000;
- three client batches over 14–30 days;
- success target: at least 30% reduction in document-to-review time.

Continue only if at least three firms provide real sample batches, two agree to timed pilots, and one pays. Reconsider the wedge if firms using Dext, Tofu, or Bukku have no unresolved exception backlog.

Required evidence:

1. one anonymized real batch;
2. measured current processing time;
3. one named operational champion;
4. a paid pilot commitment;
5. confirmed privacy/provider approval.

## Architecture recommendation

- AI proposes extraction, matches, categories, and explanations.
- Deterministic code controls schema, arithmetic, totals, account codes, bboxes, and invariants.
- Humans approve exceptions and material adjustments.
- The server owns canonical state and exports.
- Corrections are append-only events containing the original value, new value, evidence, reviewer, revision, and idempotency key.
- Posting is an explicit, idempotent side effect.
- CSV is the first safe boundary; accounting-system integration comes later.

Relevant public references:

- [OpenAI agent evals](https://developers.openai.com/api/docs/guides/agent-evals)
- [Reducto extraction](https://docs.reducto.ai/extract/overview)
- [Ramp ERP integrations](https://docs.ramp.com/llms-guides/erp-integrations.txt)
- [Digits bank reconciliations](https://help.digits.com/business-agentic-general-ledger/ai-bank-recs)
- [Numeric reconciliation](https://www.numeric.io/solutions/account-reconciliation-software)
- [BlackLine reconciliation](https://www.blackline.com/record-to-report/automated-account-reconciliations/)
- [Meridian](https://meridian.pilot.com/product)

## Immediate next research decisions

1. Choose whether the first paid pilot is reconciliation-only, reconciliation plus categorization, or PDF extraction plus reconciliation.
2. Obtain one sanitized real customer batch and its expected output.
3. Measure current human processing time.
4. Choose CSV as the initial integration boundary unless a customer names a higher-priority format.
5. Validate privacy approval for any external extraction provider.
6. Keep implementation paused until the paid workflow and sample data are confirmed.

## Audit proof

- Scope: read-only research, plus this markdown synthesis only.
- Agents used: repository auditor, source/teaching auditor, ICP researcher, architecture benchmarker.
- Files edited: this markdown file only.
- Code, dependencies, servers, and application behavior: unchanged.
- Git commits, pushes, resets, checkouts, cleans, and deletes: none.
- Existing repository modifications were present before this research sprint and remained unchanged.
