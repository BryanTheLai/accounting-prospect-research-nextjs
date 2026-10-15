#!/bin/bash
# MY/SG daily pipeline: discover -> preflight -> verify -> approve -> send.
#
# Everything here is unattended. The operator does not approve, review, or
# start anything by hand. Verification is still enforced (an address must be
# literally published on the company's own site) because that gate is why the
# account has a 0% bounce rate; what changed is that a machine applies it now
# instead of a person.
#
# Ceiling is 100/day TOTAL across all mailboxes (50 + 50), enforced by
# mailbox pacing as well as the per-run cap below.
set -uo pipefail

DB=/var/lib/outbounder/leads.sqlite
BASE=http://127.0.0.1:3000
LOG=/var/lib/outbounder/automation/nightly.log
LEDGER=/var/lib/outbounder/automation/send-ledger.csv
STATE=/var/lib/outbounder/automation/autosend.state
APP=/opt/outbounder/web
POOLS="('hydroball_clones','jobstreet_hiring_pain','mysg_consumer_retail_accounting')"
STAMP=$(date '+%F')

mkdir -p /var/lib/outbounder/automation
touch "$LEDGER"
[ -f "$STATE" ] || echo 0 > "$STATE"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') mysg: $*" | tee -a "$LOG"; }

MAX_PER_DAY="${MYSG_MAX_PER_DAY:-100}"
TPL_A_ID="${MYSG_TPL_A:-84018}"
TPL_B_ID="${MYSG_TPL_B:-89087}"
TPL_A=$(sqlite3 "$DB" "SELECT name FROM outbound_templates WHERE template_id=$TPL_A_ID;")
TPL_B=$(sqlite3 "$DB" "SELECT name FROM outbound_templates WHERE template_id=$TPL_B_ID;")

if [ -z "$TPL_A" ] || [ -z "$TPL_B" ]; then
  log "MY/SG templates $TPL_A_ID/$TPL_B_ID missing; aborting"
  exit 1
fi

log "start: ceiling=${MAX_PER_DAY}/day, templates set"

# ---------------------------------------------------------------- 1. preflight
sqlite3 "$DB" <<SQL
INSERT INTO email_preflight (lead_id, email, mx_status, mx_hosts, checked_at, source_confirmed, source_confirmed_at)
SELECT p.lead_id, lower(trim(p.contact_email)), 'not_checked', '[]', '$(date '+%Y-%m-%dT%H:%M:%S+00:00')', 0, NULL
  FROM prospects p
 WHERE p.campaign_id IN $POOLS
   AND trim(coalesce(p.contact_email,'')) <> ''
   AND instr(p.contact_email,'@') > 1
   AND p.lead_id NOT IN (SELECT lead_id FROM email_preflight)
ON CONFLICT(lead_id) DO NOTHING;
SQL

sqlite3 "$DB" "SELECT e.lead_id || '|' || e.email FROM email_preflight e
  JOIN prospects p ON p.lead_id = e.lead_id
 WHERE e.mx_status='not_checked' AND p.campaign_id IN $POOLS
 ORDER BY e.lead_id LIMIT 250;" > /tmp/mysg-pf.txt

if [ -s /tmp/mysg-pf.txt ]; then
  OKC=0; BADC=0
  while IFS='|' read -r id email; do
    [ -z "$id" ] && continue
    RESP=$(curl -s -m 25 -X POST "$BASE/api/email-preflight" \
      -H 'Content-Type: application/json' \
      -d "{\"action\":\"check\",\"leadId\":\"$id\",\"email\":\"$email\"}" 2>/dev/null)
    case "$RESP" in
      *mx_present*) OKC=$((OKC+1)) ;;
      *) BADC=$((BADC+1)) ;;
    esac
  done < /tmp/mysg-pf.txt
  log "preflight: $OKC mx_present, $BADC rejected"
fi

# ------------------------------------------------------- 2. source verification
# Confirm the address is literally published on the official company site.
# Uses the app's own verifier, which enforces the service/HR/legal blocklist.
cd "$APP" 2>/dev/null || { log "app dir missing; cannot verify"; exit 1; }
if [ -f scripts/verify-and-confirm.mjs ]; then
  OUTBOUNDER_DB_PATH="$DB" node --experimental-strip-types scripts/verify-and-confirm.mjs \
    >> /var/lib/outbounder/automation/verify.log 2>&1
  log "source verification pass complete"
fi

# ------------------------------------------------------------- 3. auto-approve
# Only MX-present, source-confirmed, unsuppressed, unsent addresses.
sqlite3 "$DB" <<SQL
UPDATE prospects SET status='Approved for Outreach',
       notes = trim(coalesce(notes,'') || char(10) || 'Auto-approved: MX present and address confirmed published on official site.')
 WHERE campaign_id IN $POOLS
   AND status <> 'Approved for Outreach'
   AND lead_id IN (SELECT e.lead_id FROM email_preflight e
                    WHERE e.source_confirmed=1 AND e.mx_status='mx_present'
                      AND e.source_confirmed_at IS NOT NULL
                      AND julianday('now')-julianday(e.source_confirmed_at) <= 30)
   AND NOT EXISTS (SELECT 1 FROM email_suppression x
                    WHERE lower(trim(x.email))=lower(trim(prospects.contact_email)));
SQL
APPROVED=$(sqlite3 "$DB" "SELECT COUNT(*) FROM prospects WHERE campaign_id IN $POOLS AND status='Approved for Outreach';")
log "auto-approve pass complete; approved pool = $APPROVED"

# -------------------------------------------------------------- 4. send 100/day
snap() {
  curl -s -m 15 "$BASE/api/dispatch?summary=1" 2>/dev/null \
    | python3 -c "import json,sys;print(json.load(sys.stdin)['snapshot'].get('$1'))" 2>/dev/null
}

[ "$(snap is_running)" = "True" ] && { log "run active; leaving it alone"; exit 0; }

PENDING=$(snap queue_pending); PENDING=${PENDING:-1}
if [ "${PENDING}" -gt 0 ] 2>/dev/null; then log "queue busy ($PENDING pending)"; exit 0; fi

SENT_TODAY=$(sqlite3 "$DB" "SELECT COUNT(*) FROM campaign_sends
  WHERE date(sent_at)=date('now') AND status='SENT'
    AND coalesce(response_msg,'') NOT LIKE '%[DRY-RUN%';")
ROOM=$((MAX_PER_DAY - SENT_TODAY))
log "sent today=$SENT_TODAY, room=$ROOM of $MAX_PER_DAY"
[ "${ROOM}" -le 0 ] && { log "daily ceiling reached"; exit 0; }

sqlite3 "$DB" > /tmp/mysg-ids.json <<SQL
SELECT json_group_array(lead_id) FROM (
  SELECT p.lead_id FROM prospects p
    JOIN email_preflight e ON e.lead_id=p.lead_id
   WHERE p.campaign_id IN $POOLS
     AND p.status='Approved for Outreach'
     AND trim(coalesce(p.contact_email,'')) <> ''
     AND e.source_confirmed=1 AND e.mx_status='mx_present'
     AND e.source_confirmed_at IS NOT NULL
     AND julianday('now')-julianday(e.source_confirmed_at) <= 30
     AND NOT EXISTS (SELECT 1 FROM email_suppression x
                      WHERE lower(trim(x.email))=lower(trim(p.contact_email)))
     AND NOT EXISTS (SELECT 1 FROM campaign_sends s
                      WHERE lower(trim(s.recipient_email))=lower(trim(p.contact_email))
                        AND coalesce(s.response_msg,'') NOT LIKE '%[DRY-RUN%')
   ORDER BY p.lead_id
);
SQL

IDS=$(python3 -c "
import json,sys
raw=open('/tmp/mysg-ids.json').read().strip()
ids=json.loads(raw) if raw and raw!='null' else []
print(json.dumps(ids[:int(sys.argv[1])]))" "$ROOM")
COUNT=$(python3 -c "import json,sys;print(len(json.loads(sys.argv[1])))" "$IDS")

if [ "${COUNT:-0}" -lt 1 ]; then log "no verified unsent MY/SG recipients"; exit 0; fi

BODY=$(python3 - "$IDS" "$TPL_A" "$TPL_B" <<'PY'
import json,sys
print(json.dumps({"action":"start","leadIds":json.loads(sys.argv[1]),
                  "campaignId":"all","templateAName":sys.argv[2],
                  "templateBName":sys.argv[3],"liveConfirmed":True}))
PY
)
RESP=$(curl -s -m 120 -X POST "$BASE/api/dispatch" -H 'Content-Type: application/json' -d "$BODY" 2>/dev/null)

if echo "$RESP" | grep -qi '"error"'; then
  F=$(cat "$STATE" 2>/dev/null || echo 0); F=$((F+1)); echo "$F" > "$STATE"
  log "start FAILED (attempt $F): $(echo "$RESP" | head -c 200)"
  exit 1
fi
echo 0 > "$STATE"
RUN_ID=$(echo "$RESP" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('run_id') or d.get('snapshot',{}).get('run_id') or '')" 2>/dev/null || echo "")
printf '%s,%s,%s,mysg\n' "$STAMP" "${RUN_ID:-unknown}" "$COUNT" >> "$LEDGER"
log "queued $COUNT MY/SG recipients (run ${RUN_ID:-unknown})"