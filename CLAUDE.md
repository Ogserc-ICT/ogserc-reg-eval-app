# OGSERC Registration & Evaluation System

Internal web app for Ogun State Electricity Regulatory Commission (OGSERC) staff. It replaces the macro workbook in `reference/OGSERC_Registration_and_Evaluation_System.xlsm` and registers electricity operators under Order No. OGSERC/ORD/2026/001.

## Source of truth
- `docs/SPEC.md`: every business rule, workflow transition, number format and test fixture. **Read it before changing any domain logic.** If code and spec disagree, the spec wins. If the spec is unclear, ask; do not guess.
- `docs/TEMPLATES.md`: wording for the letters and the certificate.
- `docs/DECISIONS.md`: decisions made during the build that refine the spec (snapshot pricing, login throttling, payment reversals, deferrals). Read it with the spec; it wins where they differ.
- `seed-data.json`: fee table, activity→category map, LGAs, lists, all 63 evaluation checks (and the old 13-item Schedule 2 list, kept only for the workbook import and migration). Seed from this file; never hard-code these values in components.
- `registration-forms.json`: the 11 category forms REG-01A to REG-01K, each with its Schedule 2 document list (shared keys, `required_when` conditions). Seeded like `seed-data.json`. The Word forms are in `reference/forms/`.
- `technical-sections.json`: each form's category-specific sections (fields, tables, grids, units, which answers decide document conditions and capacities). Read by the app directly; edit it to change a form.
- `reference/*.xlsm`: the original workbook, for cross-checking only. It has known bugs (SPEC §8); do not copy its behaviour where the spec says otherwise.
- `assets/`: logo, certificate security background (2338×1654 PNG, A4 landscape), original Word certificate template (layout reference only).

## Stack
- Next.js (App Router) + TypeScript (strict), Tailwind CSS
- PostgreSQL + Prisma
- Auth.js with email + password (argon2 hashing); sessions in the DB. No public sign-up; admins create users.
- Zod for validation, shared between forms and server actions
- PDF: `pdf-lib` (or `@react-pdf/renderer`) on the server. **No dependency on Word or LibreOffice.**
- Tests: Vitest for domain logic, Playwright for end-to-end flows
- Scheduled daily review: a protected route called by cron at 06:00 Africa/Lagos, plus a manual "Run now" button
- Brand: OGSERC green and gold/yellow (match the logo)

## Conventions
- All domain rules live in `src/domain/` as **pure functions** with no DB or framework imports (category, fees, deadlines, completeness, SLA, flags, next action, recommended outcome, auto-checks). UI and server actions call them. This is the most important architectural rule.
- Money: integer kobo in the DB (`BigInt` or `Int`), formatted as ₦ with thousands separators in the UI.
- Dates: store dates without time for legal dates (submitted, complete, notice, certificate). "Today" always means today in Africa/Lagos. Day arithmetic counts whole calendar days.
- Every state-changing action is a server action that (1) checks role and separation-of-duties rules, (2) validates, (3) runs in a DB transaction, and (4) writes an AuditLog row in the same transaction.
- Generated numbers (ack, payment, OUN, registration) come from DB sequences/counters inside the transaction. They are never edited or reused.
- Calculated fields are computed by domain functions, not stored, except locked values (registration number, dates set by actions).
- Spelling: use "licence" (noun) as the Order does, and copy legal wording from the Order and TEMPLATES.md exactly.
- Never delete Submissions, Payments or AuditLog rows. Use statuses.

## Build phases (do one at a time; stop for review after each)
0. **Scaffold**: Next.js, Tailwind, Prisma, Postgres via docker-compose, ESLint/Prettier, Vitest, Playwright. Basic layout with sidebar.
1. **Domain logic + tests**: implement `src/domain/*` from SPEC §2, §3, §4.11, §6 and make **every fixture in SPEC §11 pass** as Vitest tests. No UI yet.
2. **Data model + auth + roles**: Prisma schema for SPEC §1, seed script from `seed-data.json`, users and roles (SPEC §5), admin pages for users and Settings.
3. **Intake and records**: new submission form, submission detail page (all calculated fields, flags, next action), documents checklist, payments ledger, own-use notifications, list views with filters and search.
4. **Evaluation and workflow**: EVAL-01 screen with auto checks read-only; actions: mark complete, issue deficiency, approve and register, lapse, refuse, cancel; all blockers from SPEC §4 with every reason shown; separation of duties enforced on the server.
5. **Documents**: acknowledgement letter, evaluation form, deficiency notice, certificate PDFs per `docs/TEMPLATES.md`. Store generated PDFs (with a hash) and let users re-download them.
6. **Dashboard and queues**: SPEC §10.
7. **Daily review job, audit log viewer, CSV/Excel export of the Register, and import of existing rows from the workbook.** Optional: QR code on the certificate linking to an internal verification page.
8. **Deployment**: Dockerfile, production compose (app + Postgres + backups), environment docs. Target a small VPS. Shared cPanel/DirectAdmin hosting will not run this reliably.

## Definition of done for any feature
- Domain rules covered by unit tests, including edge cases
- Server-side permission checks (never rely on hidden buttons)
- Audit log entry for every state change
- Works on a 1366×768 office laptop screen
