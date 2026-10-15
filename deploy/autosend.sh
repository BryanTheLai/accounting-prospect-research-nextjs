#!/bin/bash
# Start an approved run each day so dispatch continues unattended.
#
# Safety rails (all deliberate):
#   * only runs when nothing is active and no queue is pending
#   * sends explicit lead IDs, so only known-good recipients are queued
#   * daily/hourly caps (100/day, 30/hr per mailbox) and the campaign send
#     window still apply on top of this
#   * hard ceiling on messages this job may start per day
#   * two consecutive failures halt the loop instead of retrying forever
#   * every start is written to a CSV ledger and the nightly log
set -uo pipefail

AUTOMATION=/var/lib/outbounder/automation
LOG=$AUTOMATION/nightly.log
LEDGER=$AUTOMATION/send-ledger.csv
STATE=$AUTOMATION/autosend.state
DB=/var/lib/outbounder/leads.sqlite
mkdir -p "$AUTOMATION"
touch "$LEDGER"
[ -f "$STATE" ] || echo "0" > "$STATE"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') autosend: $*" | tee -a "$LOG"; }

BASE=http://127.0.0.1:3000
MAX_PER_DAY="${AUTOSEND_MAX_PER_DAY:-400}"
CAMPAIGN="${AUTOSEND_CAMPAIGN:-yc_us_expansion}"
STAMP=$(date '+%F')

# Resolve template names from the database rather than hardcoding them: these
# contain em dashes and emoji that are easy to mistype, and a wrong name fails
# the whole run.
TPL_A=${AUTOSEND_TPL_A:-$(sqlite3 "$DB" "SELECT name FROM outbound_templates WHERE template_id=88;")}
TPL_B=${AUTOSEND_TPL_B:-$(sqlite3 "$DB" "SELECT name FROM outbound_templates WHERE template_id=89;")}
if [ -z "$TPL_A" ] || [ -z "$TPL_B" ]; then
  log "template 88/89 not found; cannot start a run"
  exit 1
fi

snap() {
  curl -s -m 15 "$BASE/api/dispatch?summary=1" 2>/dev/null \
    | python3 -c "import json,sys;print(json.load(sys.stdin)['snapshot'].get('$1'))" 2>/dev/null
}

# 1. never start a second run
if [ "$(snap is_running)" = "True" ]; then log "already running"; exit 0; fi

# 2. never stack new work on an unfinished queue
PENDING=$(snap queue_pending); PENDING=${PENDING:-1}
if [ "${PENDING}" -gt 0 ] 2>/dev/null; then log "queue has ${PENDING} pending"; exit 0; fi

# 3. daily ceiling for this job
STARTED=$(awk -F, -v d="$STAMP" 'NR>1 && $1==d {s+=$3} END {print s+0}' "$LEDGER")
if [ "${STARTED:-0}" -ge "$MAX_PER_DAY" ]; then log "ceiling ${STARTED}/${MAX_PER_DAY} reached"; exit 0; fi

# 4. halt after repeated failures
FAILS=$(cat "$STATE" 2>/dev/null || echo 0)
if [ "${FAILS:-0}" -ge 2 ]; then log "halted after ${FAILS} failures"; exit 1; fi

# 5. Eligible IDs.
#    Must mirror what the dispatcher will actually accept, otherwise it
#    silently drops the rejects and reports a misleading run_total:
#      Approved for Outreach, has an email, not suppressed, not already sent,
#      AND fresh (source_confirmed + mx_present within 30 days).
sqlite3 "$DB" > /tmp/autosend-ids.json <<'SQL'
SELECT json_group_array(p.lead_id) FROM (
  SELECT p.lead_id
  FROM prospects p
  JOIN email_preflight e ON e.lead_id = p.lead_id
  WHERE p.status = 'Approved for Outreach'
    AND trim(coalesce(p.contact_email, '')) <> ''
    AND e.source_confirmed = 1
    AND e.mx_status = 'mx_present'
    AND e.source_confirmed_at IS NOT NULL
    AND julianday('now') - julianday(e.source_confirmed_at) <= 30
    AND NOT EXISTS (SELECT 1 FROM email_suppression x
                     WHERE lower(trim(x.email)) = lower(trim(p.contact_email)))
    AND NOT EXISTS (SELECT 1 FROM campaign_sends s
                     WHERE lower(trim(s.recipient_email)) = lower(trim(p.contact_email))
                       AND coalesce(s.response_msg, '') NOT LIKE '%[DRY-RUN%')
  ORDER BY p.lead_id
);
SQL

ROOM=$((MAX_PER_DAY - STARTED))
IDS=$(python3 -c "
import json, sys
raw = open('/tmp/autosend-ids.json').read().strip()
ids = json.loads(raw) if raw and raw != 'null' else []
print(json.dumps(ids[:int(sys.argv[1])]))
" "$ROOM")

COUNT=$(python3 -c "import json,sys;print(len(json.loads(sys.argv[1])))" "$IDS")
if [ "${COUNT:-0}" -lt 1 ]; then log "no approved unsent recipients left"; echo 0 > "$STATE"; exit 0; fi

log "eligible=$COUNT  room today=$ROOM  starting $COUNT"

# 6. start the run
BODY=$(python3 - "$IDS" "$CAMPAIGN" "$TPL_A" "$TPL_B" <<'PY'
import json, sys
print(json.dumps({
    "action": "start",
    "leadIds": json.loads(sys.argv[1]),
    "campaignId": sys.argv[2],
    "templateAName": sys.argv[3],
    "templateBName": sys.argv[4],
    "liveConfirmed": True,
}))
PY
)

RESP=$(curl -s -m 120 -X POST "$BASE/api/dispatch" -H 'Content-Type: application/json' -d "$BODY" 2>/dev/null)

if echo "$RESP" | grep -qi '"error"'; then
  FAILS=$((FAILS + 1)); echo "$FAILS" > "$STATE"
  log "FAILED (attempt $FAILS): $(echo "$RESP" | head -c 220)"
  exit 1
fi

echo 0 > "$STATE"
RUN_ID=$(echo "$RESP" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("run_id") or d.get("snapshot",{}).get("run_id") or "")' 2>/dev/null || echo "")
printf '%s,%s,%s,started\n' "$STAMP" "${RUN_ID:-unknown}" "$COUNT" >> "$LEDGER"
log "started run ${RUN_ID:-unknown} with $COUNT recipients"