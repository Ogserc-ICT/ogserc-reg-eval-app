# Handoff pack: OGSERC Registration & Evaluation web app

Put these files at the root of a new, empty repo, then start Claude Code there.

- CLAUDE.md: project instructions Claude Code reads automatically (stack, conventions, build phases)
- docs/SPEC.md: business rules extracted from the Excel formulas and VBA
- docs/TEMPLATES.md: letter and certificate wording
- seed-data.json: fee table, activity map, lists, documents, evaluation checks
- assets/: logo, certificate background, original Word certificate template
- reference/: the original .xlsm

## Development

```sh
cp .env.example .env        # then set AUTH_SECRET and SEED_ADMIN_PASSWORD
npm install
npm run db:up               # Postgres 16 via docker-compose (port 5432)
#   no Docker? `npm run db:embedded` runs Postgres from npm on port 5433 (set DATABASE_URL to match)
npm run db:deploy           # apply migrations
npm run db:seed             # reference data from seed-data.json + the first admin
npm run dev                 # http://localhost:3000, sign in as SEED_ADMIN_EMAIL
```

Tests:

```sh
npm test                    # Vitest unit tests: domain rules incl. SPEC §11 fixtures
npm run test:integration    # services and DB rules against a throwaway Postgres (TEST_DATABASE_URL or embedded)
npm run test:e2e            # Playwright against a throwaway, seeded Postgres (first time: npx playwright install chromium)
npm run lint && npm run typecheck && npm run format:check
```

Production:

```sh
npm run smoke:standalone    # build the production server bundle and smoke-test it on a throwaway Postgres
```

Going live:

- **Vercel + Neon** (chosen; no server to look after): [docs/DEPLOYMENT-VERCEL.md](docs/DEPLOYMENT-VERCEL.md)
- Alternative, your own VPS with Docker: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

Layout:

- `src/domain/`: business rules as pure functions (no DB or framework imports, enforced by ESLint)
- `src/server/`: services. Each state change checks permissions, validates with Zod, runs in a transaction and writes an AuditLog row
- `src/app/`: pages and thin server actions that call the services
- `prisma/`: schema, migrations (including DB triggers: no deletes on Submission/Payment, append-only AuditLog, locked registration numbers) and the seed

First prompt to Claude Code:
"Read CLAUDE.md and docs/SPEC.md. Do Phase 0 and Phase 1 only. Phase 1 is done when every fixture in SPEC §11 passes. Stop and summarise when finished."
