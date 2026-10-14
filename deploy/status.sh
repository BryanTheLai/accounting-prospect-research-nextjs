#!/bin/bash
# One-shot status report for the Outbounder server.
# Usage: bash status.sh   (run from anywhere; SSHes in)
set -uo pipefail
HOST="${OUTBOUNDER_HOST:-root@152.42.242.178}"
ssh "$HOST" 'bash -s' <<'REMOTE'
set -uo pipefail
DB=/var/lib/outbounder/leads.sqlite
STATE=/var/lib/outbounder/automation

echo "================ SERVICES ================"
printf "  web         %s\n" "$(systemctl is-active outbounder-web)"
printf "  dispatcher  %s\n" "$(systemctl is-active outbounder-dispatcher)"
printf "  proxy       %s\n" "$(systemctl is-active caddy)"

echo
echo "================ SENDING ================"
grep -q 'ENABLE_LIVE_DISPATCH=true' /opt/outbounder/.env \
  && echo "  live dispatch  ON" || echo "  live dispatch  OFF"
sqlite3 "$DB" "SELECT '  ' || email || '  ' || daily_limit || '/day  ' || hourly_limit || '/hr' FROM mailboxes;"
TODAY=$(date +%F)
sqlite3 "$DB" "SELECT '  sent today: ' || COUNT(*) FROM campaign_sends WHERE date(sent_at)='$TODAY' AND status='SENT';"
sqlite3 "$DB" "SELECT '  queue pending: ' || COUNT(*) FROM dispatch_queue WHERE status IN ('PENDING','IN_FLIGHT','UNCERTAIN');"

echo
echo "================ DATA ==================="
sqlite3 "$DB" "SELECT '  prospects   ' || COUNT(*) FROM prospects;"
sqlite3 "$DB" "SELECT '  approved    ' || COUNT(*) FROM prospects WHERE status='Approved for Outreach';"
sqlite3 "$DB" "SELECT '  no email    ' || COUNT(*) FROM prospects WHERE trim(coalesce(contact_email,''))='' AND status IN ('Ready to Review','NEW');"
echo "  integrity    $(sqlite3 "$DB" 'PRAGMA quick_check;')"

echo
echo "================ BACKUP ================="
LAST=$(ls -1t /var/lib/outbounder/backups/leads-*.sqlite.gz 2>/dev/null | head -1)
if [ -n "$LAST" ]; then
  echo "  latest  $(basename "$LAST")  $(du -h "$LAST" | cut -f1)"
  gzip -t "$LAST" 2>/dev/null && echo "  status  verified restorable" || echo "  status  CORRUPT"
else
  echo "  none yet"
fi

echo
echo "================ DISCOVERY ==============="
if [ -f "$STATE/discovery-results.json" ]; then
  python3 - <<'PY'
import json
rows = json.load(open("/var/lib/outbounder/automation/discovery-results.json"))
found = [r for r in rows if (r.get("discovery") or {}).get("candidates")]
print("  processed: %d" % len(rows))
print("  with a published address: %d" % len(found))
print("  candidate addresses: %d" % sum(len(r["discovery"]["candidates"]) for r in found))
PY
else
  echo "  no results yet"
fi
pgrep -f discover-published-emails >/dev/null && echo "  status  RUNNING" || echo "  status  idle"

echo
echo "================ NIGHTLY LOG ============="
tail -4 /var/lib/outbounder/automation/nightly.log 2>/dev/null || echo "  (not run yet)"
echo
echo "next nightly run: 02:17 server time"
REMOTE