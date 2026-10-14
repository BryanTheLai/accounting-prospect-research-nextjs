#!/usr/bin/env bash
# One-shot bootstrap for the Outbounder dispatcher + web on Ubuntu 24.04.
# Run as root on a fresh DigitalOcean Droplet:
#   scp -r deploy root@YOUR_IP:/root/outbounder-deploy
#   ssh root@YOUR_IP 'bash /root/outbounder-deploy/deploy/bootstrap.sh'
#
# NOTE: invoke with `bash <script>` or rely on the shebang. pipefail is a bashism,
# so re-exec under bash if this happens to be started by /bin/sh.
if [ -z "${BASH_VERSION:-}" ]; then exec /usr/bin/env bash "$0" "$@"; fi
set -euo pipefail

APP_DIR=/opt/outbounder
DATA_DIR=/var/lib/outbounder
SVC_USER=outbounder

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }

log "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# Node 22 via NodeSource (Ubuntu 24.04 ships Node 18, which Next 16 does not support).
if [ "$(node --version 2>/dev/null | cut -d. -f1)" != "22" ] && [ "$(node --version 2>/dev/null | cut -d. -f1)" != "20" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
fi

# apt can transiently fail right after adding a new source; retry and let dpkg
# finish any interrupted configuration before giving up.
# Install in small stages. Asking apt for the whole list at once can fail with
# "held broken packages" right after a new source is added, even when every
# package is individually fine.
apt_retry() {
  local attempt pkg
  for attempt in 1 2 3; do
    dpkg --configure -a >/dev/null 2>&1 || true
    local ok=1
    for pkg in "$@"; do
      if ! apt-get install -y -qq "$pkg" >/dev/null 2>&1; then
        echo "  retry: $pkg"
        ok=0
      fi
    done
    [ "$ok" -eq 1 ] && return 0
    sleep 5
  done
  return 1
}

apt_retry python3 python3-venv python3-pip ca-certificates curl
apt_retry sqlite3 rsync ufw
apt_retry nodejs
# npm can refuse to install as its own package on some images even when a working
# npm already ships with node. Only fail the run if there is genuinely no npm.
apt_retry npm || true
if ! command -v npm >/dev/null 2>&1; then
  log "npm is missing; installing via corepack"
  corepack enable || npm i -g npm || { echo "Could not install npm"; exit 1; }
fi
node --version; npm --version

log "Creating service user and directories"
if ! id -u "$SVC_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/$SVC_USER --shell /usr/sbin/nologin "$SVC_USER"
fi
mkdir -p "$APP_DIR" "$DATA_DIR" "$DATA_DIR/backups"
chown -R "$SVC_USER:$SVC_USER" "$DATA_DIR"

log "Installing Python dependencies"
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --quiet --upgrade pip
# The dispatcher imports email_verifier -> dns.resolver, so dnspython is required.
# The other third-party packages (streamlit/pandas/weasyprint/openpyxl) belong to
# the legacy research scripts and are not needed to run the service.
"$APP_DIR/venv/bin/pip" install --quiet python-dotenv dnspython

log "Ensuring swap (small droplets may have none; the build needs headroom)"
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 1024 ]; then
  if [ ! -f /swapfile ]; then
    fallocate -l 1G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none
    chmod 600 /swapfile
    mkswap -q /swapfile >/dev/null 2>&1 || true
  fi
  swapon /swapfile 2>/dev/null || true
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log "Swap enabled (1G)"
fi

log "Copying application source into $APP_DIR"
SRC_DIR="${SRC_DIR:-/root/outbounder-deploy}"
if [ ! -d "$SRC_DIR/web" ]; then
  echo "Expected to find the app at $SRC_DIR/web but it is missing."
  echo "Upload the repo (web/ and *.py) to $SRC_DIR first."
  exit 1
fi
# web/ then the Python modules the dispatcher imports
mkdir -p "$APP_DIR"
rm -rf "$APP_DIR/web"
cp -a "$SRC_DIR/web" "$APP_DIR/web"
rm -rf "$APP_DIR/web/node_modules" "$APP_DIR/web/.next" "$APP_DIR/web/.next-qa"
cp -a "$SRC_DIR"/*.py "$APP_DIR/" 2>/dev/null || true
cp -a "$SRC_DIR/deploy" "$APP_DIR/deploy" 2>/dev/null || true
log "Source copied"

log "Installing Node dependencies and building the web app"
cd "$APP_DIR/web"
npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund
# Cap V8 heap so the build does not get OOM-killed on a 512 MB droplet.
export NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_HEAP:-384}"
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