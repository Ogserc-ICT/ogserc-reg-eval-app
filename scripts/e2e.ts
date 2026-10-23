// npm run test:e2e — Playwright against a throwaway database.
// Uses E2E_DATABASE_URL if set (e.g. a docker-compose Postgres); otherwise starts an embedded one.
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { E2E_ADMIN } from "../tests/e2e/constants";
import { startEmbeddedDb, type EmbeddedDb } from "./embedded-db";

async function main() {
  let embedded: EmbeddedDb | null = null;
  let url = process.env.E2E_DATABASE_URL;
  if (!url) {
    embedded = await startEmbeddedDb({
      dir: mkdtempSync(path.join(tmpdir(), "ogserc-e2e-")),
      port: 5435,
      database: "ogserc_e2e",
      persistent: false,
    });
    url = embedded.url;
  }
  const env = {
    ...process.env,
    DATABASE_URL: url,
    AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-0123456789abcdef0123456789",
    SEED_ADMIN_EMAIL: E2E_ADMIN.email,
    SEED_ADMIN_PASSWORD: E2E_ADMIN.password,
    E2E_PORT: process.env.E2E_PORT ?? "3100",
  };
  try {
    execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
    execSync("npx prisma db seed", { env, stdio: "inherit" });
    const result = spawnSync("npx", ["playwright", "test", ...process.argv.slice(2)], {
      env,
      stdio: "inherit",
      shell: true,
    });
    process.exitCode = result.status ?? 1;
  } finally {
    await embedded?.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
