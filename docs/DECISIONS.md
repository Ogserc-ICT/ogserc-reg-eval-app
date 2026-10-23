# Decisions

Decisions made during the build that refine `docs/SPEC.md`. Newest first. If this file and the spec disagree, this file wins; raise anything unclear.

## 2026-10-24 — Finance confirmation gate (Commission's updated workbook; SPEC §4.12)

The rules are in SPEC §4.12. Choices made here, where the instruction left room:

- **Who confirms:** the Finance role only (permission `payment.confirm`). Admin can confirm only if it also holds the Finance role. The officer who recorded a payment cannot confirm it; the database refuses it too. That officer *may* reject it, because only confirmation was restricted.
- **The old "Mark verified" action is gone.** Confirming on the Finance Desk requires the "verified against bank/Remita" tick and records the verification (who and when), so the two would have meant the same thing. The permission `payment.verify` is replaced by `payment.confirm`.
- **Decisions are final.** Pending changes to Confirmed or Rejected once (DB trigger).
  - A confirmed payment is undone only by reversal (Finance or Admin, with a reason). A released submission stays released, but the gate closes again, so evaluation actions are blocked until payments are confirmed again.
  - A rejected payment cannot be reversed, because it never counted.
- **What the gate blocks:**
  - The evaluation page shows the reason instead of the checks, for open submissions only. Closed records stay viewable, read-only.
  - Blocked actions: saving checks, recording the review, mark complete, the deficiency notice (issue and draft), approval, the evaluation form, and certificate issue or reissue.
  - Not blocked: refusal, show-cause, cancel and officer assignment.
  - Each blocked attempt writes `Blocked - awaiting Finance confirmation` with the action and the amounts, including each blocked visit to the evaluation page.
- **What can trigger a release** (same transaction, audited `Released for evaluation`):
  - a confirmation;
  - a waiver;
  - a change to the late-charge setting (the change itself is audited as a setting);
  - the daily review, for any missed;
  - any gated action attempted after the gate has cleared.
- **Evaluation start:** an officer chosen at intake no longer starts the evaluation date. The date is set on release, or on assignment after release.
- **Flags:** "Status moved past acknowledgement without Finance confirmation" covers Received, Deficiency, Provisionally Registered, Registered and Lapsed with no release date. It does not cover Refused or Cancelled, which can legitimately happen before release.
- **Reopen decision:** a Refused or Cancelled record that was never released returns to "Acknowledged - Awaiting Payment".
- **Days:** the dashboard counts "days since acknowledgement" from the date submitted (the date on the acknowledgement letter). The Finance Desk counts "days waiting" from when the payment was recorded.
- **Unpaid acknowledgement reminder:** when set, it marks queue items "reminder due" and adds a count to the daily review summary. It sends nothing, because there is no messaging in the system.
- **Dashboard:**
  - "Collected" counts Finance-confirmed payments only.
  - The "Collected and bank-verified" tile became **"With Finance"**: money recorded but awaiting confirmation.
  - New "Awaiting payment" count, and an "Awaiting payment, oldest first" queue.
  - Awaiting submissions are left out of the evaluation tallies, the evaluator queues and the Evaluations list.
- **Register:** the process stage is shown under each status, and the export gains "Process Stage" and "Released for Evaluation" columns.
- **Workbook import:**
  - Imported payments are Pending.
  - Imported records that are not closed come in as "Acknowledged - Awaiting Payment" (with a preview warning) and keep their dates.
  - Imported Registered or Lapsed records keep their status and show the "without Finance confirmation" flag (also warned in the preview).
- **Existing records** (migration `20261024090200_finance_gate_existing_records`, after `…090000` and `…090100` for the schema):
  - Every submission not closed and with no Confirmed payment returns to "Acknowledged - Awaiting Payment", **including Deficiency Notice Issued and Provisionally Registered**, as instructed. Their dates are kept, so their evaluation-start flag will show.
  - Each gets one audit entry, plus one summary entry. Payments recorded before the gate are Pending (column default).
  - `npm run finance-gate:dry-run` shows the effect first and changes nothing. Dry runs on 24 Oct 2026: **dev database: 2 submissions, both closed, 0 would move, 2 payments become Pending; live database: 0 submissions, 0 would move.**
- **Not yet applied** to the dev or live database, pending the owner's go-ahead after the dry run. On Vercel, the next production deploy applies all three migrations automatically.

## 2026-10-23 — Hosting: Vercel + Neon (chosen over the VPS)

The owner does not want to look after a server. **Production runs on Vercel, with the database on Neon.** The Docker/VPS setup below stays in the repository as the alternative. Guide: docs/DEPLOYMENT-VERCEL.md.

- **App:** Vercel (Pro plan; Hobby is for personal, non-commercial use only), region `lhr1` (London) in `vercel.json`. On Vercel the build skips `output: "standalone"`. `outputFileTracingIncludes` puts the PDF fonts and images into every server function.
- **Database:** Neon Postgres, AWS London, connected to the Production environment only.
  - The app uses the pooled `DATABASE_URL`.
  - Database migrations use `DATABASE_URL_UNPOOLED`, because schema changes need a direct connection.
- **Builds** (`npm run vercel-build` → `scripts/vercel-build.ts`): `prisma generate`; then, **on production deployments only**, `prisma migrate deploy` and the create-only seed; then `next build`. Preview deployments never touch the live database. Tested against a throwaway database:
  - a preview build left it empty;
  - a production build applied all migrations through the direct connection (the pooled URL was deliberately wrong) and created the admin;
  - a second production build left both the admin and an admin-edited fee unchanged.
- **Daily review:** Vercel Cron, `0 5 * * *` (06:00 Lagos). Vercel sends `GET` with `Authorization: Bearer $CRON_SECRET`, so the route now accepts GET as well as POST (the Docker scheduler) with the same check.
- **Time limits:** functions have time limits on Vercel, so these declare `maxDuration`: 300 s for the workbook upload and import pages, 120 s for the Register and audit exports and the daily review.
- **Uploads** are capped at 4.5 MB by Vercel. The workbook is about 3 MB.
- **Backups:** GitHub Actions, using the same `backup.sh` as the Docker scheduler.
  - It runs nightly at 02:30 Lagos time (`.github/workflows/backup.yml`): `pg_dump` with client tools matching the server's major version (installed from the PostgreSQL apt repository), AES-256 encryption, a decrypt-and-read check, then a copy to Backblaze B2 or other S3-compatible storage. The workflow refuses to run without off-site storage configured.
  - A manual **Restore drill** workflow restores the newest off-site backup into a scratch database, compares record counts with live, and drops the scratch copy. Its steps were run here against the dev database with real PostgreSQL 16 tools, and the counts matched.
  - Neon's own point-in-time restore is the quick first resort for recent mistakes.
- **Backup and restore scripts** now remove only Prisma's `schema=` parameter from the database URL and keep the others, such as Neon's `sslmode=require`.
- **Not testable here:** the actual Vercel deployment, Vercel Cron firing, the Neon connection, and the GitHub Actions runs (rclone upload and download, installing the client tools). The guide's step 6 runs both workflows once by hand to prove them before real data goes in.
- **Storage:** each certificate PDF is about 1.3 MB in the database (mostly the security background image), so Neon's free 0.5 GB lasts a few hundred certificates. A smaller (JPEG) background would cut this, if wanted.

## 2026-10-23 — Phase 8 (deployment; fee table and activity pages)

**Fee table and activity map pages** (deferred since Phase 2)
- Admin only (`admin.referenceData`). One form per table; **saving needs a reason**, and each changed row gets its own audit entry: "Fee table changed" / "Activity map changed", with old → new values and the reason.
- Categories, activity names and codes are fixed: codes are part of registration numbers, and names are matched by the workbook import. Category I is own-use only, and no activity can map to it. An activity whose categories differ by capacity must be marked "Depends on capacity".
- Saved submissions and own-use notifications keep their pricing snapshot. After a change, the save message says how many now show "pricing out of date"; an admin recalculates them, with a reason, if the new terms should apply. Because "pricing out of date" is a data flag, an affected open submission needs recalculation or an approver's override before approval.
- "Fees revised on" in Settings is not changed automatically, because it is the Commission's revision date, not the edit date.

**Hosting** (no government domain needed; see docs/DEPLOYMENT.md "Choosing an address")
- One VPS with Docker Compose (`deploy/docker-compose.yml`): `db` (Postgres 16, internal network only), `migrate` (migrations and the create-only seed on every start), `app` (Next.js standalone server, bound to 127.0.0.1), `caddy` (automatic Let's Encrypt HTTPS for `APP_DOMAIN`) and `scheduler`.
- Three ways to give staff an address:
  - **A.** Any domain the Commission or operator owns (recommended).
  - **B.** A free IP-based `sslip.io` name.
  - **C.** A private Tailscale network (no Caddy; `tailscale serve` provides HTTPS).
- Caddy refuses `/api/cron/*` from outside, sets security headers (HSTS, nosniff, frame DENY, referrer policy) and replaces `X-Forwarded-For` with the client address, which the login throttle reads.
- `/api/health` reports only whether the app and database are up, for Docker and uptime monitors.

**Scheduler** (one small container: `postgres:16-alpine` with cron, curl, openssl and rclone)
- Daily review at 06:00 Africa/Lagos: calls the app inside the stack with `CRON_SECRET`, retrying through a restart. A failed call fails the job and appears in the container log.
- Backup at 02:30:
  - `pg_dump` (custom format), encrypted with AES-256-CBC (PBKDF2, 200,000 iterations) using `BACKUP_PASSPHRASE`.
  - The backup is decrypted and listed as a check before it is kept.
  - It keeps 14 daily and 8 weekly copies, and copies each backup off-site with rclone when `RCLONE_REMOTE` is set (B2 or any S3-compatible store).
  - The container reports unhealthy after 26 hours without a good backup.
- `restore.sh <file> <database name>`: a scratch name is created and restored into (the monthly restore drill). The live database needs the app stopped and `RESTORE_CONFIRM=yes`.

**Verified here, without Docker** (Docker is not installed on the development machine)
- `npm run smoke:standalone`: the production bundle builds with no database reachable, as in the Docker build. Laid out as the image is, it refuses to start without `APP_URL`, then serves health, sign-in, the dashboard, static files and the logo, renders a PDF (fonts and assets found), and runs the cron route (and refuses a wrong secret).
- Backup and restore with real PostgreSQL 16 tools against a copy of the dev data: counts match; the protective triggers come back and still refuse deletes; restoring a second time over existing data works.
- **Not yet run:** `docker build` and `docker compose up` themselves, Caddy obtaining a certificate, rclone upload, and busybox cron firing on schedule. Do these on the VPS (docs/DEPLOYMENT.md section 4 onwards, including the restore drill) before go-live.

## 2026-10-23 — Phase 7 (daily review, audit log, export, import, QR)

**Daily review (§4.10)**
- Runs from `POST /api/cron/daily-review` with `Authorization: Bearer $CRON_SECRET`. The server's cron calls it at 06:00 Lagos time (05:00 UTC; Lagos has no daylight saving). The crontab line is set up in Phase 8. Without a `CRON_SECRET` of at least 32 characters, the route refuses every request.
- **Run now** is on the dashboard for Reviewing Supervisors and Admin. The dashboard also shows when the review last ran, who ran it (or "scheduled") and its summary.
- It runs as one transaction, and only one review can run at a time. Running it twice on the same day changes nothing new. Audit entries:
  - one per provisional registration and one per number locked, under the person who clicked, or with no user for the scheduled run;
  - one summary entry per run.
- A Registered record without a number gets one in the year of its certificate date. In the app this only happens with imported data.
- Overdue deficiency responses are listed, never lapsed automatically.

**Audit log viewer**
- Admin only (permission `audit.read`). Each record's own history stays on its page for all staff.
- Filters: date range (Lagos days), user (or "System"), action, and a search over the reference and detail. 100 entries per page, newest first. References link to their submission, own-use notification or user.
- CSV export of the filtered entries, up to 50,000. **Every export is itself audited.**

**Register export**
- Excel (.xlsx) and CSV of the Register as filtered on screen.
- Columns follow the workbook's Register sheet, with every input and calculated field, next action and flags. Money is in naira; dates are real Excel dates (ISO dates in the CSV).
- Any signed-in staff member may export what they can already see. **Every export is audited** with its format, row count and filters.
- CSV cells that start with `= + - @` are prefixed with an apostrophe, so a spreadsheet cannot run them as formulas. The Excel file stores them as plain text.

**Workbook import**
- Admin only. Upload, then preview, then import.
  - The uploaded file is stored with its SHA-256 (`WorkbookImport`). It is never deleted and is frozen once imported (DB trigger).
  - The import is made from those exact bytes, and the plan is worked out again inside the import transaction. All or nothing.
- **Numbers are kept** (Ack, Payment, OUN and Registration). Issued registration numbers are locked. A Registered row without an issued number takes the number the workbook generated.
  - The app's counters are raised past the highest imported serial (the registration counter per year), so new numbers never collide.
- **Pricing uses the app's rules**: the current fee table and Settings become each record's snapshot. The preview lists every row where the workbook's fee, late charge, total due or category differs.
- **Errors block the whole import**, and the preview lists each one with its sheet, row and reference. Errors are:
  - missing required fields, or values not on the app's lists (LGA, activity, licence status, channel, registrant type);
  - future dates;
  - a status without its dates (Registered without a certificate date or number, Deficiency without a notice date);
  - malformed or duplicated numbers, or numbers the app already uses for a different record;
  - a waiver above the fee;
  - own-use of 1,000 kW or more;
  - a payment whose reference is not imported.
- **Warnings do not block.** They are:
  - CAC, TIN, phone and email format problems (imported as they are; the record must be corrected when next edited);
  - officer names that match no user with that role (left unassigned);
  - a category override with no reason (recorded as "carried over from the workbook");
  - own-use below the threshold;
  - a check or document value that is not Y, N or N/A (left pending).
- **Skipped**:
  - example rows (§8.8) and their payments;
  - rows already in the app with the same number and name, so a corrected workbook can be imported again;
  - payments whose own row has errors.
- What comes across:
  - the Document Checklist and Evaluation rows, matched by row number and checked against the Ack No.;
  - only check answers staff typed; anything the workbook calculated is ignored, because the app works those out;
  - final decision and dates;
  - a deficiency notice record when there is a notice date;
  - payments, including "verified with bank".
  - The workbook's Audit Log sheet becomes entries named "Workbook: …", with the original time and Excel user name in the detail.
  - Imported records are created by, and audited under, the Admin who imported them. That Admin therefore cannot approve open imported submissions (separation of duties).
- No certificate PDFs are imported. An Admin can issue one from the record (the Phase 5 "issue/reissue" action).

**Certificate QR code**
- A QR code bottom right links to `APP_URL/verify/{submission id}`, an internal page that requires staff sign-in. The page shows:
  - whether the registration is current, provisional, not valid (Cancelled, Refused or Lapsed) or not registered;
  - the registration number, name, CAC number, category, activity, area, certificate date and status;
  - every certificate version issued, marking any that were replaced.
- `APP_URL` must be set in production; the server refuses to start without it. In development it defaults to `http://localhost:3000`.

**Dependencies:** `exceljs` (read the workbook, write .xlsx), with its `uuid` pinned to 11.1.1 (fixes a moderate advisory); `qrcode`; `jsqr` (tests only). Server actions accept up to 26 MB, for the workbook upload.

**Still open from earlier:** the fee table and activity admin pages (deferred "until after Phase 4") are not built yet. *(Built in Phase 8, above.)*

## 2026-10-23 — before Phase 7 (dashboard money, charts, volume)

- **Refused, Lapsed and Cancelled submissions are left out of total due, outstanding and the collection rate.** What they still owe is shown on its own as "Unpaid on closed submissions", linking to the Register filtered to them (`?closedUnpaid=1`). Registered and in-progress submissions and own-use notifications stay in. *(Replaces the Phase 6 rule below.)*
- **Collected still counts every active payment**, including payments on closed submissions. Reversed payments stay out.
- **Collection rate = (total due − outstanding) ÷ total due**, i.e. the share of what is due that has been paid. Overpayments cannot push it past 100%, and money on closed submissions does not inflate it. (Collected ÷ total due no longer works, because collected includes closed submissions.)
- **"Overpaid / credits"** is a separate figure: the sum of negative balances across every submission (any status) and own-use notification. It links to `/submissions?overpaid=1`, and to `/own-use?overpaid=1` when own-use credits exist. Credits never reduce outstanding.
- **Monthly charts:**
  - Until 12 months have passed since the Effective Date month, the charts show the 12 months starting from that month.
  - After that, they show the last 12 months, ending with the current month.
  - A year selector shows any calendar year from the Effective Date year to this year, January to December.
- **Fake data (dev only):** `npm run seed:fake -- --confirm [--count 2000]` adds realistic submissions:
  - a spread of statuses, payments, reversals, overpayments, deficiency notices, registration numbers, evaluation answers and own-use notifications;
  - every record is marked "FAKE DATA", and the output is deterministic per `--seed`.
  - It refuses to run with `NODE_ENV=production`, and refuses a database that already has submissions unless given `--allow-existing`.
- **Volume:** `npm run perf:dashboard -- --count 2000 [--http]` times the dashboard on a throwaway database. With 2,000 submissions, 200 own-use notifications, 2,156 payments and about 73,000 evaluation answers, on this dev laptop:
  - Dashboard data: about 0.8 s (median).
  - Dashboard page over HTTP, production build: about 0.84 s (median); the first, cold request takes about 1.8 s.
  - Register page 1: about 0.64 s. Evaluations page: about 1.3 s.

  To get there, duplicate checks became index lookups instead of scanning every other submission. List pages also now load flat rows, with documents and answers grouped in SQL; the single-submission loader keeps the full record. A test checks the two loaders give identical results.

## 2026-10-23 — Phase 6 (dashboard)

- **Money totals cover every submission** (whatever its status) plus own-use notifications. Total due is snapshot fees and late charges after waivers. Collected counts active payments only; reversed ones are excluded. Outstanding sums positive balances, so overpayments do not offset other debts. Collection rate is collected ÷ total due. *(Replaced above: closed submissions are now excluded.)*
- **"In progress"** is Received - Under Review plus Deficiency Notice Issued. **"Closed"** is Refused, Lapsed and Cancelled (Registered is counted on its own).
- **Monthly intake** covers the 12 months from the *current* Effective Date's month. *(Replaced above by the window rules and year selector.)* Registrations are counted by certificate date; collections by date received.
- **Work queues** are worked out per signed-in user. "My assigned evaluations" lists open, undecided submissions where they are evaluator, supervisor or approver. "Overdue deficiency responses" is sorted by days overdue, "Ready for decision" by determination date.
- **Charts** follow the dataviz method: OGSERC green for single series, green + violet `#6250d6` for two (validated). Brand gold was rejected: green/gold fails the colour-blind check (ΔE 5.5). Every chart has hover and keyboard tooltips and a table view; stat tiles link to the filtered list behind each number. Light theme only, like the rest of the app.

## 2026-10-23 — Phase 5 (documents)

- **PDFs are generated on the server with pdf-lib.** No Word or LibreOffice. Fonts are DejaVu Sans/Serif (free licence, `assets/fonts/`). They stand in for the template's Georgia/Aptos and include the ₦ sign.
- **Stored in the database** (`GeneratedDocument`), each with its SHA-256, size, version, who generated it and why. Rows are never deleted or changed; a newer version only marks the old one superseded. Downloads re-check the hash before serving.
- **When each document is made:**
  - Acknowledgement letter: automatically when a submission is saved, and on demand by registry staff.
  - EVAL-01 form: on demand by any staff member.
  - Deficiency notice: only by the Issue action (SPEC §8.10). Before that, evaluators and supervisors can preview a watermarked "DRAFT – NOT ISSUED" version, which is never stored.
  - Certificate: inside the approval transaction, so if it cannot be produced, nothing is approved.
- **Certificate reissue:** Admin only, with a reason. The reissue keeps the original "Issued at Abeokuta this … day" date (the registration date) and adds a small "Reissued {date}" line under the serial number. It supersedes the previous version and clears "certificate needs reissue". The same action issues a first certificate for a Registered record that has none.
- **Certificate layout** follows `assets/CERT-01_template.docx`: order, sizes, colours, microtext lines and the seal placeholder. A light translucent panel sits behind the text for legibility over the security background. Long names and addresses shrink to a minimum size, then wrap.
- **Not yet:** the QR code on the certificate (optional, Phase 7).

## 2026-10-23 — after Phase 4 review

- **Closed submissions (Registered, Refused, Lapsed, Cancelled) can be changed only by Admin, with a reason.** This covers details, documents and the waiver. The audit entry records old and new values and the reason. *(Replaces "closed submissions stay editable" below.)*
- **Certificate fields on Registered records:** registered name, CAC no., address, activities, principal LGA and other areas, licence status and number. When Admin changes one, the submission is marked "certificate needs reissue" (Phase 5 reissues and clears it).
- **Status, final decision and workflow dates are never directly editable.** DB triggers refuse changes to status, completion / deficiency / show-cause / certificate dates, registration number, final decision, decision date, reasons and override reason, except inside a workflow action. New submissions must start as Received - Under Review.
- **Admin "Reopen decision"**, with a reason:
  - Refused → Received - Under Review, or Deficiency Notice Issued if a notice is still unanswered.
  - Lapsed → Deficiency Notice Issued.
  - Cancelled with a registration number → Registered (reinstated).
  - A Registered decision cannot be reopened, because its number is locked. Cancel it instead (para 14).
- **Deficiency notices are records** (`DeficiencyNotice`). When a response completes the submission, its received date is recorded. A new notice may be issued once the previous one is answered. A second or later notice on the same submission gets a `-2`, `-3`… suffix on its reference.
- **Admin can assign officers.** Separation of duties still applies.
- **Dev test clock:** `APP_TODAY=YYYY-MM-DD` sets "today" for every date calculation (timestamps stay real). The app shows a banner while it is on and refuses to start in production if it is set.
- **Phase 4 choices confirmed by default** (not objected to): mark complete after a deficiency response returns the submission to Received - Under Review; supervisors (and now Admin) assign officers; refusal only by the assigned approving officer under separation of duties; show-cause dates by supervisor or approver; decision checks lock after a final decision, post-approval checks only after registration.

## 2026-10-22 — after Phase 3 review

- **Waivers:** set only by Finance or Admin, with a reason (the written approval), never more than the registration fee. Audited.
- **Closed submissions stay editable.** Registered, Refused, Lapsed and Cancelled records can still have their details, documents and waiver corrected. Every change is audited. Pricing is still never re-taken automatically, and recalculation stays blocked once a registration number is locked.
- **No future dates** for date submitted, payment received or date filed.
- **Format validation at entry:** badly formatted CAC numbers, phones and emails are refused when typed in. Imported records (Phase 7) are flagged instead.
- **Missing capacity** for a capacity-based activity is a data flag, not a block.

## 2026-10-22 — before Phase 3

- **Own-use pricing is snapshotted too.** An OUN stores the Category I fee and the notification threshold (kW) used when it was saved. Only an admin recalculation with a reason changes it (audited).
- **Bulk recalculation.** Admins can tick submissions in the Register list and recalculate them together with one reason. Each submission still gets its own audit entry listing its changes.
- **Password change counts towards lockout.** A wrong current password on the change-password form counts as a failed attempt for that account. If it triggers a lockout, all of that account's sessions are also ended.

## 2026-10-22 — after Phase 2 review

### Snapshot pricing
- When a submission is saved, its pricing is frozen on the row: applied category, registration fee, late-charge initial / daily / cap, registration deadline, and the Effective Date used (`Submission.priced*`).
- Later edits to the fee table or Settings never change an existing submission. Fees, days late, the late charge and licence dates are calculated from the snapshot (`src/domain/pricing.ts`, `assessSubmission`).
- Only an explicit admin recalculation (`recalculatePricing`, permission `pricing.recalculate`) replaces a snapshot. It requires a reason and writes an audit entry listing each change. A DB trigger refuses any other update to the snapshot columns.
- Recalculation is refused once the registration number is locked (the category is part of the number).
- When the snapshot no longer matches current rules or the submission's own data (e.g. corrected capacity), the record shows the flag `PRICING_OUT_OF_DATE`. Like any flag, it must be resolved or overridden before approval.
- Open: own-use notifications (Category I fee) are not snapshotted yet. Decide before Phase 3 builds OUN intake.

### Fee table and activity admin pages
- Deferred until after Phase 4. When built, every edit requires a reason and is audited.

### Login throttling
- 5 failed attempts on one account within 15 minutes lock it for 15 minutes. The right password is refused while locked.
- Per-IP limit: 20 failed attempts in 15 minutes refuses that address until the window passes.
- Account lockouts and IP blocks are audited. An admin can unlock an account early (audited). Nothing locks permanently.
- The client IP is the right-most `X-Forwarded-For` entry, so production must sit behind a reverse proxy that sets it (Phase 8).

### Payment reversals
- Payments are never deleted or edited. A payment recorded in error is reversed: the reason is required, only Finance or Admin may reverse, and the original row stays visible, marked reversed with who and when. Reversed payments are excluded from all totals. A reversal is final. DB constraints and triggers enforce all of this.

### Sessions
- Session tokens are 256-bit random values. Only their SHA-256 is stored.
- Sessions expire after 8 hours idle and 12 hours absolute, enforced server-side. Deactivating a user ends their sessions.
- Cookies are httpOnly and SameSite=Lax, and Secure in production.
- Auth.js stays for now. Switching to Better Auth was considered and not done yet.

### Seed
- In production (`NODE_ENV=production`), the seed refuses to create the first admin with a default or weak password (`src/server/password-policy.ts`).

## Phase 0–1 choices (awaiting Commission confirmation)
See the Phase 1 summary: §9 open questions are Settings toggles defaulting to the Excel behaviour; check 7.6 is Y when an override reason explains the flags; "generation-related" for the ≥10 MW flag means GEN and CPT; refusal-ground wording for non-payment and out-of-scope is provisional; the deficiency notice year is the notice date's year.
