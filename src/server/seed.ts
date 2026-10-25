import formsFile from "../../registration-forms.json";
import seedFile from "../../seed-data.json";
import { referenceDataFromSeed, settingsFromSeed } from "@/domain/reference";
import { writeAudit } from "./audit";
import { COUNTER } from "./counters";
import { hashPassword } from "./password";
import { adminPasswordProblems, isProduction } from "./password-policy";
import { LISTS, settingsToRow } from "./reference-data";
import type { Db } from "./types";

/**
 * Seed reference data from seed-data.json and registration-forms.json. Create-only: rows that already exist are left alone,
 * so re-running never overwrites values an admin has edited.
 */
export async function seedReferenceData(db: Db): Promise<void> {
  const ref = referenceDataFromSeed(seedFile, formsFile);
  const settings = settingsFromSeed(seedFile);

  await db.$transaction(async (tx) => {
    for (const f of ref.fees) {
      const data = {
        registrationFee: BigInt(f.registrationFee),
        lateInitial: BigInt(f.lateInitial),
        lateDaily: BigInt(f.lateDaily),
        lateDailyCap: BigInt(f.lateDailyCap),
        lateTier: f.lateTier,
        description: f.description,
      };
      await tx.feeCategory.upsert({
        where: { category: f.category },
        create: { category: f.category, ...data },
        update: {},
      });
    }

    for (const [i, a] of ref.activities.entries()) {
      await tx.activity.upsert({
        where: { code: a.code },
        create: {
          code: a.code,
          name: a.name,
          cat10MwPlus: a.cat10MwPlus,
          cat1To10Mw: a.cat1To10Mw,
          catBelow1Mw: a.catBelow1Mw,
          capacityBased: a.capacityBased,
          sortOrder: i + 1,
        },
        update: {},
      });
    }

    await tx.lga.createMany({
      data: seedFile.lgas.map((name, i) => ({ name, sortOrder: i + 1 })),
      skipDuplicates: true,
    });

    for (const list of LISTS) {
      await tx.lookupValue.createMany({
        data: seedFile[list].map((value, i) => ({ list, value, sortOrder: i + 1 })),
        skipDuplicates: true,
      });
    }

    await tx.registrationForm.createMany({
      data: ref.forms.map((f, i) => ({
        form: f.form,
        category: f.category,
        title: f.title,
        para: f.para,
        sortOrder: i + 1,
      })),
      skipDuplicates: true,
    });
    await tx.formDocument.createMany({
      data: ref.forms.flatMap((f) =>
        f.documents.map((d, i) => ({
          form: f.form,
          key: d.key,
          text: d.text,
          requiredWhen: d.requiredWhen,
          sortOrder: i + 1,
        })),
      ),
      skipDuplicates: true,
    });

    await tx.evaluationCheck.createMany({
      data: ref.evaluationChecks.map((c, i) => ({
        id: c.id,
        stage: c.stage,
        text: c.text,
        sortOrder: i + 1,
      })),
      skipDuplicates: true,
    });

    await tx.settings.upsert({
      where: { id: 1 },
      create: { id: 1, ...settingsToRow(settings) },
      update: {},
    });

    await tx.counter.createMany({
      data: [COUNTER.ACK, COUNTER.PAYMENT, COUNTER.OUN].map((name) => ({ name, value: 0 })),
      skipDuplicates: true,
    });
  });
}

/**
 * Create the first admin (there is no public sign-up). Does nothing if the email already exists.
 * In production, refuses a default or weak password.
 */
export async function ensureAdmin(
  db: Db,
  email: string,
  password: string,
  { production = isProduction(), name = "System Administrator" } = {},
) {
  const normalised = email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email: normalised } });
  if (existing) return { created: false as const, user: existing };
  if (production) {
    const problems = adminPasswordProblems(password, normalised);
    if (problems.length) {
      throw new Error(
        `Refusing to create the production admin: SEED_ADMIN_PASSWORD ${problems.join("; ")}.`,
      );
    }
  }
  if (password.length < 10) throw new Error("SEED_ADMIN_PASSWORD must be at least 10 characters");
  const passwordHash = await hashPassword(password);
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name, email: normalised, passwordHash, roles: ["ADMIN"] },
    });
    await writeAudit(tx, {
      userId: null,
      action: "User created",
      reference: normalised,
      detail: `${name} - roles Admin (initial admin from seed)`,
    });
    return created;
  });
  return { created: true as const, user };
}
