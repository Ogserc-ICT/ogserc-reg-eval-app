import { eligibleOfficers } from "@/domain/roles";
import { loadList } from "./reference-data";
import type { Db } from "./types";

/** Drop-down options for the Register, payment and own-use forms, all from the DB (seeded data). */
export async function loadFormOptions(db: Db) {
  const [
    activities,
    lgas,
    fees,
    users,
    licenceStatuses,
    channels,
    registrantTypes,
    fuels,
    purposes,
    paymentChannels,
  ] = await Promise.all([
    db.activity.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
    db.lga.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true } }),
    db.feeCategory.findMany({
      orderBy: { category: "asc" },
      select: { category: true, description: true },
    }),
    db.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, roles: true, active: true },
    }),
    loadList(db, "licence_statuses"),
    loadList(db, "submission_channels"),
    loadList(db, "registrant_types"),
    loadList(db, "fuel_technologies"),
    loadList(db, "payment_purposes"),
    loadList(db, "payment_channels"),
  ]);
  return {
    activities,
    lgas: lgas.map((l) => l.name),
    // Category I is for own-use notifications only.
    categories: fees.filter((f) => f.category !== "I"),
    evaluators: eligibleOfficers(users, "EVALUATING_OFFICER").map((u) => ({
      id: u.id,
      name: u.name,
    })),
    licenceStatuses,
    channels,
    registrantTypes,
    fuels,
    purposes,
    paymentChannels,
  };
}

export type FormOptions = Awaited<ReturnType<typeof loadFormOptions>>;
