#!/bin/bash
# Update the running app from the local git checkout.
#
# Run this on YOUR LAPTOP after you commit and push:
#   bash deploy/update.sh
#
# It archives the current branch, ships it over SSH, rebuilds on the server
# and restarts. The database and .env on the server are left untouched.
set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
HOST="${OUTBOUNDER_HOST:-root@152.42.242.178}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> branch: $BRANCH"

echo "==> verifying the tree is committed"
# Ignore line-ending-only differences: they are not real edits and must not
# block a deploy. Only substantive changes are reported and block the update.
PENDING="$(git -C "$REPO" diff --numstat --ignore-all-space \
            | grep -vE '^[0-9]+\s+0\s+|^-\s+-\s+' || true)"
if [ -n "$PENDING" ]; then
  echo "    real uncommitted changes found:"
  echo "$PENDING" | head -20
  echo "    commit them first, or re-run after committing."
  exit 1
fi
echo "    clean (ignoring line-ending differences)"

echo "==> creating archive"
git -C "$REPO" archive --format=tar -o "$TMP/src.tar" HEAD
gzip -f "$TMP/src.tar"

echo "==> uploading to $HOST"
scp -q "$TMP/src.tar.gz" "$HOST:/root/update.tar.gz"

echo "==> deploying on the server"
ssh "$HOST" 'bash -s' <<'REMOTE'
set -e
gzip -t /root/update.tar.gz
rm -rf /root/update-stage && mkdir -p /root/update-stage
tar -xf /root/update.tar.gz -C /root/update-stage
cd /root/update-stage

# Refresh the deploy source directory (bootstrap reads from here).
rm -rf /root/outbounder-deploy/web
cp -a web /root/outbounder-deploy/web
cp -a deploy /root/outbounder-deploy/deploy 2>/dev/null || true
cp -a ./*.py /root/outbounder-deploy/ 2>/dev/null || true

# The Windows checkout uses core.autocrlf, so shell scripts can arrive with CRLF
# endings. A CRLF shebang makes them unrunnable, which silently broke the nightly
# backup once already. Normalize before anything executes them.
if [ -x /usr/local/bin/outbounder-fix-eol ]; then
  /usr/local/bin/outbounder-fix-eol
else
  sed -i 's/\r$//' /root/outbounder-deploy/deploy/*.sh
  echo "normalized deploy scripts"
fi

# bootstrap now preserves an existing database and .env.
SRC_DIR=/root/outbounder-deploy bash /root/outbounder-deploy/deploy/bootstrap.sh > /tmp/update.log 2>&1
grep -E 'Existing database|Database seeded|Compiled successfully' /tmp/update.log | tail -3

systemctl restart outbounder-web outbounder-dispatcher
sleep 15
echo "web:        $(systemctl is-active outbounder-web)"
echo "dispatcher: $(systemctl is-active outbounder-dispatcher)"
rm -f /root/update.tar.gz
rm -rf /root/update-stage
REMOTE

echo "==> done. Verify with:"
echo "    curl -s http://127.0.0.1:3000/api/dispatch?summary=1 | head -c 200"