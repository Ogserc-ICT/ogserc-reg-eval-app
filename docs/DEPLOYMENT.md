# Deploying the OGSERC Registration & Evaluation System

This guide is for the person who sets up and looks after the server. It assumes you can use SSH and
a Linux command line; no knowledge of the app's code is needed.

The whole system runs on **one small VPS** with Docker:

```
 staff browser ──HTTPS──▶ Caddy ──▶ app (Next.js) ──▶ PostgreSQL 16
                       (certificates)        ▲               │
                                             │               ▼
                                         scheduler ──▶ encrypted backups ──▶ off-site storage
                                  (06:00 daily review, 02:30 backup)
```

| Container | What it does |
|---|---|
| `db` | PostgreSQL 16. Not reachable from outside the server. |
| `migrate` | Runs once on every start: applies database changes and seeds reference data. |
| `app` | The web app. |
| `caddy` | HTTPS with free, automatically renewed Let's Encrypt certificates. |
| `scheduler` | Runs the daily review at 06:00 and the nightly backup at 02:30 (Lagos time). |

Shared cPanel/DirectAdmin hosting will not run this reliably. Use a VPS.

---

## 1. The server

- **Size:** 2 vCPU, 4 GB RAM, 40 GB SSD is comfortable (2 GB RAM is the minimum). Any provider works
  (e.g. DigitalOcean, Hetzner, Linode/Akamai, AWS Lightsail, a Nigerian provider).
- **Operating system:** Ubuntu 24.04 LTS.
- **Data protection:** the database holds personal data (names, phone numbers, email addresses of
  operators' staff). Choose a provider and region the Commission is comfortable with under the
  Nigeria Data Protection Act 2023.

## 2. Choosing an address

The app does not need a government domain. Pick one:

| Option | Staff open | You need | Notes |
|---|---|---|---|
| **A. A domain you own** (recommended) | `https://portal.example.com.ng` | Any domain (`.com.ng` or `.com`, roughly ₦5,000–15,000 a year) and one DNS **A record** pointing at the VPS's IP address | Certificates are automatic. Easy to move to a new server later: change the DNS record. |
| **B. No domain** | `https://203-0-113-5.sslip.io` (your IP with dashes) | Nothing | Free names that resolve to the IP inside them; certificates are still automatic. Looks unusual, and changes if the IP changes. |
| **C. Private network only** | `https://ogserc.your-tailnet.ts.net` | A free [Tailscale](https://tailscale.com) account; Tailscale installed on the VPS and on each staff device | Nobody outside your Tailscale network can even reach the sign-in page. See section 5. |

For A and B, ports 80 and 443 must be open to the internet (Let's Encrypt checks port 80).

Whichever you choose, **decide before issuing real certificates**: the QR code on each certificate
links to this address.

## 3. Prepare the server (once)

As root on a fresh Ubuntu 24.04 server:

```sh
# A user for day-to-day work (sign in with an SSH key, not a password)
adduser ogserc
usermod -aG sudo ogserc
rsync --archive --chown=ogserc:ogserc ~/.ssh /home/ogserc

# Security updates install themselves
apt update && apt -y upgrade
apt -y install unattended-upgrades git
dpkg-reconfigure -plow unattended-upgrades

# Firewall: SSH, HTTP and HTTPS only (for option C, only SSH)
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw enable

# Docker (official packages)
curl -fsSL https://get.docker.com | sh
usermod -aG docker ogserc
```

Then disable SSH password sign-in (`PasswordAuthentication no` in `/etc/ssh/sshd_config`,
then `systemctl restart ssh`), and sign in again as `ogserc`.

> Docker publishes ports directly and is not limited by `ufw`. The compose file publishes only 80/443
> (Caddy) and the app on `127.0.0.1` (the server itself), so nothing else is exposed.

## 4. Install the app

```sh
git clone <repository URL> ~/ogserc     # or copy the project folder to the server
cd ~/ogserc/deploy
cp .env.example .env
chmod 600 .env
nano .env
```

Fill in `.env` (every setting is explained in the file):

| Setting | Value |
|---|---|
| `APP_DOMAIN` | the address from section 2, without `https://` |
| `ACME_EMAIL` | an email for certificate expiry notices (optional) |
| `POSTGRES_PASSWORD` | a new random value: `openssl rand -hex 32` (hex: it goes inside the database URL, where `/` or `+` would break it) |
| `AUTH_SECRET`, `CRON_SECRET` | each a new random value: `openssl rand -base64 48` |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | the first Admin account. A strong password is required (refused otherwise). |
| `BACKUP_PASSPHRASE` | a long random value (`openssl rand -base64 32`). **Save a copy outside the server** (e.g. a password manager). Without it no backup can be restored. |
| `RCLONE_REMOTE` | off-site backup destination, e.g. `offsite:ogserc-backups` (section 7) |

Start everything:

```sh
docker compose up -d --build
docker compose logs -f migrate app      # Ctrl+C to stop watching
```

The first build takes a few minutes. When `migrate` has finished and `app` shows `Ready`, open
`https://<APP_DOMAIN>` and sign in as the first Admin.

**Before staff use it:**

1. Change the Admin password (Account page). You may then remove `SEED_ADMIN_PASSWORD` from `.env`.
2. **Admin → Settings:** set the gazetted **Effective Date** (every deadline depends on it), the two
   **certificate signatory names** (certificates are blocked until set), and "Fees revised on".
3. **Admin → Fee table** and **Activity → category map:** check them against the Order.
4. **Admin → Users and roles:** create staff accounts with their roles.
5. Optional: **Admin → Import from the workbook** to bring in the Excel Register.
6. Check the next morning that the daily review ran (dashboard: "Daily review — last run …").

## 5. Option C: private network with Tailscale

1. Install Tailscale on the VPS and sign in: `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`.
   Turn on **MagicDNS** and **HTTPS certificates** in the Tailscale admin console.
2. In `deploy/.env`: leave `COMPOSE_PROFILES=` empty (no Caddy) and set
   `APP_URL=https://<machine-name>.<tailnet>.ts.net`.
3. Start the app (section 4), then publish it on the private network with HTTPS:
   `sudo tailscale serve --bg 3000`.
4. Close ports 80/443 in the firewall (`sudo ufw delete allow 80/tcp` and so on).
5. Staff install Tailscale on their laptops and join your tailnet. You can limit who reaches the
   server with Tailscale access controls.

## 6. Updating

```sh
cd ~/ogserc
docker compose -f deploy/docker-compose.yml exec scheduler backup.sh   # a backup first
git pull
cd deploy
docker compose up -d --build
docker compose logs -f migrate app
```

Database changes are applied automatically by `migrate` before the new app starts. If `migrate`
fails, the old data is untouched and the new app does not start; see section 10.

## 7. Backups

**What happens automatically, every night at 02:30:**

1. `pg_dump` of the whole database, encrypted with AES-256 using `BACKUP_PASSPHRASE`.
2. The file is decrypted and read back as a check; a backup that fails the check is not kept.
3. Kept in `deploy/backups/daily` (newest 14) and, on Sundays, `deploy/backups/weekly` (newest 8).
4. Copied off-site when `RCLONE_REMOTE` is set.

The `scheduler` container reports **unhealthy** if no backup has succeeded for 26 hours
(`docker compose ps`).

**Set up the off-site copy** (strongly recommended: a backup on the same server is lost with it):

1. Create a bucket with a provider such as Backblaze B2 (low cost) or any S3-compatible storage, and
   a key that can only write to that bucket. Turn on a lifecycle rule to delete files after ~90 days.
2. `cp offsite.env.example offsite.env && chmod 600 offsite.env`, fill in one block.
3. In `.env`, set `RCLONE_REMOTE=offsite:<bucket-name>`.
4. `docker compose up -d scheduler`, then test: `docker compose exec scheduler backup.sh`.

**Back up now** (e.g. before an update): `docker compose exec scheduler backup.sh`

**Restore drill (do this monthly, and once right after installing).** It restores into a separate
scratch database, leaving the live one alone:

```sh
cd ~/ogserc/deploy
ls backups/daily
docker compose exec scheduler restore.sh /backups/daily/<file>.dump.enc ogserc_restore_test
docker compose exec db psql -U ogserc -d ogserc_restore_test -c 'select count(*) from "Submission"'
docker compose exec db dropdb -U ogserc ogserc_restore_test
```

**Restore the live database** (replaces everything in it with the backup):

```sh
cd ~/ogserc/deploy
docker compose stop app
docker compose exec -e RESTORE_CONFIRM=yes scheduler restore.sh /backups/daily/<file>.dump.enc ogserc
docker compose start app
```

**Restore on a new server** (the old one is lost): install as in sections 3–4 with the **same
`BACKUP_PASSPHRASE`**, fetch the latest file from off-site storage into `deploy/backups/daily`
(`docker compose exec scheduler rclone copy offsite:<bucket>/daily/<file> /backups/daily/`), then
restore the live database as above.

## 8. The daily review

The scheduler calls the app at **06:00 Lagos time** every day (SPEC §4.10). The call stays inside
the server; Caddy refuses it from outside. To see results:

- Dashboard: "Daily review — last run …", with the summary.
- `docker compose logs scheduler`, or **Audit log** filtered to "Daily review".

Supervisors and Admins can also press **Run now** on the dashboard.

## 9. Monitoring

- `docker compose ps`: every container should be `running` / `healthy`.
- `docker compose logs --tail 100 app` (or `scheduler`, `caddy`, `db`).
- Add a free external uptime check (e.g. UptimeRobot) on `https://<APP_DOMAIN>/api/health`. It returns
  `{"ok":true}` when the app and database are up, and nothing else.
- Disk space: `df -h` (backups and the database grow slowly; check monthly).

## 10. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Browser shows a certificate error / Caddy logs "challenge failed" | DNS record not pointing at the server yet, or ports 80/443 closed. Check `dig +short <APP_DOMAIN>` and the firewall; Caddy retries by itself. |
| `app` keeps restarting, log says "Refusing to start: APP_URL …" | `APP_DOMAIN` (or `APP_URL`) is missing or not a full address. Fix `.env`, then `docker compose up -d`. |
| `app` log says "APP_TODAY is set in production" | Remove `APP_TODAY` from the environment: the test clock is for development only. |
| `migrate` failed | `docker compose logs migrate`. "Refusing to create the production admin" means `SEED_ADMIN_PASSWORD` is too weak or a default. |
| Daily review log shows `401` | `CRON_SECRET` differs between containers: `docker compose up -d` after editing `.env`. |
| Staff signed out everyone at once | `AUTH_SECRET` was changed. That is expected; they sign in again. |
| Login says too many attempts | 15-minute lockout after 5 failures; an Admin can unlock the account (Users). |

## Settings reference

All settings live in `deploy/.env` (template: `deploy/.env.example`). Never put real secrets in the
repository.

| Setting | Required | Purpose |
|---|---|---|
| `APP_DOMAIN` | yes (A/B) | Address staff use; Caddy gets its certificate. |
| `APP_URL` | option C | Full URL when not using Caddy. Certificate QR codes link here. |
| `ACME_EMAIL` | no | Let's Encrypt notices. |
| `COMPOSE_PROFILES` | — | `public` runs Caddy; empty for option C. |
| `APP_BIND` | — | Where the app listens on the server (default `127.0.0.1:3000`). |
| `POSTGRES_PASSWORD` | yes | Database password (used only inside the server). |
| `AUTH_SECRET` | yes | Signs sign-in sessions. Changing it signs everyone out. |
| `CRON_SECRET` | yes | Lets the scheduler run the daily review. 32+ characters. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | first start | The first Admin. Ignored once the account exists. |
| `BACKUP_PASSPHRASE` | yes | Encrypts backups. 20+ characters. Keep a copy off the server. |
| `BACKUP_DIR` | — | Backup folder (default `deploy/backups`). |
| `BACKUP_KEEP_DAILY` / `BACKUP_KEEP_WEEKLY` | — | Retention (default 14 / 8). |
| `RCLONE_REMOTE` | recommended | Off-site destination; credentials in `deploy/offsite.env`. |

`APP_TODAY` (the development test clock) must **never** be set in production; the app refuses to start
if it is.
