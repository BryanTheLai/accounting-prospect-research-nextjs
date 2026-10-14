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
if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
  echo "    uncommitted changes found:"
  git -C "$REPO" status --short
  echo "    commit them first, or re-run after committing."
  exit 1
fi

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