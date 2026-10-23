// npm run db:seed — reference data from seed-data.json, plus the first admin from SEED_ADMIN_EMAIL /
// SEED_ADMIN_PASSWORD. Example submissions are not seeded here (SPEC §8.8: dev/test only, Phase 3).
import { PrismaClient } from "@prisma/client";
import { ensureAdmin, seedReferenceData } from "../src/server/seed";

const db = new PrismaClient();

async function main() {
  await seedReferenceData(db);
  console.log("Reference data seeded.");

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    const { created } = await ensureAdmin(db, email, password);
    console.log(
      created ? `Admin ${email} created.` : `Admin ${email} already exists; left unchanged.`,
    );
  } else {
    console.log("SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set; no admin created.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
