# Hostinger VPS deployment with Docker and Nginx

Assumes **Nginx is installed on the Linux VPS host**. Host Nginx keeps ports 80/443 and handles TLS; it proxies to `127.0.0.1:8080`, where Docker serves Angular and forwards API requests. MySQL 8.4, API and automation worker stay private. Database and delivery photos use persistent Docker volumes. Copy the whole repository, not just this folder.

## First deployment

Install Docker Engine and the Compose plugin using [Docker's distribution-specific instructions](https://docs.docker.com/engine/install/). Scripts require Bash, OpenSSL, gzip and tar, and permission to run Docker. Leave enough RAM/disk for Angular builds and MySQL; builds can use more memory than runtime.

Point your domain's A record to the Hostinger VPS. Only add an AAAA record if IPv6 reaches it. Allow TCP 80/443 and SSH in Hostinger and OS firewalls. Keep ports 8080, 3000 and 3306 private.

```bash
cd /path/to/tnl/deployment
bash manage.sh init
nano .env
bash manage.sh deploy
bash manage.sh admin
```

Set `APP_DOMAIN` to your domain without scheme/path. `init` generates random database, root and JWT secrets and never overwrites `.env`. Configure `SMTP_*` for verification/recovery and email delivery; keep workflows disabled until tested. Geoapify search optionally uses `GEOAPIFY_API_KEY`. Compose reads `.env`: do not shell-source it. Single-quote passwords containing `$` to prevent Compose interpolation.

No demo seed runs. Migrations create the schema/settings; `admin` creates an admin and refuses an existing email. Keep `.env` private and save a secure copy separately. Editing database passwords does not rotate credentials in an existing MySQL volume.

## Connect host Nginx

On Ubuntu/Debian using `/etc/nginx/sites-available`, install the supplied site and replace its example domain:

```bash
sudo cp host-nginx.conf /etc/nginx/sites-available/tnl-track
sudo nano /etc/nginx/sites-available/tnl-track
sudo ln -s /etc/nginx/sites-available/tnl-track /etc/nginx/sites-enabled/tnl-track
sudo nginx -t
sudo systemctl reload nginx
```

If port 8080 is in use, change `WEB_PORT` in `.env` and the `proxy_pass` port in your host Nginx site. If this domain already has an Nginx site, merge the supplied `location /` and `client_max_body_size` into that site instead of creating a duplicate. Preserve its certificate configuration. Other distributions may use `/etc/nginx/conf.d/tnl-track.conf` instead.

For a domain without an existing certificate, on Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN --redirect
sudo certbot renew --dry-run
```

Follow prompts and confirm Certbot's renewal timer is enabled. Open `https://YOUR_DOMAIN` and sign in with your admin. HTTPS is required for phone GPS. See [Hostinger's certificate guide](https://www.hostinger.com/support/6865487-how-to-install-ssl-on-vps-using-certbot-at-hostinger/) and [reverse proxy guide](https://www.hostinger.com/tutorials/how-to-set-up-nginx-reverse-proxy/).

Host Nginx replaces forwarded IP/protocol headers; container Nginx preserves them. The API uses `TRUST_PROXY=1` for per-IP limits and has no published port. Local development defaults to no proxy trust. If adding a CDN, another proxy, or using Nginx Proxy Manager in Docker, adapt networking/header trust first: a proxy container cannot reach this web container using its own `127.0.0.1`.

## Updates and operations

```bash
bash manage.sh backup
git pull --ff-only
bash manage.sh deploy
bash manage.sh status
bash manage.sh logs api       # Ctrl+C exits logs
bash manage.sh logs worker
curl --fail https://YOUR_DOMAIN/health
bash manage.sh stop           # Preserves volumes
```

`deploy` builds first, waits for MySQL, stops application writers, runs compiled migrations with their SQL files, then starts services. Updates cause brief downtime. A migration failure leaves application services stopped. Use the script for first installs/upgrades; direct Compose startup bypasses migration ordering. Containers restart on reboot when Docker starts. Logs rotate at 10 MB x 3 per container. Check worker heartbeats/backlog in Automations; `/health` only checks API availability.

## Backup and restore

`backup` pauses API/worker writes and photo cleanup while dumping the database and archiving photos, then restarts only the API/worker services that were running. Completed directories contain `database.sql.gz` and `photos.tar.gz`; incomplete attempts remain in `.partial-*`. Backups contain customer data: copy to protected off-server storage, test restoration, and rotate according to your policy (the application deployment guide recommends 30 days).

Restore a **trusted backup created by this script**:

```bash
# Take a fresh backup: restore replaces the whole database/photo store.
bash manage.sh backup
bash manage.sh restore backups/20261006T120000Z --confirm-replace
# Reconcile restored outbox/history while web/API/worker remain stopped.
# When reconciliation is complete:
bash manage.sh deploy
```

Restore with the application version that produced the backup, then upgrade normally. On a replacement VPS, restore repository and `.env`, run `docker compose build api web` in this folder, then `restore` before opening access. Photo ownership is repaired and expired photos purged before access resumes. Failed restores leave services stopped; keep the backup and investigate before opening partial data.

An older outbox may replay emails already accepted after the backup. Reconcile automation records before starting the worker; never restore the outbox separately. Back up host Nginx config/certificates separately, or reissue certificates on a replacement server. Never use `docker compose down -v` unless intentionally deleting the database/photos.

See [application rollout](../docs/DEPLOYMENT.md) and [delivery acceptance](../docs/DELIVERY.md) for SMTP/workflow and phone/GPS checks. Run `bash check.sh` for the offline script failure-path check (fake Docker, temporary files).
