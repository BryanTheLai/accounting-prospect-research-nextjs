# Outbounder

A local-first Next.js desk for prospect review, email campaigns and calls. The interface uses a compact light layout for desktop and mobile.

## Run locally

1. Install Node.js 20.9 or newer.
2. From this directory, run `npm install`.
3. Confirm the SQLite file is at `../operations/recovered-leads-20261008/leads.sqlite`, or set `OPENCLOSE_DB_PATH` in `.env.local` to another explicitly chosen local database.
4. Run `npm run build`, then `npm start -- --port 3000`. The production launcher supervises Next.js and the Python sender independently: a failed web process does not stop sending, and a failed sender restarts from its saved queue.
5. Open `http://127.0.0.1:3000`. Keep the supervisor and computer running. For development only, `npm run dev` uses the paired development launcher.

The dev server binds to loopback. Prospect rows and contact details are read from the local database. New prospects, prospect stage changes, paused campaign drafts, and filtered CSV exports use the same database. No lead database, workbook, CSV, or environment file belongs in Git.

The dispatcher binds only to loopback at `OPENCLOSE_DISPATCHER_PORT` (default `8765`; this checkout currently uses `18765` to avoid unrelated local demos). Startup refuses an occupied sender port. The launcher gives both local processes a random control token; `/status`, `/ready` and all POST controls require it. `/health` is an unauthenticated liveness check. New runs require reviewed recipients and explicit live confirmation. A recovered run retains its saved live authorization, exact copy, A/B assignments, spacing deadline and approved schedule override. Paused and explicitly stopped runs do not automatically send. Schedule overrides never bypass current recipient eligibility, suppression, warmup or sender volume limits. Control snapshots expose safe waiting reasons and counts, not contact details.

Both launchers honor `OPENCLOSE_DB_PATH` from the environment or `.env.local`; relative paths resolve from `web/`. The default is inside this Next.js checkout, not the Streamlit or Apollo folders. Python receives the same absolute database path. SMTP secrets and control tokens are never printed.

SQLite holds prospects, send history, templates, source evidence and the `dispatch_runs` / `dispatch_queue` tables. Each queued message has frozen subject/body text. If a process dies during an SMTP attempt without a durable acceptance record, that item becomes `UNCERTAIN` and is held for manual review rather than automatically resent. SMTP acceptance is not proof of inbox delivery.

Pacing uses per-message spacing and the effective hourly/daily sender caps. It does not add artificial four-message breaks. Sender aliases sharing one SMTP login do not establish independent provider capacity. The warmup clock currently uses the local mailbox record's creation date; it is not a verified provider mailbox age.

The supervisor restarts failed child processes while it is alive. It cannot keep sending when the computer is asleep/off, survive its own termination, or launch after a reboot without separate OS startup configuration. `operations/runtime/supervisor-status.json` and the launcher's redirected logs provide local process evidence.

## Prepare verified addresses before approving a batch

Research files alone do not satisfy the sender's email checks. Save reviewed source
evidence and current mail routing to the live `email_preflight` table before asking
for approval. A missing owner name does not block a published shared business inbox.
Neither a published address nor MX proves individual mailbox existence.

From `web/`, preview a reviewed manifest, then persist its checks:

```sh
node scripts/prepare-reviewed-outreach.mjs ../operations/<batch>/reviewed-address-manifest.json
node scripts/prepare-reviewed-outreach.mjs ../operations/<batch>/reviewed-address-manifest.json --apply
node scripts/verify-prepared-outreach.mjs ../operations/<batch>/batch-manifest.json
```

Each record contains `lead_id`, `company_name`, `root_domain`, `email`, `source_url`,
`archive_file`, `source_sha256`, `checked_at`, and explicit `identity_reviewed`,
`address_context_reviewed`, and `published_address_observed` confirmations. The
archive stays inside the batch directory. The company must already be staged.

The command checks the archived exact address and hash, refreshes MX, rejects prior
outreach/suppression, and creates a backup before applying. It never overwrites a
different saved recipient, changes outreach approval, queues messages, or sends.
Repeating it leaves fresh checks and notes unchanged. Use the exact saved recipient
and rendered subject/body packet for batch approval; do not ask the operator to
repeat technical verification after approval. Recheck safety at dispatch time.

## Quality checks

With Node.js 22.18+ and Python 3 installed:

```sh
npm test
npm run typecheck
npx playwright install chromium
npm run qa
```

`npm run qa` builds a separate production fixture in `.next-qa`, serves it on ports `3001` and `18766`, runs the browser suites, and stops only its own processes. Those ports must be free. The default local lead store supplies realistic data through a read-only backup; credentials are scrubbed in memory before the fixture reaches disk. Live delivery and recovery are disabled. No live rows or sending controls are used.

The suites open every page and disclosure at desktop, tablet and mobile sizes, exercise keyboard/focus and form states, and assert content insets, usable viewport width and control sizes. Saves and CSV/XLSX/YC imports use only the isolated fixture. Provider responses and sending controls are intercepted; passing these suites does not establish SMTP, IMAP, DNSBL or inbox delivery. Screenshots and state proofs are in `../operations/full-ui-qc-20261008/`.

## Structure

- `app/ui/Desk.tsx` — the four compact workspace views and interactions
- `app/globals.css` — paper-ledger tokens, desktop rail, and touch-first layouts
- `app/api/` — narrow local handlers for overview, prospects, campaign drafts, settings, and export
- `lib/db.ts` — local SQLite path and connection boundary
- `../dispatcher_sidecar.py` — token-protected loopback control service for the existing Python dispatcher
- `scripts/supervised.mjs` — production supervisor for independent web and sender processes
- `scripts/local.mjs` — paired development launcher
- `../dispatch_queue.py` — durable approved messages and uncertainty-safe recovery

The prospect list endpoint returns only fields needed to scan the list. Contact fields are fetched only after you select a prospect. Drafts use the existing campaign table with the existing `PAUSED` status, so the older dispatcher cannot mistake an unfinished draft for an active campaign.
