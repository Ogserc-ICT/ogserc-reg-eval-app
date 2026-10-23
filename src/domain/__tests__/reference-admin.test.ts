import { describe, expect, it } from "vitest";
import { nairaToKobo } from "../money";
import {
  activityMapChanges,
  activityMapErrors,
  feeTableChanges,
  feeTableErrors,
  type ActivityEdit,
  type FeeEdit,
} from "../reference-admin";
import { ref } from "./helpers";

const feeEdits = (change: Partial<FeeEdit> & { category: string }): FeeEdit[] =>
  ref.fees.map((f) => ({ ...f, ...(f.category === change.category ? change : {}) }));
const activityEdits = (change: Partial<ActivityEdit> & { code: string }): ActivityEdit[] =>
  ref.activities.map((a) => ({ ...a, ...(a.code === change.code ? change : {}) }));
const categories = ref.fees.map((f) => f.category);

describe("fee table edits", () => {
  it("accepts the table as it is, and describes only real changes", () => {
    expect(feeTableErrors(ref.fees, feeEdits({ category: "D" }))).toEqual({});
    expect(feeTableChanges(ref.fees, feeEdits({ category: "D" }))).toEqual([]);
    expect(
      feeTableChanges(ref.fees, feeEdits({ category: "D", registrationFee: nairaToKobo(350_000) })),
    ).toEqual([{ category: "D", detail: "registration fee ₦300,000 → ₦350,000" }]);
  });

  it("requires every amount, a positive fee and a description", () => {
    expect(
      feeTableErrors(
        ref.fees,
        feeEdits({ category: "E", registrationFee: 0, lateDaily: null, description: " " }),
      ),
    ).toEqual({
      "E.lateDaily": ["Enter the late charge (per day) in naira"],
      "E.registrationFee": ["Must be more than ₦0"],
      "E.description": ["Enter the description"],
    });
  });

  it("refuses unknown or missing categories", () => {
    const edits = feeEdits({ category: "A" }).filter((e) => e.category !== "K");
    expect(feeTableErrors(ref.fees, [...edits, { ...edits[0]!, category: "Z" }])).toEqual({
      "Z.category": ["Unknown or repeated category"],
      "K.category": ["Missing from the form"],
    });
  });
});

describe("activity map edits", () => {
  it("accepts the map as it is and describes changes", () => {
    expect(activityMapErrors(ref.activities, categories, activityEdits({ code: "SUP" }))).toEqual(
      {},
    );
    const change = activityEdits({
      code: "SUP",
      cat10MwPlus: "F",
      cat1To10Mw: "F",
      catBelow1Mw: "F",
    });
    expect(activityMapErrors(ref.activities, categories, change)).toEqual({});
    expect(activityMapChanges(ref.activities, change)).toEqual([
      { code: "SUP", detail: "10 MW or more K → F; 1 to below 10 MW K → F; below 1 MW K → F" },
    ]);
  });

  it("never maps an activity to Category I, and keeps the capacity flag consistent", () => {
    expect(
      activityMapErrors(
        ref.activities,
        categories,
        activityEdits({ code: "SUP", cat10MwPlus: "I", catBelow1Mw: "C" }),
      ),
    ).toEqual({
      "SUP.cat10MwPlus": ["Choose a Schedule 3 category (not I, which is own-use only)"],
      "SUP.capacityBased": [
        "Categories differ by capacity: tick “Depends on capacity” or use one category",
      ],
    });
  });
});
