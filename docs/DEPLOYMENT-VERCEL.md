# Going live on Vercel (no server to look after)

This guide puts the OGSERC Registration & Evaluation System online with a link the team can use.
Everything is done in web consoles; you do not run or update a server. Allow about two hours.

```
 staff browser ──HTTPS──▶ Vercel (the app) ──▶ Neon (PostgreSQL database, London)
                              ▲
              06:00 daily ────┘ Vercel Cron

 GitHub Actions, 02:30 nightly ──▶ encrypted backup ──▶ Backblaze B2 (off-site storage)
```

| Service | What it does | Cost (check current prices) |
|---|---|---|
| **GitHub** | Holds the code (private repository); runs the nightly backup | Free |
| **Vercel** | Runs the app, HTTPS, the 06:00 daily review | **Pro, about $20/month**. The free Hobby plan is for personal, non-commercial use only, so it does not cover a Commission system. Only the person who manages the deployment needs a Vercel seat; staff using the app do not. |
| **Neon** | The PostgreSQL database | Free to start (0.5 GB). Each certificate PDF is stored in the database at about 1.3 MB, so plan to move to a paid plan after a few hundred certificates. |
| **Backblaze B2** | Off-site copies of the encrypted backups | A few cents a month |

**Starting with a free trial.** You can follow this whole guide on Vercel's free **Hobby** plan
and upgrade later (Vercel → Settings → Billing); upgrading changes nothing else: no redeploy, no
database move, same link. On Hobby:

- the daily review runs once a day **some time between 06:00 and 06:59** Lagos time (Pro: on time);
- only you can be a member of the Vercel project (staff using the app do not need Vercel accounts);
- long operations (workbook import, exports) rely on **Fluid compute** being on (Settings →
  Functions; it is on by default for new projects);
- Vercel's terms limit Hobby to personal, non-commercial use: move to Pro before the Commission
  relies on the system day to day.

If the trial uses real operator data, set up the nightly backup (step 6) before entering it.

The guide on running your own server instead is [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Step 1: Put the code on GitHub (15 minutes)

1. Create a GitHub account (or use the Commission's) and a **new private repository**, e.g.
   `ogserc-registration`. Do not add a README or licence; the repository must be empty.
2. On the computer that has the project, in the project folder:

   ```sh
   git remote add origin https://github.com/<account>/ogserc-registration.git
   git push -u origin main
   ```

   (If the project is not yet a Git repository, ask for it to be set up: `git init`, a first commit
   and a `main` branch.)

## Step 2: Create a strong set of secrets (5 minutes)

You need four random values. Generate each one (Git Bash, macOS or Linux terminal):

```sh
openssl rand -base64 48     # AUTH_SECRET
openssl rand -base64 48     # CRON_SECRET
openssl rand -base64 32     # BACKUP_PASSPHRASE
```

…and choose the **first admin's email and a strong password**. The build refuses a weak one: at
least 14 characters mixing three of lower case, upper case, digits and symbols (or 20+ characters),
and not containing the email name or words like "admin", "password" or "ogserc".

Store all of these in a password manager. **Without `BACKUP_PASSPHRASE` no backup can ever be
restored**, so it must also be kept somewhere other than GitHub and Vercel.

## Step 3: Create the Vercel project and the database (20 minutes)

1. Sign up at [vercel.com](https://vercel.com) **with your GitHub account**. Choose **Hobby** for a
   free trial or **Pro** for the Commission's day-to-day use (see "Starting with a free trial").
2. **Add New → Project**, pick the `ogserc-registration` repository, click **Import**.
   Vercel recognises Next.js. Leave the build settings as they are: the project's
   `vercel-build` script is used automatically. **Do not click Deploy yet.**
3. Create the database: in the new project, **Storage → Create Database → Neon**.
   - Region: **AWS London (eu-west-2)**, next to the app (Vercel region `lhr1`, set in `vercel.json`).
   - When asked which environments to connect, choose **Production only**.
   - This adds `DATABASE_URL` (pooled, for the app) and `DATABASE_URL_UNPOOLED` (direct, used for
     database updates and backups) to the project automatically.
4. **Settings → Environment Variables**, add for **Production**:

   | Name | Value |
   |---|---|
   | `AUTH_SECRET` | from step 2 |
   | `CRON_SECRET` | from step 2 (Vercel uses it to call the daily review) |
   | `APP_URL` | `https://<project-name>.vercel.app` for now (step 5 if you add your own domain) |
   | `SEED_ADMIN_EMAIL` | the first admin's email |
   | `SEED_ADMIN_PASSWORD` | the first admin's password |

5. **Deployments → Redeploy** (or **Deploy**). In the build log you should see:
   `All migrations have been successfully applied`, `Reference data seeded.` and
   `Admin … created.` The build takes 2–4 minutes.

Open `https://<project-name>.vercel.app`: the sign-in page. That is the link for the team.

## Step 4: Set the app up before the team uses it (30 minutes)

1. Sign in as the first admin and **change the password** (Account). Then delete the
   `SEED_ADMIN_PASSWORD` variable in Vercel (the account already exists; it is never needed again).
2. **Admin → Settings:** the gazetted **Effective Date** (every deadline depends on it), the two
   **certificate signatory names** (certificates are blocked until set), and "Fees revised on".
3. **Admin → Fee table** and **Activity → category map:** check them against the Order.
4. **Admin → Users and roles:** create an account for each staff member with their roles.
5. Optional: **Admin → Import from the workbook** (the .xlsm must be under 4.5 MB on Vercel;
   yours is about 3 MB).

## Step 5 (optional, but decide before issuing certificates): your own address

The QR code on every certificate links to `APP_URL`. A `*.vercel.app` address works and is stable
as long as the project keeps its name. To use your own domain (e.g. `portal.example.com.ng`):

1. Vercel → **Settings → Domains → Add**, then create the DNS record Vercel shows at your domain
   registrar. HTTPS is automatic.
2. Change `APP_URL` to `https://portal.example.com.ng` and redeploy.

Do this **before the first real certificate is issued**; certificates already printed keep the
old link.

## Step 6: Nightly backups (30 minutes; do this before real data goes in)

Neon keeps its own short history, but you also want **your own encrypted copies, off-site**.

1. **Backblaze B2:** create an account, a **private bucket** (e.g. `ogserc-backups`), and an
   **application key** limited to that bucket (read and write). Note the *keyID* and
   *applicationKey*. Optional: a lifecycle rule to delete files older than 90 days.
2. **The direct database address:** Vercel → Storage → your Neon database → copy the value of
   `DATABASE_URL_UNPOOLED` (it starts `postgresql://` and contains `sslmode=require`).
3. **GitHub → your repository → Settings → Secrets and variables → Actions → New repository
   secret**, add each of these:

   | Secret | Value |
   |---|---|
   | `BACKUP_DATABASE_URL` | the direct address from 2 |
   | `BACKUP_PASSPHRASE` | from step 2 |
   | `RCLONE_REMOTE` | `offsite:ogserc-backups` (your bucket name after `offsite:`) |
   | `RCLONE_CONFIG_OFFSITE_TYPE` | `b2` |
   | `RCLONE_CONFIG_OFFSITE_ACCOUNT` | the B2 *keyID* |
   | `RCLONE_CONFIG_OFFSITE_KEY` | the B2 *applicationKey* |

   (Any S3-compatible storage works instead of B2: type `s3` plus `..._PROVIDER`,
   `..._ACCESS_KEY_ID`, `..._SECRET_ACCESS_KEY`, `..._REGION`, `..._ENDPOINT`. For Google Drive
   see below.)
4. **Test it:** GitHub → **Actions → Nightly database backup → Run workflow**. It should finish
   green in 2–3 minutes, and a file `ogserc-….dump.enc` appears in the bucket's `daily/` folder.
5. **Restore drill:** **Actions → Restore drill → Run workflow**. It restores the newest backup into
   a scratch database, prints record counts next to the live ones, and deletes the scratch copy.
   Run it once now and then **monthly**.

From then on the backup runs every night at about 02:30 Lagos time. If a run fails, GitHub emails
the repository owner.

### Google Drive instead of B2

Use a Google account the Commission controls, not a staff member's personal one. The backups are
encrypted, so Google cannot read them.

1. **Get a Drive token** on any Windows, macOS or Linux computer with a browser. Install rclone
   (Windows: `winget install Rclone.Rclone` or `scoop install rclone`), then run:

   ```sh
   rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"
   ```

   (The quoted value is `{"scope":"drive.file"}` in unpadded base64; rclone 1.75 rejects a trailing
   `==`. With it, rclone can see only the files it creates, not the rest of the Drive.) A browser
   opens; sign in with the backup account and allow access. The
   terminal then prints a token between `--->` and `<---End paste`. Copy the whole line that starts
   `{"access_token":` and ends `}`: the access token alone (`ya29.…`) is not enough, the line must
   include `"refresh_token"`. On Windows, add
   `| Select-String '^\{"access_token"' | ForEach-Object { $_.Line } | Set-Clipboard` to the command
   to put the line straight on the clipboard.
2. **GitHub secrets** (same place as step 6.3). Keep `BACKUP_DATABASE_URL` and `BACKUP_PASSPHRASE`;
   in place of the B2 ones add:

   | Secret | Value |
   |---|---|
   | `RCLONE_REMOTE` | `offsite:ogserc-backups` (a Drive folder; created on the first run) |
   | `RCLONE_CONFIG_OFFSITE_TYPE` | `drive` |
   | `RCLONE_CONFIG_OFFSITE_SCOPE` | `drive.file` |
   | `RCLONE_CONFIG_OFFSITE_TOKEN` | the `{"access_token": …}` line from 1 |

3. **Retention.** Drive has no lifecycle rules, so the workflow prunes old copies itself. Under
   **Secrets and variables → Actions → Variables** add `BACKUP_OFFSITE_KEEP_DAILY_DAYS` = `30` and
   `BACKUP_OFFSITE_KEEP_WEEKLY_DAYS` = `365`. Removed files go to the Drive bin, which empties itself
   after 30 days. Without these variables every copy is kept until the Drive is full.
4. Test and run the restore drill as in 6.4 and 6.5. The files appear in Drive under
   `ogserc-backups/daily/` (and `weekly/` on Sundays).

The token keeps working while the account exists and its access is not removed (Google Account →
Security → Third-party connections → rclone). If it stops working, the nightly run fails (GitHub
emails you); repeat 1 and replace the token secret.

## Step 7: Check the daily review

Vercel → **Settings → Cron Jobs** lists `/api/cron/daily-review` at `0 5 * * *` (05:00 UTC = 06:00
Lagos). The next morning the dashboard shows "Daily review — last run …". Supervisors and Admins can
also press **Run now** on the dashboard at any time.

---

## Updating the app

Changes pushed to the `main` branch deploy automatically, and database updates are applied during
the build. Before a big update, run **Actions → Nightly database backup → Run workflow** first.

Preview deployments (other branches) never touch the live database.

## Restoring the live database (if data is lost or damaged)

Two ways, quickest first:

1. **Neon's own history** (recent mistakes, within Neon's history window): Neon console → your
   project → **Restore**, choose a time just before the problem.
2. **From your own backups** (anything older, or if Neon is unavailable): ask whoever looks after the
   system to run `deploy/scheduler/restore.sh <backup file> <database name>` from a computer with
   the PostgreSQL client tools, with `DATABASE_URL` set to the direct address and
   `BACKUP_PASSPHRASE` set. The restore drill (step 6) runs exactly this script, so a green drill
   means it works.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build log: "DATABASE_URL is not set for Production" | Step 3.3: connect the Neon database to the Production environment. |
| Build log: "Refusing to create the production admin" | `SEED_ADMIN_PASSWORD` is too weak or contains "admin"/the email name. Choose another and redeploy. |
| The site shows an error and the log says "APP_URL is not set" | Add `APP_URL` (step 3.4) and redeploy. |
| Errors mentioning "prepared statement" | Add `&pgbouncer=true` to the end of `DATABASE_URL` in Vercel and redeploy. |
| Workbook upload fails with "Request Entity Too Large" | Vercel accepts up to 4.5 MB per upload; remove unused sheets or images from the workbook. |
| Backup workflow fails at "Check the settings" | A repository secret from step 6.3 is missing or misspelt. |
| Daily review not running | Vercel → Settings → Cron Jobs: it must be listed and enabled, and `CRON_SECRET` set for Production. |

## Settings reference (Vercel, Production)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes (set by Neon) | Pooled connection used by the app. |
| `DATABASE_URL_UNPOOLED` | yes (set by Neon) | Direct connection for database updates during builds. |
| `AUTH_SECRET` | yes | Signs sign-in sessions. Changing it signs everyone out. |
| `CRON_SECRET` | yes | Authorises the 06:00 daily review. 32+ characters. |
| `APP_URL` | yes | The address staff use; certificate QR codes link here. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | first deploy only | The first Admin account. |

`APP_TODAY` (the development test clock) must **never** be set; the app refuses to run if it is.
