---
title: Simplification verification
audience: Outbounder operator and engineering
owner: Codex
created_at: 2026-10-05
verified_at: 2026-10-05
update_protocol: Rerun fixture and browser checks after workflow changes; never use the live database for mutation tests.
---

# Simplification verification

## Result

The simplified app is running at [localhost](http://127.0.0.1:3000/#campaigns). The [60-item audit](ux-simplification-audit.md) distinguishes completed changes from retained functionality and remaining complexity. It does not claim 60 defects or that every possible failure has been eliminated.

## Commands and evidence

| Check | Observed result |
| --- | --- |
| `npm test` in `web/` | 76 passed, 0 failed, 0 skipped |
| `npm run typecheck` | Exit 0 |
| `npm run build` | Exit 0; compiled, TypeScript completed, static pages generated |
| `node tests/ui-api-smoke.mjs` against isolated port 3001 | Six integration checks passed |
| `runUiSmoke(qa, browser, nodeRepl.write)` through CUA | 30 responsive route checks passed; no horizontal page overflow or unnamed empty icon buttons |
| Main app read API probes | 200: prospects, campaigns, mailboxes, activity, playbooks, import, email-preflight, YC |
| Isolated DB after mutation checks | Six synthetic prospects, two synthetic call logs, zero sends; fake mailbox PAUSED |

Build emits an existing Windows native SWC binary warning; Next completes using its fallback. Node tests emit existing module-type warnings. These warnings are not a failed compilation/test.

## Browser workflows exercised

All mutations used `operations/ui-qa/fixture.db`, fake `.example.test` companies, fake credentials, a paused sender, and no dispatcher. Main app checks were read-only.

1. Add a synthetic prospect: Company + Location, save, row appears with Review stage.
2. Open Synthetic Acorn Labs and approve: row/detail change to Approved and success is announced.
3. At 375px, open Synthetic Birch Works: modal sheet focuses Close, Shift+Tab wraps to Check this email, Escape closes and returns focus to its row.
4. Call: enter synthetic notes, select No answer, saved history appears and queue advances from Acorn to Birch. No phone/WhatsApp action was invoked.
5. Playbooks: edit a paused campaign name, save, renamed campaign appears with PAUSED status. Audience, Offer, linked template remain visible; advanced instructions remain available.
6. Import: reveal pasted CSV, select synthetic campaign, preview one row and mapping, open confirmation, confirm insert; one new Review prospect is reported.
7. Email preflight: `?leadId=uiqa_lead_001` opens the correct exact saved address without edits, MX lookups, or source confirmation writes.
8. Sender form: Add opens required connection fields; cancel leaves fake sender paused. Mobile form has no horizontal overflow.
9. Fixture unavailable dispatcher: inline Retry connection appears, Start and Live controls are disabled with an adjacent reason.
10. Main app A/B preview: choose 1stCollab, render both saved subjects/bodies, use arrow keys to switch tabs. Commercial copy contains the previously approved removal of the 48-hour promise. No template data was edited.
11. Main app live-mode confirmation: open then Escape/cancel; focus returns to the switch and live mode remains off.
12. Settings: three setup links and a collapsed deliverability disclosure; no Motion/Compact rows controls.
13. Responsive smoke: Email, Prospects, Call, Settings, Mailboxes, Preflight, Import, Playbooks, Activity, YC at 375/768/1280px. These checks cover initial rendered route layout, headings, icon names and navigation; they are not comprehensive validation of every populated table.

## Repeat the isolated checks

From `web/`:

```powershell
node tests/create-ui-fixture.mjs
npm run build
powershell -NoProfile -File tests/start-ui-qa.ps1
```

In another terminal, run `node tests/ui-api-smoke.mjs`. It refuses the main app port and non-synthetic records. Fixture creation resets only the known fixture DB, so stop the QA service before recreating it.

For browser checks, bind a CUA tab to `http://127.0.0.1:3001/`, then import `web/tests/ui-browser-smoke.mjs` in `cua_repl` and call its exported `runUiSmoke` with the bound tab, browser, and `nodeRepl.write`. The helper restores the viewport in `finally`.

The synthetic DB omits YC directory data; its error state is expected in fixture QA. The main app's YC endpoint was separately checked and returned 200. No email transport, real call, new source confirmation, inbound scan, credential change, or live campaign run was exercised.

## Current operational limits

The main app still reports the existing second sender Error and first sender At quota. UI simplification does not resolve Microsoft mailbox authentication. Send eligibility and live confirmations remain enforced. Saved call scripts and email bodies are preserved; only generated role-only greetings fall back to “there.”

## Screenshots

![Simplified email desk](../operations/ui-qa/email-desktop.png)
