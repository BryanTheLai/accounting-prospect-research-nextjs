#!/usr/bin/env bash
# One-shot bootstrap for the Outbounder dispatcher + web on Ubuntu 24.04.
# Run as root on a fresh DigitalOcean Droplet:
#   scp -r deploy root@YOUR_IP:/root/outbounder-deploy
#   ssh root@YOUR_IP 'bash /root/outbounder-deploy/deploy/bootstrap.sh'
set -euo pipefail

APP_DIR=/opt/outbounder
DATA_DIR=/var/lib/outbounder
SVC_USER=outbounder

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }

log "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip nodejs npm sqlite3 rsync ca-certificates curl ufw

log "Creating service user and directories"
if ! id -u "$SVC_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/$SVC_USER --shell /usr/sbin/nologin "$SVC_USER"
fi
mkdir -p "$APP_DIR" "$DATA_DIR" "$DATA_DIR/backups"
chown -R "$SVC_USER:$SVC_USER" "$DATA_DIR"

log "Installing Python dependencies"
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/venv/bin/pip" install --quiet python-dotenv

log "Installing Node dependencies and building the web app"
cd "$APP_DIR/web"
npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
npm run build

log "Seeding the database from the uploaded file (if present)"
if [ -f /root/outbounder-deploy/leads.sqlite ]; then
  cp /root/outbounder-deploy/leads.sqlite "$DATA_DIR/leads.sqlite"
  sqlite3 "$DATA_DIR/leads.sqlite" 'PRAGMA journal_mode=WAL;'
  sqlite3 "$DATA_DIR/leads.sqlite" 'PRAGMA quick_check;' | sed 's/^/  quick_check: /'
  chown "$SVC_USER:$SVC_USER" "$DATA_DIR/leads.sqlite"
  log "Database seeded"
else
  log "No leads.sqlite supplied - the app will create an empty one"
fi

log "Writing the environment file (EDIT SECRETS BEFORE FIRST SEND)"
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<'ENVEOF'
# ---- Runtime ----
OUTBOUNDER_DB_PATH=/var/lib/outbounder/leads.sqlite
OUTBOUNDER_DISPATCHER_PORT=8765
# MUST be changed to a long random string before the first run.
OUTBOUNDER_CONTROL_TOKEN=CHANGE_ME_generate_with_openssl_rand_base64_32
# Keep false until a batch is reviewed and explicitly confirmed.
ENABLE_LIVE_DISPATCH=false

# ---- Optional ----
# PRIMARY_DOMAIN=yourdomain.com
ENVEOF
  chmod 600 "$APP_DIR/.env"
  echo "  wrote $APP_DIR/.env with a placeholder token"
fi

log "Installing systemd services"
install -m 0644 /root/outbounder-deploy/deploy/outbounder-web.service /etc/systemd/system/outbounder-web.service
install -m 0644 /root/outbounder-deploy/deploy/outbounder-dispatcher.service /etc/systemd/system/outbounder-dispatcher.service

log "Installing the daily backup job"
install -m 0755 /root/outbounder-deploy/deploy/outbounder-backup.sh /etc/cron.daily/outbounder-backup

systemctl daemon-reload
systemctl enable outbounder-web outbounder-dispatcher >/dev/null 2>&1 || true

log "Configuring the firewall (SSH stays open; app is loopback-only)"
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true

log "Done. Next steps:"
cat <<'EOF'

  1. Set a real control token and enable live sending later:
       ssh root@YOUR_IP
       nano /opt/outbounder/.env
       #   OUTBOUNDER_CONTROL_TOKEN=<openssl rand -base64 32>
       systemctl restart outbounder-web outbounder-dispatcher

  2. Start the services:
       systemctl start outbounder-web outbounder-dispatcher
       systemctl status outbounder-web outbounder-dispatcher

  3. Put the UI behind authentication (Caddy basic auth or a VPN).
     The app intentionally listens on 127.0.0.1 only and the firewall
     blocks everything except SSH.

  4. Verify the backup job:
       /etc/cron.daily/outbounder-backup && ls -la /var/lib/outbounder/backups

EOF