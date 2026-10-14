#!/bin/bash
# Normalize line endings for shell scripts after extraction.
#
# Why: the local git checkout uses core.autocrlf=true on Windows, so files can
# reach the server with CRLF endings. A CRLF shebang (#!/bin/sh^M) makes the
# script unrunnable, which is how the nightly backup silently stopped working.
set -uo pipefail

TARGETS=("$@")
[ ${#TARGETS[@]} -eq 0 ] && TARGETS=(/opt/outbounder /root/outbounder-deploy /etc/cron.daily)

FIXED=0
CHECKED=0
for dir in "${TARGETS[@]}"; do
  [ -d "$dir" ] || continue
  while IFS= read -r -d '' f; do
    CHECKED=$((CHECKED + 1))
    # Only touch files that genuinely contain CR bytes.
    if grep -qU $'\r' "$f" 2>/dev/null; then
      sed -i 's/\r$//' "$f"
      FIXED=$((FIXED + 1))
      echo "  normalized: $f"
    fi
  done < <(find "$dir" -maxdepth 2 -type f \( -name '*.sh' -o -name 'outbounder-*' \) 2>/dev/null)
done

# The installed cron script matters most, so fix it explicitly and make it runnable.
if [ -f /etc/cron.daily/outbounder-backup ]; then
  sed -i 's/\r$//' /etc/cron.daily/outbounder-backup
  chmod 0755 /etc/cron.daily/outbounder-backup
fi

echo "line-ending check: $CHECKED scripts inspected, $FIXED normalized"