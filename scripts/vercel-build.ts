// Vercel build (package.json "vercel-build", which Vercel runs instead of "build"):
//   1. prisma generate (for Vercel's Linux build machine)
//   2. production deployments only: apply database migrations, then the create-only seed (reference
//      data and the first admin; never overwrites anything already in the database)
//   3. next build
// Preview deployments skip step 2, so an unmerged branch can never change the live database.
// Migrations use DATABASE_URL_UNPOOLED (Neon's direct connection) when set: schema changes need a
// direct connection, not the pooler the app uses.
import { execSync } from "node:child_process";

const run = (command: string, env: NodeJS.ProcessEnv = process.env) =>
  execSync(command, { stdio: "inherit", env });

const production = process.env.VERCEL_ENV === "production";

run("npx prisma generate");

if (production) {
  const direct = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!direct) throw new Error("DATABASE_URL is not set for Production in the Vercel project.");
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: direct, NODE_ENV: "production" };
  console.log("Production deployment: applying database migrations…");
  run("npx prisma migrate deploy", env);
  console.log("Seeding reference data and the first admin (create-only)…");
  run("npx prisma db seed", env);
} else {
  console.log(
    `${process.env.VERCEL_ENV ?? "local"} build: database migrations skipped (production deployments only).`,
  );
}

run("npx next build");
