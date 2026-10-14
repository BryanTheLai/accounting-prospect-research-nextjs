---
title: UX simplification audit
audience: Outbounder product and engineering
owner: Codex audit
created_at: 2026-10-05
verified_at: 2026-10-05
update_protocol: Recheck status and source references after Desk changes; preserve numbered IDs when annotating disposition.
---

# UX simplification audit

## Scope and reading guide

Source audit of `web/` pages, controls, API routes, CSS, and current test coverage. The user asked to simplify the whole app, remove Overview and motion, reduce stages/outcomes/dropdowns, and keep icons usable to people and agents. This inventory gives each distinct concern a stable number so implementation status can be annotated. It distinguishes resolved baseline issues, current complexity, and deliberate tradeoffs; it does not treat every advanced control as a defect.

Desk/CSS work was landing in parallel. The current source reflects that work. The status of source-level findings was checked after those edits. Root reports browser QA separately; this document makes no screenshot or live visual claims. No app code, database, dispatcher, service, or existing test was modified or run by this audit.

Status: **Fixed** means the source now addresses the before-state; **Current** means the control/complexity remains; **Tradeoff** means it is intentionally retained pending product choice.

## Numbered inventory

### Workspace shell and Overview

| ID | Before-state issue | Status and current note | Source |
|---|---|---|---|
| 01 | Overview was a separate destination with summary tiles and a second prospect list. | **Fixed.** Campaigns is the default; Overview has no page branch or nav entry. The `#overview` alias remains only to redirect old bookmarks. | `web/app/ui/Desk.tsx:314,749-768`; `web/lib/workflow-ui.mjs:20-23`. |
| 02 | Overview summaries duplicated totals and “best fit” prospects already available in the work list. | **Fixed.** Overview metrics/list are removed from the rendered UI; remaining `call-metric-grid` belongs to Call, not Overview. | `web/app/ui/Desk.tsx:867-871`. |
| 03 | A dedicated `/api/overview` request delayed initial/refresh completion after its page disappeared. | **Fixed in Desk.** `loadWorkspace` now fetches campaigns and mailboxes; overview API/helper/unit test remain unused compatibility artifacts. | `web/app/ui/Desk.tsx:227-238`; `web/app/api/overview/route.ts:1-23`; `web/lib/overview.ts:1-12`; `web/tests/overview.test.mjs:1-24`. |
| 04 | Old `#overview` links could point to a removed view. | **Fixed.** Legacy/empty hash redirects to Campaigns. | `web/app/ui/Desk.tsx:314`; `web/lib/workflow-ui.mjs:20-23`. |
| 05 | Navigation was duplicated across rail, bottom bar, and separate page back links. | **Improved, still intentionally split.** Shared `WorkspaceNav` serves standalone routes; Desk has its rail and mobile bottom nav for in-desk pages. | `web/app/ui/WorkspaceNav.tsx:1-22`; `web/app/layout.tsx:1-20`; `web/app/ui/Desk.tsx:749-768,987-989`. |
| 06 | Icon-only navigation/actions gave sighted users less direct label recognition. | **Tradeoff per user preference.** Current controls retain `aria-label`, `title`, and screen-reader text where needed. Do not replace requested icon-only visuals with visible labels without product direction. | `web/app/ui/Desk.tsx:739-748,763,768,971-974`; `web/app/ui/WorkspaceNav.tsx:17-20`; `web/app/ui/Desk.tsx:59-69`. |
| 07 | Motion appeared in common controls and page/dialog entry, despite the request to remove it. | **Fixed in rendered app scope.** `simplified.css` sets animation and transition to none with `!important` for app-shell and standalone-route descendants. Base declarations remain, but are overridden in these app surfaces. | `web/app/layout.tsx:3`; `web/app/simplified.css:64`; base declarations remain in `web/app/globals.css`. |
| 08 | Standalone screens used separate layouts/styles and repeated their own return links. | **Current visual-system drift.** Desk, module-styled routes, and inline-styled Email preflight remain distinct implementations despite shared shortcut navigation. | `web/app/layout.tsx:1-20`; `web/app/ui/Desk.tsx:733-800`; `web/app/playbooks/PlaybooksClient.tsx:161-168`; `web/app/import/ImportClient.tsx:227-236`; `web/app/activity/ActivityClient.tsx:46-64`; `web/app/mailboxes/MailboxesClient.tsx:205-211`; `web/app/ui/YcExplorer.tsx:242-251`; `web/app/email-preflight/EmailPreflightClient.tsx:273-280`. |

### Prospects and stages

| ID | Before-state issue | Status and current note | Source |
|---|---|---|---|
| 09 | Stage selector exposed 11 long status strings as peers. | **Improved, still 11 underlying choices.** Six common stages are first and five legacy/rare stages are grouped under Other; shorter display labels do not simplify data semantics. | `web/app/ui/Desk.tsx:57,767,1068-1070`; `web/lib/workflow-ui.mjs:2-18`. |
| 10 | Stages were duplicated in UI constants, the prospect PATCH allowlist, and call outcome mappings. | **Current contract burden.** A new stage must stay aligned across all three. Keep one canonical map or test the allowed values and transition map together. | `web/app/ui/Desk.tsx:57`; `web/app/api/prospects/route.ts:49-58`; `web/lib/calls.ts:112-116`; `web/lib/workflow-ui.mjs:2-18`. |
| 11 | Stages carried inconsistent phrasing and detail (`In Sequence (Smartlead)`, `Bounced / 550 Invalid`, `Closed Won (Retainer Signed)`). | **Partly fixed visually** by short labels such as Contacted, Bounced, Won; raw stored values remain visible in API/data and some history. | `web/lib/workflow-ui.mjs:2-16`; `web/app/ui/Desk.tsx:1068-1070`; `web/app/api/prospects/route.ts:54-57`. |
| 12 | Prospects and Call each exposed a separate stage dropdown. | **Current, functionally distinct.** Both use the same stored taxonomy and can be hidden under one advanced workflow filter if users rarely filter by stage. | `web/app/ui/Desk.tsx:767,839-850`. |
| 13 | Search was repeated as global search plus company/founder/location/phone fields. | **Current but advanced fields are collapsed.** Broad search already covers the same identifiers; field-scoped filters remain for precision. | `web/app/ui/Desk.tsx:765-766,770-775`; `web/lib/prospects.ts`; `web/tests/prospects.test.mjs:54-112`. |
| 14 | Score range required separate minimum and maximum inputs. | **Current, advanced.** Consider one range control or a single minimum threshold if users mostly sort by fit. | `web/app/ui/Desk.tsx:776`; `web/lib/prospects.ts`. |
| 15 | Email quality and email check each had multi-option menus. | **Current, advanced.** They encode distinct dimensions (address type vs. DNS/preflight state), but six choices each add dropdown cost. | `web/app/ui/Desk.tsx:777-822`; `web/lib/prospects.ts`; `web/tests/prospects.test.mjs:54-112`. |
| 16 | Prospect tier uses a nested checkbox disclosure with every saved tier. | **Current, advanced.** The selected count is summarized, but tier semantics are database-defined and can create a long nested list. | `web/app/ui/Desk.tsx:783`; `web/lib/prospects.ts`; `web/tests/prospects.test.mjs:112-122`. |
| 17 | Three binary filters (hiring evidence, callable, government) are separate from stage and email filters. | **Current, advanced.** Keep defaults and caveats understandable; government exclusion defaults on. | `web/app/ui/Desk.tsx:784-786`; `web/lib/prospects.ts`. |
| 18 | A hiring-evidence limitation was discoverable mainly through a `title` tooltip. | **Current.** The hover detail can be missed on touch; show the caveat in visible helper text or an accessible disclosure. | `web/app/ui/Desk.tsx:784,788`. |
| 19 | Stage changes had no pending indicator/error recovery in the earlier flow. | **Fixed.** Stage update is busy-guarded, reflects saving, catches failures, and disables the stage control/action. | `web/app/ui/Desk.tsx:178,714-729,792,1068-1071`. |
| 20 | A prospect row’s accessible name was only “Open {company}”, omitting row context. | **Improved.** `aria-description` now provides stage, location, and fit context alongside the concise name. Tier and signal are still visually present but not included in that description. | `web/app/ui/Desk.tsx:1019`. |

### Call workflow

| ID | Before-state issue | Status and current note | Source |
|---|---|---|---|
| 21 | Call queue offered category, stage, and text search filters. | **Improved.** They now sit under one Queue filters disclosure; three underlying controls remain. | `web/app/ui/Desk.tsx:839-850`; `web/lib/call-queue.mjs`; `web/tests/call-queue.test.mjs:29-50`. |
| 22 | Call outcome entry put 10 outcomes at equal visual weight. | **Improved, six still available.** Four common outcomes are primary; six live under Other results. Preserve all database/reporting codes unless making an explicit migration. | `web/lib/calls.ts:3-14,112-116,151-157`; `web/app/ui/Desk.tsx:883-884,903,911`; `web/tests/call-contact.test.mjs:69-121`. |
| 23 | Recording any call result automatically advanced the queue, coupling save and navigation. | **Current interaction contract.** Make sure the compact primary outcomes do not make accidental advancement more likely; regression tests should lock intended behavior. | `web/app/ui/Desk.tsx:883-884,911`; `web/lib/calls.ts:91-120`; `web/tests/call-contact.test.mjs:91-121`. |
| 24 | Previous/Skip buttons duplicated touch-swipe navigation. | **Current by design for accessibility.** Keep buttons as the accessible route; simplify copy/visual emphasis if swipe is the expected mobile path. | `web/app/ui/Desk.tsx:854-860,895-896,911`. |
| 25 | Call card includes identity, timezone, source/signal, phone actions, contact editor, script, research aids, notes, follow-up, and duration. | **Improved by disclosures for secondary content**, but contact, script, research, notes, outcomes still form a long call sheet. Preserve the core call/result path first. | `web/app/ui/Desk.tsx:861-903`; `web/app/ui/CallAids.tsx:21-39`. |
| 26 | Call notes, next follow-up, and call duration were always visible together. | **Improved.** Follow-up and duration are grouped behind “Follow-up & duration”; notes stay on the primary flow. | `web/app/ui/Desk.tsx:879-885`. |
| 27 | Open-by-default script plus research/objection/follow-up aids added multiple disclosure blocks. | **Partly improved.** Call aids are nested under one disclosure; the script remains open by default. | `web/app/ui/Desk.tsx:842-845,884-885`; `web/app/ui/CallAids.tsx:21-39`. |
| 28 | Dialer displays four metrics and recent call history beside the live call sheet. | **Current informational density.** Useful reporting, but competes with the call action on narrower screens. | `web/app/ui/Desk.tsx:897-911`; `web/lib/calls.ts:137-165`. |

### Email campaign and dispatch

| ID | Before-state issue | Status and current note | Source |
|---|---|---|---|
| 29 | Campaign send setup was split into multiple panels with repeated step labels and helper copy. | **Simplified** to two main areas: eligible recipients and Send. Verify against browser QA for visual hierarchy. | `web/app/ui/Desk.tsx:884-919,924-988`; `web/app/simplified.css:16-35`. |
| 30 | Campaign scope plus A/B template A and B selectors were required before dispatch. | **Current, workflow-required.** Two template dropdowns remain because the dispatcher assigns a 50/50 split. The different-template constraint is now explained by inline start guidance. | `web/app/ui/Desk.tsx:884-888,913-916`; `web/lib/workflow-ui.mjs:24-30`. |
| 31 | Previewing both A/B messages added another template selection surface. | **Improved.** Email preview is collapsed under “Preview both messages.” | `web/app/ui/Desk.tsx:888`; `web/app/ui/CampaignEmailPreview.tsx:132-156`. |
| 32 | User could select recipients through Select all, Shown only, quick-pick presets, or per-row checkboxes. | **Current redundancy.** These are four different selection paths; streamline to one default bulk action and a short advanced selection disclosure if users do not need all four. | `web/app/ui/Desk.tsx:929-943`; `web/lib/dispatch-selection.ts`; `web/tests/dispatch-selection.test.mjs:1-20`. |
| 33 | Quick picks operate only on loaded candidates, while Select all pages through the full eligible set. | **Current mental-model mismatch.** The scope of each selection action differs; small explanatory text exists only inside collapsed Quick selection. Make action scope explicit where invoked. | `web/app/ui/Desk.tsx:929-939,943-946`; `web/tests/dispatch-selection.test.mjs:1-20`. |
| 34 | Long candidate lists use 100-row pages and a separate Load next action. | **Tradeoff.** Necessary for bounded local reads, but users must know whether current selection covers visible rows or the full eligible count. | `web/app/ui/Desk.tsx:940-946`; `web/app/api/dispatch/route.ts:25-64`. |
| 35 | Changing campaign scope during overlapping requests could apply stale dispatch results. | **Fixed.** Request sequence IDs discard stale responses; a scope change clears/reloads current candidates. | `web/app/ui/Desk.tsx:204,239-275,386-401`. |
| 36 | Campaign timezone and from/until hours added three controls beyond recipient selection. | **Improved.** Edit send window is collapsed; active schedule summary remains visible. | `web/app/ui/Desk.tsx:955-962`. |
| 37 | Four editable pacing values per mailbox plus warmup/effective values made advanced setup lengthy. | **Improved.** Sender limits/warmup are collapsed, but each mailbox retains four inputs and effective/override explanations. | `web/app/ui/Desk.tsx:963-988`. |
| 38 | Start button could be disabled without explaining why. | **Fixed.** Shared `startBlockReason` provides an adjacent live status reason. | `web/lib/workflow-ui.mjs:24-30`; `web/app/ui/Desk.tsx:913-916`. |
| 39 | UI language could imply delivered when the dispatcher only reports accepted. | **Fixed.** The status now says “accepted today.” | `web/app/ui/Desk.tsx:910`. |
| 40 | Dispatcher errors could leave the send panel without a local retry path. | **Fixed.** Inline error and Retry connection action appear in the candidate area. | `web/app/ui/Desk.tsx:901`. |
| 41 | Idle queue status could show stale pending counts or offer a schedule override when no active run existed. | **Fixed.** Pending count is zero while idle; override requires a running, live, supported run and is hidden after activation. | `web/app/ui/Desk.tsx:910,913,988`; API safety: `web/app/api/dispatch/route.ts:66-`. |
| 42 | Live mode, live start, and active schedule override were high-impact controls. | **Deliberate safety steps, not removable simplification.** Mode and live start retain separate confirmations; schedule override has an explicit impact confirmation. | `web/app/ui/Desk.tsx:658-665,987-989`; `web/app/api/dispatch/route.ts:66-`. |
| 43 | New campaign creation and campaign playbook editing are separate routes/forms. | **Current structural split.** The quick modal saves a minimal paused draft; targeting, offer, template, and prompt edits happen in Playbooks. Clarify the next step after creating a draft. | `web/app/ui/Desk.tsx:1016-1020`; `web/app/playbooks/PlaybooksClient.tsx:173-229`; `web/app/api/campaigns/route.ts:28-64`. |

### Standalone workflows

| ID | Before-state issue | Status and current note | Source |
|---|---|---|---|
| 44 | YC directory showed search, batch, industry, minimum team, top, and hiring filters together. | **Improved.** Directory filters are grouped in a collapsed disclosure and summarize active filters; six underlying controls remain. | `web/app/ui/YcExplorer.tsx:264-286`. |
| 45 | YC selection combines Select shown, Clear checked, per-row checkboxes, pagination, and a final Add action. | **Current but conventional bulk-import flow.** Keep selection total visible and maintain the explicit final confirmation. | `web/app/ui/YcExplorer.tsx:284-345`. |
| 46 | CSV import supports campaign selection, file upload, optional pasted CSV, preview mapping/rules, row table, and confirmation. | **Well-staged safety flow; no simplification defect found.** Avoid collapsing preview/confirmation because it protects existing data. | `web/app/import/ImportClient.tsx:242-315`; `web/app/api/import/route.ts:71-`. |
| 47 | Email preflight separates prospect search, public candidate discovery, address edit, MX check, and exact source confirmation. | **Safety-driven multi-step flow; no reduction recommended without domain-owner review.** Labels distinguish discovered address from confirmed/checked address. | `web/app/email-preflight/EmailPreflightClient.tsx:273-355`; `web/app/api/email-preflight/route.ts:21-`. |
| 48 | Playbooks requires campaign selection, strategy fields, linked template selection, review, activation, and separate prompt presets. | **Improved, with creation tradeoff.** Four primary fields are foregrounded; advanced research/agent and optional-description groups, review values, linked template preview, and prompt presets are disclosures. New-draft mode opens research/agent instructions because campaign ID and prompt fields are needed there. | `web/app/playbooks/PlaybooksClient.tsx:187-225,235-245`. |
| 49 | Agent setup includes editable prompt spec, generated legacy Streamlit prompt, and reusable prompt presets. | **Improved.** Prompt spec is behind Research & agent instructions; generated/legacy text and reusable presets are separately disclosed. Multiple text sources remain a real distinction that should stay labeled. | `web/app/playbooks/PlaybooksClient.tsx:204-224,235-245`. |
| 50 | Mailbox creation/edit collects address/name plus server/port/user/password/provider/quotas. | **Improved.** Connection and sending limits start collapsed. Keep credentials and operational fields out of the usual send flow. | `web/app/mailboxes/MailboxesClient.tsx:216-232`; `web/app/mailboxes/MailboxesClient.tsx:55,221`. |
| 51 | Each mailbox row uses five symbol-only management actions. | **Current discoverability concern.** Every action has an accessible name/title, but Scan/Edit/Activate-or-Pause/Delete rely on symbol recognition visually. User preference explicitly favors icons; retain text/ARIA names and test keyboard/tooltip operation. | `web/app/mailboxes/MailboxesClient.tsx:238-248`. |
| 52 | Mailbox management and suppression management share one screen despite different tasks. | **Current.** Sender pool, credentials/quotas/actions and permanent do-not-contact entry/list are adjacent in the same view. Consider separate tabs or sections only if operators find cross-task clutter. | `web/app/mailboxes/MailboxesClient.tsx:236-265`. |
| 53 | Activity report repeats send counts and mailbox capacity available in campaign and mailbox pages. | **Current, informational.** Five summary cards plus events, mailbox health, suppression count, and raw status breakdown make it a reporting destination rather than a lightweight activity list. | `web/app/activity/ActivityClient.tsx:70-126`; `web/lib/activity.ts`. |
| 54 | Settings included health readouts and setup tools while Mailboxes held operational configuration. | **Improved.** Settings is a concise hub with three setup links and a collapsed domain/deliverability tools group; mailbox management stays on its dedicated route. | `web/app/ui/Desk.tsx:971-979`; `web/app/mailboxes/MailboxesClient.tsx:205-265`. |

### Accessibility / operator and agent access

| ID | Before-state issue | Status and current note | Source |
|---|---|---|---|
| 55 | Dialog focus/keyboard behavior was implemented only for Desk. | **Improved across all three dialogs.** Desk, Import, and YC use the shared `useDialogFocus` hook for initial focus, Tab wrap, Escape, body lock, and return focus. Verify browser behavior separately. | `web/app/ui/useDialogFocus.ts:1-`; `web/app/ui/Desk.tsx:330`; `web/app/import/ImportClient.tsx:5,96`; `web/app/ui/YcExplorer.tsx:4,242`. |
| 56 | Mobile prospect detail was a sheet without dialog semantics or focus management. | **Improved.** The mobile-open detail panel receives dialog/modal semantics and Desk’s shared focus hook covers active dialogs. Browser QA should confirm responsive focus behavior. | `web/app/ui/Desk.tsx:330,1031-1032`; `web/app/ui/useDialogFocus.ts:6-`. |
| 57 | Status badges use colored tones and a small dot. | **No color-only defect found:** each badge also renders a text status. Keep text as stage labels are shortened. | `web/app/ui/Desk.tsx:72-78,861,1038-1040,1064-1069`. |
| 58 | Shared SVG helper hides icons from screen readers; icon-only controls require labels at use sites. | **Mostly addressed.** Desk nav/actions, common modal controls, and mailbox actions expose names. Preserve this when adding/removing icons; glyph paths alone are not names. | `web/app/ui/Desk.tsx:59-69,739-748,763,768,971-974`; `web/app/ui/WorkspaceNav.tsx:17-20`; `web/app/mailboxes/MailboxesClient.tsx:238-248`. |
| 59 | Status/error updates and copy actions need announcements when controls are simplified. | **Partly addressed.** Desk notices use alert/status live regions; standalone pages use alerts/statuses. Keep announcements when consolidating controls. | `web/app/ui/Desk.tsx:1029`; `web/app/playbooks/PlaybooksClient.tsx:170-171`; `web/app/import/ImportClient.tsx:268-269`; `web/app/activity/ActivityClient.tsx:66-68`. |
| 60 | Tests covered data helpers without browser layout or keyboard checks. | **Improved; remaining coverage is explicit.** `npm test` and typecheck are defined. A repeatable CUA browser smoke checks 30 responsive routes, visible headings, overflow and icon names; fixture API smoke covers six checks. Keyboard focus and workflow saves were exercised in the browser and recorded separately; exhaustive screen-reader/component coverage remains unclaimed. | `web/tests/ui-browser-smoke.mjs`; `web/tests/ui-api-smoke.mjs`; [verification evidence](ux-qa-results.md). |

## API controls and safety boundaries

API routes cover prospects, campaigns, calls/call queue, activity, mailboxes/settings, playbooks, YC, email preflight/discovery, DNS tools, import/export, dispatch, contacts, and inbound scan. UX simplification must retain server-side validation and domain safety. Highest-risk contracts are Prospect stage PATCH (`web/app/api/prospects/route.ts:49-58`), call outcome mapping (`web/app/api/calls/route.ts:24-44`; `web/lib/calls.ts:3-17,91-120`), and dispatch controls (`web/app/api/dispatch/route.ts:25-`). Keep live-mode confirmation, prospect approval/current email/source checks, suppression, schedule, and sender pacing in the dispatch path.

## Test harness and focused regression plan

- `web/package.json` now exposes `npm test` (`node --test --experimental-strip-types tests/*.test.mjs`) and `npm run typecheck` (`tsc --noEmit`), plus `dev`, `build`, and `start`. Neither command was run for this source-only audit.
- Isolated fixtures: in-memory SQLite in `web/tests/prospects.test.mjs`, `web/tests/call-queue.test.mjs`, `web/tests/call-contact.test.mjs`; temporary DBs removed in `finally` in `web/tests/activity.test.mjs` and `web/tests/playbooks.test.mjs`. These do not require the live lead database.
- Focused regressions for current simplification: Overview request removed and legacy hash routing; stage-label/primary-vs-other list alignment with PATCH and call mappings; four primary plus six secondary outcomes preserve each disposition and intentional advancement; filter disclosures summarize active state and reset cleanly; stale campaign-scope requests cannot overwrite current candidates; dispatch error retry and blocked-start reason; exact label “accepted”; icon buttons have names; mobile detail and all confirmation dialogs keep keyboard focus; prompt editor stays labelled and generated text stays distinguishable.

## Audit limits

- Root is recording browser QA separately in `docs/ux-qa-results.md`; this source inventory has no screenshots or live visual claims.
- The audit keeps the current 60 items because many are explicit controls/workflows rather than bugs; rows marked tradeoff are not recommendations to remove functionality.
- No new stage or disposition taxonomy is specified here.

