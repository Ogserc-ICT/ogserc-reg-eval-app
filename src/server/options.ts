import { conditionsUsedBy, OWN_USE_FORM } from "@/domain/forms";
import { eligibleOfficers } from "@/domain/roles";
import { HSE_TYPES } from "@/lib/schemas";
import { loadList, loadReferenceData, loadSettings } from "./reference-data";
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
    ref,
    settings,
  ] = await Promise.all([
    db.activity.findMany({
      orderBy: { sortOrder: "asc" },
      select: {
        code: true,
        name: true,
        cat10MwPlus: true,
        cat1To10Mw: true,
        catBelow1Mw: true,
        capacityBased: true,
      },
    }),
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
    loadReferenceData(db),
    loadSettings(db),
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
    /** REG-01A to K (not REG-01I, the own-use form) and the conditions their documents use. */
    forms: ref.forms
      .filter((f) => f.form !== OWN_USE_FORM)
      .map((f) => ({
        form: f.form,
        category: f.category,
        title: f.title,
        conditions: conditionsUsedBy([f]),
      })),
    /** Other activities need their own form's documents: every condition may then apply. */
    otherActivitiesRequireDocuments: settings.policy.otherActivitiesRequireDocuments,
    hseTypes: [...HSE_TYPES],
    /** Category-specific sections, and what decides which forms' sections the form shows. */
    technical: ref.technical,
    supplyRetailCategory1MwPlus: settings.policy.supplyRetailCategory1MwPlus,
  };
}

export type FormOptions = Awaited<ReturnType<typeof loadFormOptions>>;
