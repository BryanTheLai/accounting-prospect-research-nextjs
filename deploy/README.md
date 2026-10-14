# Deploying to a DigitalOcean VPS

Gets the app, the send dispatcher, and your existing database running on an
always-on Ubuntu box — no rewriting, no schema migration, nothing to learn.

**Cost:** Basic 1 vCPU / 1 GB RAM droplet in `SGP1`, about **$6/month**.
(Do not pick the $4 tier — 512 MB is too small to build the Next.js app.)

## 1. Create the Droplet

In the DigitalOcean console: **Droplets → Create Droplet**

| Setting | Value |
|---|---|
| Region | **SGP1** (Singapore) |
| Image | **Ubuntu 24.04 LTS x64** |
| Size | Basic → **1 GB RAM** (`s-1vcpu-1gb`) |
| Authentication | **SSH key** (recommended) or root password |
| Backups | tick **Daily** |

Note the public IP.

## 2. Upload the code and your database

From your laptop, in the repo folder:

```powershell
# whole app source (deploy/ folder included)
scp -r web *.py C:\Users\wbrya\OneDrive\Documents\GitHub\accounting-prospect-research-nextjs\deploy root@YOUR_IP:/root/outbounder-deploy/
```

Actually — run this from the repo root so paths line up:

```powershell
cd C:\Users\wbrya\OneDrive\Documents\GitHub\accounting-prospect-research-nextjs
ssh root@YOUR_IP 'mkdir -p /root/outbounder-deploy'
scp -r web deploy root@YOUR_IP:/root/outbounder-deploy/
scp *.py root@YOUR_IP:/root/outbounder-deploy/
scp operations\recovered-leads-20261008\leads.sqlite root@YOUR_IP:/root/outbounder-deploy/
```

> Stop your local app first (`Ctrl+C` in the running window) so the `.sqlite`
> file isn't being written while it copies.

## 3. Run the bootstrap

```powershell
ssh root@YOUR_IP 'bash /root/outbounder-deploy/deploy/bootstrap.sh'
```

It installs Node/Python/sqlite, builds the app, seeds the database, writes the
systemd services, sets up daily backups, and locks the firewall down to SSH-only.

## 4. Set a real control token, then start

```powershell
ssh root@YOUR_IP
openssl rand -base64 32          # copy the output
nano /opt/outbounder/.env        # paste it into OUTBOUNDER_CONTROL_TOKEN
systemctl start outbounder-web outbounder-dispatcher
systemctl status outbounder-web outbounder-dispatcher
```

Keep `ENABLE_LIVE_DISPATCH=false` until you've reviewed and confirmed a batch.

## 5. Reach the UI

The app listens on `127.0.0.1` on purpose and the firewall blocks everything
except SSH — so it's not exposed. Two ways in:

**Option A — SSH tunnel (nothing to set up on the server):**

```powershell
ssh -L 3000:127.0.0.1:3000 root@YOUR_IP
```

Then open <http://127.0.0.1:3000> on your laptop. This is the safest option.

**Option B — Caddy with basic auth, for access from anywhere:**

```bash
apt-get install -y caddy
```

Create `/etc/caddy/Caddyfile`:

```
outbounder.yourdomain.com {
    basic_auth {
        admin $2a$14$REPLACE_WITH_HASH_FROM_COMMAND_BELOW
    }
    reverse_proxy 127.0.0.1:3000
}
```

Generate the hash with `caddy hash-password`, then `systemctl reload caddy`.
Point the domain's DNS A record at the Droplet IP first.

## Operating it

```bash
systemctl restart outbounder-web outbounder-dispatcher   # after any change
journalctl -u outbounder-dispatcher -f                   # watch the sender
ls -la /var/lib/outbounder/backups/                      # confirm backups
/etc/cron.daily/outbounder-backup                        # force one now
```

## Your data

- Lives at `/var/lib/outbounder/leads.sqlite` on the Droplet's disk.
- **Survives** app restarts and server reboots.
- Daily backups run automatically (`/etc/cron.daily/outbounder-backup`), kept 14 days.
- DigitalOcean's Daily Backup also snapshots the whole Droplet.
- **If you destroy the Droplet, the disk goes with it** — that's why the local
  cron copies and the DO backups both matter. Keep your laptop copy until the
  server has run cleanly for a few days.

## Updating the code later

```powershell
cd C:\Users\wbrya\OneDrive\Documents\GitHub\accounting-prospect-research-nextjs
scp -r web deploy root@YOUR_IP:/root/outbounder-deploy/
ssh root@YOUR_IP 'cd /root/outbounder-deploy/web && npm run build && systemctl restart outbounder-web'
```