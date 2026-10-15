# MY/SG Outreach Pipeline

Unattended daily pipeline for the Malaysia/Singapore outreach campaigns:
discover → preflight → verify → approve → send, capped at **100 emails/day total**.

Once installed, the operator does not approve, review, or start anything by hand.

---

## Current state (as of 2026-10-15)

| Pool | Leads | MX present | Source-confirmed | Sendable |
|---|---|---|---|---|
| `hydroball_clones` | 227 | 128 | 50 | 50 |
| `jobstreet_hiring_pain` | 180 | 119 | ~30 | ~30 |
| `mysg_consumer_retail_accounting` | 100 | 100 | 100 | 0 (already emailed) |
| **Total** | **507** | **347** | **~180** | **~80** |

**~80 verified sendable addresses.** At 100/day that is roughly one day of volume,
so sourcing must keep up. Run discovery continuously or add more pools.

---

## The blocking issue: DigitalOcean blocks outbound SMTP

DigitalOcean blocks ports **25, 465 and 587 on every Droplet by default**. This is
documented platform policy, not a reputation issue and not something triggered by
this project:

> "SMTP ports 25, 465, and 587 are blocked on Droplets to prevent spam and other
> abuses on our platform. This block applies to all Droplets by default."
> — DigitalOcean documentation

**Consequence: the dispatcher cannot send from this VPS at all.** Connections hang
rather than being refused, so it presents as a silent hang or a queue that never
drains.

Verified on the current host — 443/80/53 open, all three SMTP ports time out to
Microsoft, Gmail and Amazon SES alike.

**Zero emails have ever been sent from the Droplet.** The 245 `SENT` rows in
`campaign_sends` pre-date the host (Droplet created 2026-10-14 14:10, database
copied over 14:32, last send record 14:41) — that history came from a local machine.

### What the team needs to decide

Sending cannot work from DigitalOcean over SMTP. Pick one:

1. **HTTPS relay (recommended, works today).** Brevo, SendGrid or Mailgun send over
   port 443, which is open. Requires changing the delivery layer in
   `campaign_dispatcher.py` (~line 640, `server.login(...)`) to call the provider's
   HTTPS API instead of SMTP. Also gains real bounce/complaint webhooks.
2. **Move to a host that permits SMTP.** Hetzner, Linode and OVH allow outbound
   SMTP by default. Everything in this pipeline then works unchanged.
3. **Ask DigitalOcean to lift the block.** A support ticket against documented
   default behaviour — DO explicitly recommends option 1 instead.

---

## Deliverability gate — do not remove

An address is only sendable when **both** are true:

- `email_preflight.mx_status = 'mx_present'`
- `email_preflight.source_confirmed = 1`, within 30 days

`source_confirmed` is set only when the exact address string is found on a page
served by the company's own domain. Service and legal inboxes (`support@`,
`billing@`, `dpo@`, `hr@`, `careers@`) are never confirmed, even when genuinely
published.

**This gate is why the account has a 0% bounce rate** (228 sends, 0 real bounces —
the 81 `BOUNCED` rows are deliberate `invalid_domain_test` probes). Disabling it to
raise volume trades a working sender reputation for addresses that do not exist.
Microsoft throttles or blocks the sending domain when that happens.

---

## Components

| File | Purpose |
|---|---|
| `deploy/mysg-daily.sh` | The whole pipeline. Runs unattended. |
| `deploy/mysg-preflight.sh` | Stage + MX-check MY/SG leads (DNS only). |
| `web/scripts/verify-mysg-sources.mjs` | Confirms addresses on official sites. |

`verify-mysg-sources.mjs` exists because `verify-and-confirm.mjs` only handles
leads whose email was empty and filled in by discovery. MY/SG leads already carry an
address, so that script skipped all of them and left `source_confirmed = 0`
forever. This one walks the pools directly.

### Pacing: 100/day total

| Mailbox | Daily | Hourly | Window |
|---|---|---|---|
| `bryanlai@openclose-desk.com` | 50 | 15 | 60–120s |
| `bryan@openclose-desk.com` | 50 | 15 | 60–120s |
| **Combined** | **100** | 30 | |

The SQL in `mysg-daily.sh` divides the daily budget across however many mailboxes
exist, so the pair cannot exceed 100/day regardless of how the dispatcher splits
work.

---

## Install

```bash
scp deploy/mysg-daily.sh deploy/mysg-preflight.sh root@<host>:/usr/local/bin/
ssh root@<host>
mv /usr/local/bin/mysg-daily.sh /usr/local/bin/outbounder-mysg-daily
mv /usr/local/bin/mysg-preflight.sh /usr/local/bin/outbounder-mysg-preflight
chmod +x /usr/local/bin/outbounder-mysg-*

# every 30 min, so a finished run is replaced promptly
cat > /etc/cron.d/outbounder-mysg <<'EOF'
*/30 * * * * root /usr/local/bin/outbounder-mysg-daily >/dev/null 2>&1
EOF
chmod 0644 /etc/cron.d/outbounder-mysg
```

Override the ceiling with `MYSG_MAX_PER_DAY` (default 100).

Run once by hand to confirm: `/usr/local/bin/outbounder-mysg-daily`

---

## Guards

- Never starts a second run while one is active
- Never stacks new work on a non-empty queue
- Stops at the daily ceiling
- Halts after two consecutive failures rather than retrying forever
- Every start is written to `/var/lib/outbounder/automation/send-ledger.csv`
- All output appended to `/var/lib/outbounder/automation/nightly.log`

## Known follow-ups

- `web/lib/email-discovery.mjs` has no `AbortSignal.timeout` and walks up to 8
  paths per domain, so discovery is slow. Worth a timeout.
- `bryan@openclose-desk.com` shared an SMTP user with `bryanlai@` and hit
  `5.2.252 SendAsDenied` (5 failures, 2026-10-05/06). Confirm Send As permission
  in M365 admin, or give each mailbox its own credentials.
- 189 of 247 MX-present MY/SG leads were not found on their official contact pages.
  These are real companies with real mail servers; the address just is not published
  on a page the verifier visits. Worth widening `PATHS` in the verifier.