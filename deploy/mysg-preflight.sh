#!/bin/bash
# Stage every MY/SG lead that has a real email but has never been preflighted,
# then MX-check them all. Needs no SMTP and no decisions from the operator.
#
# Pools: hydroball_clones, jobstreet_hiring_pain, mysg_consumer_retail_accounting
set -uo pipefail
DB=/var/lib/outbounder/leads.sqlite
BASE=http://127.0.0.1:3000
LOG=/var/lib/outbounder/automation/nightly.log
STAMP=$(date '+%Y-%m-%dT%H:%M:%S+00:00')

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') mysg-stage: $*" | tee -a "$LOG"; }

echo "=== 1. stage MY/SG leads into email_preflight ==="
sqlite3 "$DB" <<SQL
INSERT INTO email_preflight (lead_id, email, mx_status, mx_hosts, checked_at, source_confirmed, source_confirmed_at)
SELECT p.lead_id, lower(trim(p.contact_email)), 'not_checked', '[]', '$STAMP', 0, NULL
  FROM prospects p
 WHERE p.campaign_id IN ('hydroball_clones','jobstreet_hiring_pain','mysg_consumer_retail_accounting')
   AND trim(coalesce(p.contact_email,'')) <> ''
   AND instr(p.contact_email,'@') > 1
   AND p.lead_id NOT IN (SELECT lead_id FROM email_preflight)
ON CONFLICT(lead_id) DO NOTHING;
SQL
sqlite3 "$DB" "SELECT '  staged for checking: ' || COUNT(*) FROM email_preflight WHERE mx_status='not_checked';"

echo
echo "=== 2. MX preflight every MY/SG candidate ==="
sqlite3 "$DB" "
SELECT e.lead_id || '|' || e.email FROM email_preflight e
 JOIN prospects p ON p.lead_id = e.lead_id
WHERE e.mx_status='not_checked'
  AND p.campaign_id IN ('hydroball_clones','jobstreet_hiring_pain','mysg_consumer_retail_accounting')
ORDER BY e.lead_id;" > /tmp/mysg-pairs.txt

TOTAL=$(wc -l < /tmp/mysg-pairs.txt)
echo "  checking $TOTAL addresses (DNS only, no SMTP)..."

OK=0; BAD=0; N=0
while IFS='|' read -r id email; do
  [ -z "$id" ] && continue
  N=$((N+1))
  RESP=$(curl -s -m 25 -X POST "$BASE/api/email-preflight" \
    -H 'Content-Type: application/json' \
    -d "{\"action\":\"check\",\"leadId\":\"$id\",\"email\":\"$email\"}" 2>/dev/null)
  case "$RESP" in
    *mx_present*)  OK=$((OK+1)) ;;
    *no_mx*|*invalid_syntax*|*lookup_error*) BAD=$((BAD+1)) ;;
    *) BAD=$((BAD+1)) ;;
  esac
  if [ $((N % 50)) -eq 0 ]; then echo "  ...$N/$TOTAL  mx_ok=$OK  rejected=$BAD"; fi
done < /tmp/mysg-pairs.txt

echo
echo "  checked $N total"
echo "  mx_present : $OK"
echo "  rejected   : $BAD"
log "MX preflight on MY/SG: $OK deliverable, $BAD rejected, of $TOTAL"

echo
echo "=== 3. result by pool ==="
sqlite3 -header -column "$DB" "
SELECT p.campaign_id,
       COUNT(*) AS checked,
       SUM(CASE WHEN e.mx_status='mx_present' THEN 1 ELSE 0 END) AS mx_ok,
       SUM(CASE WHEN e.mx_status='no_mx' THEN 1 ELSE 0 END) AS no_mx,
       SUM(CASE WHEN e.mx_status='invalid_syntax' THEN 1 ELSE 0 END) AS bad_syntax,
       SUM(CASE WHEN e.mx_status='lookup_error' THEN 1 ELSE 0 END) AS lookup_err
FROM email_preflight e JOIN prospects p ON p.lead_id=e.lead_id
WHERE p.campaign_id IN ('hydroball_clones','jobstreet_hiring_pain','mysg_consumer_retail_accounting')
GROUP BY p.campaign_id;"