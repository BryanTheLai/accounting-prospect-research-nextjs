---
title: Consistent navigation and task flow
audience: Outbounder operator and engineering
owner: Codex
created_at: 2026-10-05
verified_at: 2026-10-05
update_protocol: Run the CUA navigation smoke after every shell/navigation change; preserve safety validation while simplifying presentation.
---

# Consistent navigation and task flow

This iteration supersedes the earlier audit's left-rail/standalone-top-nav design. The application uses one shared top navigation on every route and screen size. Mobile keeps the same order and labels, with icons above the text.

## First principles

The primary task is to send reviewed messages to selected, eligible prospects and understand progress. The interface must answer four questions: who receives it, what they receive, whether sending is possible, and what happens next. Internal configuration belongs behind explicit secondary controls. Calling remains available as a separate task.

## Critique loop and changes

Two GPT-6 Luna reviewers inspected task flow and navigation separately. A second review inspected the changed source and identified concrete remaining issues. Parent verified source findings and browser behavior.

| Finding | Implemented response |
| --- | --- |
| Different navigation on desk, standalone pages and mobile | RootLayout owns one WorkspaceNav. Removed Desk rail, mobile header and bottom nav. |
| Icon meanings were hard to infer | Visible short labels plus accessible names and current-section highlighting. |
| Root hashes lacked shared active state | Listen for hashchange/popstate; internal navigation emits the hash change after updating history. |
| Recipients and messages were mixed in one control grid | Three steps: Choose recipients, Review messages, Start sending. Message selectors follow recipient selection. |
| Bulk selection offered every recipient as the primary action | Bounded Select first 20 shown; full-audience selection remains under Quick selection. Labels match replacement semantics. |
| Readiness counts disappeared once some recipients became eligible | Other prospects disclosure retains held counts and review/check links when candidates exist. |
| Review was easy to overlook | Preview opens when recipients are selected; render both saved messages before live confirmation. |
| A/B copy overstated exact balance | Wording says random assignment as evenly as possible. |
| Pages used technical labels | Campaign setup, Senders, Check emails and Email activity replace foreground Playbooks/Mailboxes/Preflight/Outbound activity headings. |
| Mobile inherited bottom-bar spacing | Removed main bottom reservation and moved safe-area top inset to the shared nav. |

Main send eligibility, SMTP adapters, saved scripts/templates, suppression and live confirmation contracts are unchanged by this iteration. No email was sent and no real prospect/mailbox record was edited.

## Proof

- `npm test`: 76 passed, zero failed/skipped.
- `npm run typecheck`: exit 0 after changes.
- Final `npm run build`: exit 0, compiled and TypeScript/static page generation completed. Existing SWC fallback warning remains.
- Updated `web/tests/ui-browser-smoke.mjs` ran through CUA against the fixture service: **30 passed**, actual widths **375, 768, 1280**. It asserts one shared nav, identical six names, no old rail/header/bottom nav, no horizontal overflow and no unnamed empty buttons. This is route-layout coverage, not exhaustive interaction coverage.
- Mouse click Email → Prospects and keyboard Enter on Call reached their correct headings and active links; Settings retained the same navigation.
- Main Email page showed the three steps, one shared nav, Email active, 20 previously accepted today, and dry-run mode. No run was started.
- Reproduction output: `operations/ui-qa/navigation-iteration-2.json`. The fake service was stopped after QA; main port 3000 stays running.

## Remaining work and limits

The broader [60-item audit](ux-simplification-audit.md) retains intentional advanced controls. This iteration does not claim every usability issue is eliminated. Email/source review still requires evidence, and the second Microsoft sender's authentication error remains a separate operational issue. Rendering/layout checks are not a screen-reader audit.

![Current email page with shared top navigation](../operations/ui-qa/email-top-nav-mobile.png)
