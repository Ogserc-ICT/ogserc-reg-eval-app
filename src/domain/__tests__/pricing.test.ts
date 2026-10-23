// Snapshot pricing in the domain layer: a saved submission is assessed under its own snapshot.
import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { dataFlags } from "../flags";
import { priceSubmission, pricingDifferences } from "../pricing";
import type { ReferenceData } from "../reference";
import { assessSubmission } from "../submission";
import { LICENCE } from "../types";
import {
  DEADLINE,
  ED,
  activity,
  ctx,
  makeSubmission,
  naira,
  payment,
  ref,
  settings,
} from "./helpers";

/** The fee table with Category D raised, as an admin might edit it later. */
const raisedRef: ReferenceData = {
  ...ref,
  fees: ref.fees.map((f) =>
    f.category === "D"
      ? {
          ...f,
          registrationFee: naira(400_000),
          lateInitial: naira(600_000),
          lateDaily: naira(150_000),
        }
      : f,
  ),
};

const lateGen = {
  primaryActivity: activity("GEN"),
  installedCapacityMw: 5,
  dateSubmitted: addDays(DEADLINE, 20),
};

describe("pricing snapshot", () => {
  it("captures category, fee terms, deadline and Effective Date", () => {
    expect(priceSubmission(makeSubmission(lateGen), ref, settings)).toEqual({
      category: "D",
      registrationFee: naira(300_000),
      lateInitial: naira(500_000),
      lateDaily: naira(100_000),
      lateDailyCap: naira(10_000_000),
      deadline: DEADLINE,
      effectiveDate: ED,
    });
  });

  it("keeps the total due when the fee table changes", () => {
    const saved = makeSubmission({
      ...lateGen,
      pricing: priceSubmission(makeSubmission(lateGen), ref, settings),
    });
    const today = addDays(DEADLINE, 25);
    const before = assessSubmission(saved, [], ctx(today));
    const after = assessSubmission(saved, [], { ...ctx(today), ref: raisedRef });
    expect(before.fees.totalDue).toBe(naira(2_800_000));
    expect(after.fees).toEqual(before.fees);
    // Unsaved (live) pricing would follow the new table.
    const live = assessSubmission(makeSubmission(lateGen), [], { ...ctx(today), ref: raisedRef });
    expect(live.fees.totalDue).toBe(naira(400_000 + 600_000 + 150_000 * 20));
  });

  it("keeps the deadline and licence dates when Settings change", () => {
    const sub = { ...lateGen, licenceStatus: LICENCE.UNLICENSED, licenceNo: null };
    const saved = makeSubmission({
      ...sub,
      pricing: priceSubmission(makeSubmission(sub), ref, settings),
    });
    const moved = { ...settings, effectiveDate: "2026-12-01", registrationPeriodDays: 90 };
    const a = assessSubmission(saved, [], { ref, settings: moved, today: addDays(DEADLINE, 25) });
    expect(a.registrationDeadline).toBe(DEADLINE);
    expect(a.daysLate).toBe(20);
    expect(a.licenceApplicationDue).toBe(addDays(ED, 90));
    expect(a.pricingChanges).toEqual([
      "deadline 21 December 2026 → 1 March 2027",
      "Effective Date 22 October 2026 → 1 December 2026",
    ]);
  });

  it("flags a snapshot that no longer matches the submission's own data", () => {
    const saved = makeSubmission({
      ...lateGen,
      pricing: priceSubmission(makeSubmission(lateGen), ref, settings),
    });
    const corrected = { ...saved, installedCapacityMw: 12 }; // now Category C
    const c = ctx(addDays(DEADLINE, 25));
    const a = assessSubmission(corrected, [], c);
    expect(a.categoryApplied).toBe("D");
    expect(a.categoryAuto).toBe("C");
    expect(a.pricingChanges[0]).toBe("category D → C");
    expect(dataFlags(corrected, a, [], c).map((f) => f.code)).toContain("PRICING_OUT_OF_DATE");
  });

  it("reports no differences for identical snapshots", () => {
    const p = priceSubmission(makeSubmission(lateGen), ref, settings)!;
    expect(pricingDifferences(p, { ...p })).toEqual([]);
  });
});

describe("reversed payments", () => {
  it("are excluded from amount paid", () => {
    const sub = makeSubmission();
    const pays = [
      payment(sub.ackNo!, 250_000),
      { ...payment(sub.ackNo!, 250_000), status: "REVERSED" as const },
    ];
    expect(assessSubmission(sub, pays, ctx()).fees.amountPaid).toBe(naira(250_000));
  });
});
