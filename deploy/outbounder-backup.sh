#!/bin/sh
# Daily consistent SQLite backup + retention.
# Uses sqlite3's online .backup so a running dispatcher is never corrupted.
set -eu

DATA_DIR=/var/lib/outbounder
DB="$DATA_DIR/leads.sqlite"
BACKUP_DIR="$DATA_DIR/backups"
STAMP="$(date +%F)"
TARGET="$BACKUP_DIR/leads-$STAMP.sqlite"

[ -f "$DB" ] || exit 0
mkdir -p "$BACKUP_DIR"

sqlite3 "$DB" ".backup '$TARGET'"
gzip -f "$TARGET"

# keep 14 daily copies
find "$BACKUP_DIR" -name 'leads-*.sqlite.gz' -mtime +14 -delete

echo "outbounder backup: $(basename "$TARGET").gz ($(du -h "$TARGET.gz" | cut -f1))"