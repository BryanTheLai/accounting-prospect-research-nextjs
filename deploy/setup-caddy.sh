#!/bin/bash
# Install Caddy as an HTTPS reverse proxy with basic auth in front of the app.
# Usage: bash setup-caddy.sh <password> [domain]
set -e

APP_PASSWORD="${1:?usage: setup-caddy.sh <password> [domain]}"
APP_DOMAIN="${2:-}"

export DEBIAN_FRONTEND=noninteractive

echo "=== installing caddy ==="
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null 2>&1
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi
caddy version

HASH=$(caddy hash-password --plaintext "$APP_PASSWORD")

if [ -n "$APP_DOMAIN" ]; then
  echo "=== configuring HTTPS for $APP_DOMAIN ==="
  cat > /etc/caddy/Caddyfile <<EOF
$APP_DOMAIN {
    encode gzip
    basic_auth {
        admin $HASH
    }
    reverse_proxy 127.0.0.1:3000
}
EOF
else
  echo "=== configuring plain-HTTP on :80 (no domain supplied) ==="
  cat > /etc/caddy/Caddyfile <<EOF
:80 {
    encode gzip
    basic_auth {
        admin $HASH
    }
    reverse_proxy 127.0.0.1:3000
}
EOF
fi

echo "=== opening port 80/443 ==="
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true

systemctl restart caddy
sleep 4
systemctl is-active caddy

echo
echo "=== Caddyfile ==="
sed -E 's/\$2[aby]\$[^\s]+/<hash>/' /etc/caddy/Caddyfile

echo
echo "=== test through the proxy ==="
curl -s -o /dev/null -w 'without auth: HTTP %{http_code}\n' http://127.0.0.1:80/
curl -s -o /dev/null -w 'with auth:    HTTP %{http_code}\n' -u "admin:$APP_PASSWORD" http://127.0.0.1:80/