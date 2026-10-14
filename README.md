# Outbounder

Cold-outreach platform for accounting services. Ingests prospects, verifies email
deliverability, and sends reviewed, rate-limited email campaigns from a local or
hosted sender. A companion call desk handles phone follow-up.

> **Branches**
> - `main` — email-only. Campaigns, deliverability, and sending. No call desk.
> - `codex-v1` — full version. Everything in `main` **plus** the call desk / dialer.
>
> Both branches share the same SQLite database (configured via `OUTBOUNDER_DB_PATH`).

---

## Architecture (TL;DR)

```
┌────────────────────────┐        loopback HTTP + bearer token       ┌─────────────────────────┐
│  Next.js web (web/)    │  ───────────────────────────────────────►  │  Python dispatcher      │
│  App Router UI + API   │        /status /start /pause /mailbox-pacing│  dispatcher_sidecar.py  │
│  port 3000             │  ◄───────────────────────────────────────  │  campaign_dispatcher.py │
└──────────┬─────────────┘         authoritative send state           └───────────┬─────────────┘
           │                                                                   │
           │ better-sqlite3 (shared file)                                      │ SMTP (587)
           ▼                                                                   ▼
┌────────────────────────┐                                            ┌─────────────────────┐
│  SQLite: leads.sqlite  │  ◄── inbound IMAP scan (replies) ──────── │  Microsoft 365      │
│  prospects, campaigns, │                                           │  bryan@… / bryanlai@│
│  mailboxes, queue,     │                                           └─────────────────────┘
│  sends, preflight      │
└────────────────────────┘
```

- **Web (Next.js 16, App Router, TypeScript)** — the operator UI and all HTTP API routes.
- **Dispatcher (Python)** — a loopback-only control service that owns sending, pacing, and
  the durable send queue. It is the source of truth; the web UI never sends mail directly.
- **Database (SQLite)** — one file holds everything: prospects, campaigns, mailboxes,
  templates, per-mailbox warm-up state, the dispatch queue, and send history.
- **Control channel** — web → dispatcher over `127.0.0.1` with a random per-launch bearer
  token. The dispatcher refuses to start without it. Nothing is exposed off-box by default.

## Features

**Prospecting & data**
- Multi-source ingestion: YC directory, master lead archive, CSV/XLSX import, research
  pipelines. Import is add-only and de-duplicated by company.
- Prospect records carry fit score, sector, location, contact routes, and evidence.

**Email deliverability (the safety core)**
- Per-recipient preflight: syntax, MX presence, disposable/blacklist checks.
- Government/entity shield (`gov_shield.py`) — skips gov/nonprofit recipients.
- Source confirmation: an address must be observed on the official site before it can send.
- Freshness gates — preflight evidence must be recent; stale addresses re-check.
- Route classification — blocks support/HR/privacy/newsletter/legal inboxes.

**Sending**
- Reviewed-recipient batches with A/B templates and per-lead spintax rendering.
- Per-mailbox caps: daily, hourly, and min/max delay between messages.
- Warm-up ramp (`warmup_ramper.py`) that recommends conservative limits early on; manual
  overrides are supported.
- Campaign schedule windows (timezone-aware) with quiet hours.
- Durable queue: survives restarts, tracks `PENDING` / `IN_FLIGHT` / `SENT` / `UNCERTAIN`,
  and recovers an approved in-flight run.
- Live-confirmation gate — a run must be explicitly confirmed before real SMTP sends.

**Mailboxes & DNS**
- Multiple sender mailboxes (Microsoft 365 / generic SMTP), each with its own limits.
- DNSBL reputation check (Spamhaus, SpamCop, Barracuda) on demand.
- DNS guidance + BIND/Cloudflare record templates for the sending domain.

**Replies & activity**
- Read-only IMAP scan flags replies and updates prospect stage.
- Activity feed of sends, replies, and stage changes.

**Call desk (`codex-v1` only)**
- Scripted outbound calls with a live queue, per-call notes, outcomes, and dashboard
  metrics. Uses generated phone scripts keyed to the prospect's campaign.

## Data model (SQLite, one file)

`prospects` · `campaigns` · `mailboxes` · `email_templates` (playbooks) ·
`dispatch_queue` / `dispatch_runs` · `campaign_sends` · `email_preflight` ·
`call_logs` · `email_suppression`

## Run it

```bash
cd web
npm install
cp .env.example .env.local     # set OUTBOUNDER_DB_PATH, ENABLE_LIVE_DISPATCH=false
npm run build && npm start     # web + dispatcher under a supervisor
# web UI: http://127.0.0.1:3000
```

`npm start` launches the dispatcher and Next.js together, wires a shared control token,
and recovers any approved queue. `npm run dev` is the same wiring in dev mode.

### Environment
| Variable | Purpose |
|---|---|
| `OUTBOUNDER_DB_PATH` | Path to `leads.sqlite` (falls back to `./leads.db`) |
| `OUTBOUNDER_DISPATCHER_PORT` | Loopback control port (default `8765`) |
| `OUTBOUNDER_CONTROL_TOKEN` | Bearer token minted by the launcher |
| `ENABLE_LIVE_DISPATCH` | `false` = dry-run; `true` = real SMTP sends |

## Tests

```bash
py -3 -m pytest tests -q   # Python: dispatcher, DB, gates, pacing
cd web && npm test          # Node: API + UI unit tests
cd web && npm run typecheck
```

## Safety notes

- Keep `ENABLE_LIVE_DISPATCH=false` until a batch is reviewed and confirmed.
- The dispatcher binds to loopback only. Don't expose it directly; front it with auth.
- Sending domain is `openclose-desk.com` (Microsoft 365). The app deliberately does not
  hardcode brand into the sending path — update `PRIMARY_DOMAIN` if that changes.
- Secrets, the SQLite DB, DNS zone exports, and PDFs are excluded from git. Supply them
  out-of-band.
