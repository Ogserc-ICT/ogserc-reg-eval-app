// Category forms part 2: the category-specific sections (technical-sections.json).
import { describe, expect, it } from "vitest";
import { dataFlags } from "../flags";
import { CONDITION_KEYS, NO_CONDITIONS, OWN_USE_FORM } from "../forms";
import { assessSubmission, technicalForms } from "../submission";
import {
  capacitiesAgree,
  conditionsDecidedBy,
  derivedConditions,
  fieldText,
  parseTechnical,
  sectionStatus,
  technicalChanges,
  technicalForEditing,
  type TechnicalData,
} from "../technical";
import { LICENCE, type SubmissionInput } from "../types";
import {
  activity,
  answeredTechnical,
  ctx,
  makeSubmission,
  payment,
  ref,
  settings,
} from "./helpers";

const defs = ref.technical;
const section = (form: string, key: string) => defs[form]!.sections.find((s) => s.key === key)!;
const answers = (
  form: string,
  sections: Record<string, Record<string, unknown>>,
  notApplicable: string[] = [],
) => ({ [form]: { notApplicable, sections } }) as unknown as TechnicalData;
// Generation for sale, 5 MW: Category D, REG-01D.
const gen5 = (o: Partial<SubmissionInput> = {}) =>
  makeSubmission({ primaryActivity: activity("GEN"), installedCapacityMw: 5, ...o });
const codes = (sub: SubmissionInput) => {
  const c = ctx();
  return dataFlags(sub, assessSubmission(sub, [], c), [], c).map((f) => f.code);
};

describe("definitions (technical-sections.json)", () => {
  it("cover every form except REG-01I, whose sections are the own-use form", () => {
    expect(Object.keys(defs).sort()).toEqual(
      ref.forms
        .map((f) => f.form)
        .filter((f) => f !== OWN_USE_FORM)
        .sort(),
    );
  });

  it("use unique keys, known conditions, and numbers for capacities and totals", () => {
    for (const [form, def] of Object.entries(defs)) {
      expect(new Set(def.sections.map((s) => s.key)).size, form).toBe(def.sections.length);
      for (const s of def.sections) {
        expect(new Set(s.fields.map((f) => f.key)).size, `${form} ${s.key}`).toBe(s.fields.length);
        for (const k of [s.appliesWhen, s.derive, ...s.fields.map((f) => f.derive?.condition)]) {
          if (k) expect(CONDITION_KEYS).toContain(k);
        }
        for (const f of s.fields) {
          for (const c of f.columns ?? []) {
            if (c.sum || c.capacity) expect(["number", "integer", "money"]).toContain(c.type);
          }
          for (const v of f.derive?.yes ?? []) expect(f.options!.map((o) => o.value)).toContain(v);
        }
      }
    }
  });

  it("decide every document condition the forms' lists use, except holding a licence", () => {
    const used = new Set(
      ref.forms.flatMap((f) => f.documents.map((d) => d.requiredWhen)).filter(Boolean),
    );
    const decided = new Set(conditionsDecidedBy(defs, Object.keys(defs)));
    expect([...used].filter((k) => !decided.has(k!))).toEqual(["holds_any_licence"]);
  });
});

describe("parsing", () => {
  it("keeps only what the definitions know, typed, and drops blank rows", () => {
    const { data, errors } = parseTechnical(defs, {
      "REG-01D": {
        notApplicable: ["operations", "nonsense"],
        sections: {
          generation_activity: { activity: ["sale_on_grid"], total_mw: "5", junk: "x" },
          generating_plant: {
            plant: [
              { unit: "GT1", installed: "3", available: "2.5" },
              { unit: "", installed: "" },
            ],
          },
        },
      },
      "REG-01Z": { sections: {} },
    });
    expect(errors).toEqual([]);
    expect(data).toEqual({
      "REG-01D": {
        notApplicable: ["operations"],
        sections: {
          generation_activity: { activity: ["sale_on_grid"], total_mw: 5 },
          generating_plant: {
            plant: [
              {
                unit: "GT1",
                location: null,
                fuel: null,
                installed: 3,
                available: 2.5,
                commissioned: null,
              },
            ],
          },
        },
      },
    });
  });

  it("reports each problem with its form, section, field and row", () => {
    const { errors } = parseTechnical(defs, {
      "REG-01D": {
        sections: {
          generation_activity: { activity: ["moon"], total_mw: "five" },
          generating_plant: { plant: [{ unit: "A" }, { installed: "lots" }] },
          grid_offtake: { network: "satellite" },
        },
      },
    });
    expect(errors).toEqual([
      "REG-01D Generation activity: Activity: not one of the choices",
      "REG-01D Generation activity: Total installed capacity at all sites (MW) must be a number",
      "REG-01D Generating plant: Generating plant, row 2: Installed MW must be a number",
      "REG-01D Grid connection and offtake: Network connected to must be one of the choices",
    ]);
  });

  it("stores money in kobo and shows it back in naira for editing", () => {
    const { data } = parseTechnical(defs, {
      "REG-01E": {
        sections: {
          operations: { last_12_months: [{ month: "2026-09", amount_billed: "1,250,000.50" }] },
        },
      },
    });
    const row = (
      data["REG-01E"]!.sections.operations!.last_12_months as Record<string, unknown>[]
    )[0]!;
    expect(row.amount_billed).toBe(125_000_050);
    const edit = technicalForEditing(defs, data);
    expect(
      (edit["REG-01E"]!.sections.operations!.last_12_months as Record<string, unknown>[])[0]!
        .amount_billed,
    ).toBe("1250000.5");
    expect(parseTechnical(defs, edit).data).toEqual(data);
  });

  it("keeps at most the fixed number of rows (the 12 months)", () => {
    const months = Array.from({ length: 14 }, (_, i) => ({ month: `m${i + 1}`, generated: "1" }));
    const { data } = parseTechnical(defs, {
      "REG-01D": { sections: { operations: { last_12_months: months } } },
    });
    expect(data["REG-01D"]!.sections.operations!.last_12_months).toHaveLength(12);
  });
});

describe("section completeness", () => {
  const s = section("REG-01D", "generation_activity");
  it("is empty, incomplete, then complete; optional fields do not count", () => {
    const status = (v: Record<string, unknown>, na: string[] = []) =>
      sectionStatus(
        s,
        answers("REG-01D", { generation_activity: v }, na)["REG-01D"]!,
        NO_CONDITIONS,
      );
    expect(status({})).toBe("empty");
    expect(status({ activity: ["captive"] })).toBe("incomplete");
    expect(status({ activity: ["captive"], total_mw: 5, cod: "2024" })).toBe("complete");
    expect(status({}, ["generation_activity"])).toBe("not-applicable");
    const plant = section("REG-01D", "generating_plant");
    // The fuel-supply fields are optional.
    expect(
      sectionStatus(
        plant,
        answers("REG-01D", { generating_plant: { plant: [{ unit: "A" }] } })["REG-01D"]!,
        NO_CONDITIONS,
      ),
    ).toBe("complete");
  });

  it("does not require REG-01A's multi-State section of a licensee that is not multi-State", () => {
    const ms = section("REG-01A", "multi_state");
    const none = answers("REG-01A", {})["REG-01A"]!;
    expect(sectionStatus(ms, none, { ...NO_CONDITIONS, multi_state_licensee: "N" })).toBe(
      "not-required",
    );
    expect(sectionStatus(ms, none, { ...NO_CONDITIONS, multi_state_licensee: "Y" })).toBe("empty");
  });
});

describe("conditions decided by the answers", () => {
  const derive = (
    form: string,
    sections: Record<string, Record<string, unknown>>,
    na: string[] = [],
  ) => derivedConditions(defs, answers(form, sections, na), [form]);

  it("REG-01D: generation for sale, and grid connection", () => {
    expect(derive("REG-01D", { generation_activity: { activity: ["captive"] } })).toEqual({
      generation_for_sale: "N",
    });
    expect(
      derive("REG-01D", { generation_activity: { activity: ["captive", "sale_embedded"] } }),
    ).toEqual({
      generation_for_sale: "Y",
    });
    expect(derive("REG-01D", { grid_offtake: { network: "none" } })).toEqual({
      grid_connected: "N",
    });
    expect(derive("REG-01D", { grid_offtake: { network: "disco" } })).toEqual({
      grid_connected: "Y",
    });
    expect(derive("REG-01D", {})).toEqual({});
  });

  it("REG-01E, G, J and A from their choices", () => {
    expect(derive("REG-01E", { minigrid_type: { type: ["interconnected"] } })).toEqual({
      interconnected_minigrid: "Y",
    });
    expect(derive("REG-01G", { source_of_supply: { source: ["own_generation"] } })).toEqual({
      g_disco_bulk_supply: "N",
    });
    expect(derive("REG-01J", { franchise: { role: ["sub_franchisee"] } })).toEqual({
      sub_franchise: "Y",
    });
    expect(derive("REG-01A", { distribution_business: { type: ["ogun_only"] } })).toEqual({
      multi_state_licensee: "N",
    });
  });

  it("REG-01F: Part 1 and Part 2 apply when answered, and not when marked 'does not apply'", () => {
    expect(derive("REG-01F", { distribution: { type: ["iedn"] } }, ["trading"])).toEqual({
      f_distribution: "Y",
      f_trading: "N",
    });
  });

  it("a Yes from any form wins", () => {
    const data = {
      ...answers("REG-01C", { grid_offtake: { network: "none" } }),
      ...answers("REG-01D", { grid_offtake: { network: "tcn" } }),
    };
    expect(derivedConditions(defs, data, ["REG-01C", "REG-01D"])).toEqual({ grid_connected: "Y" });
    expect(derivedConditions(defs, data, ["REG-01D", "REG-01C"])).toEqual({ grid_connected: "Y" });
  });

  it("drive the checklist: captive-only plant needs no offtake agreement; holding a licence follows the status", () => {
    const captive = gen5({
      technicalData: answers("REG-01D", {
        generation_activity: { activity: ["captive"] },
        grid_offtake: { network: "none" },
      }),
    });
    const a = assessSubmission(captive, [], ctx());
    const item = (k: string) => a.documents.items.find((d) => d.key === k);
    expect(item("ppa_offtake")).toMatchObject({ value: "N/A", mode: "auto-na" });
    expect(item("connection_agreement")).toMatchObject({ value: "N/A", mode: "auto-na" });
    expect(a.conditions.holds_any_licence).toBe("Y");
    const unlicensed = assessSubmission(
      gen5({ licenceStatus: LICENCE.UNLICENSED, licences: [] }),
      [],
      ctx(),
    );
    expect(unlicensed.documents.items.find((d) => d.key === "licences")?.value).toBe("N/A");
    // A stored answer still applies where the sections do not decide.
    const stored = gen5({
      technicalData: {},
      conditions: { ...NO_CONDITIONS, generation_for_sale: "N" },
    });
    expect(assessSubmission(stored, [], ctx()).conditions.generation_for_sale).toBe("N");
  });
});

describe("forms shown and flags", () => {
  it("shows the form filed's sections, then each other activity's form at the capacity", () => {
    const sub = gen5({ otherActivities: [activity("MET"), activity("SUP")] });
    // GEN 5 MW → D; metering → H; supply/retail at 5 MW → K (the policy setting).
    expect(technicalForms(sub, ctx())).toEqual(["REG-01D", "REG-01H", "REG-01K"]);
  });

  it("flags the form filed's sections that are not complete, not other activities'", () => {
    const sub = gen5({
      otherActivities: [activity("MET")],
      technicalData: answers("REG-01D", { generation_activity: { activity: ["captive"] } }, [
        "operations",
      ]),
    });
    const c = ctx();
    const flag = dataFlags(sub, assessSubmission(sub, [], c), [], c).find(
      (f) => f.code === "TECHNICAL_INCOMPLETE",
    );
    expect(flag?.message).toBe(
      "REG-01D sections not complete: Generation activity; Generating plant; Grid connection and offtake",
    );
    expect(codes(gen5())).not.toContain("TECHNICAL_INCOMPLETE");
  });

  it("flags a stated capacity that is not the installed capacity", () => {
    const sub = gen5({
      technicalData: {
        "REG-01D": {
          ...answeredTechnical("REG-01D", 5)["REG-01D"]!,
          sections: {
            ...answeredTechnical("REG-01D", 5)["REG-01D"]!.sections,
            generating_plant: {
              plant: [
                { unit: "A", installed: 3 },
                { unit: "B", installed: 1.5 },
              ],
            },
          },
        },
      },
    });
    const c = ctx();
    const flag = dataFlags(sub, assessSubmission(sub, [], c), [], c).find(
      (f) => f.code === "TECHNICAL_CAPACITY_MISMATCH",
    );
    expect(flag?.message).toBe(
      "Installed capacity is 5 MW, but REG-01D Generating plant: total Installed MW gives 4.5 MW",
    );
    // kW on REG-01K, and rounding within 1%.
    const k = makeSubmission({
      primaryActivity: activity("GEN"),
      installedCapacityMw: 0.5,
      technicalData: answers("REG-01K", {
        assets: { assets: [{ capacity_kw: 250 }, { capacity_kw: 252 }] },
      }),
    });
    expect(codes(k)).not.toContain("TECHNICAL_CAPACITY_MISMATCH");
    expect(capacitiesAgree(10, 10.05)).toBe(true);
    expect(capacitiesAgree(10, 10.2)).toBe(false);
  });

  it("leave the Finance gate and completeness rules as they were", () => {
    const sub = gen5({ technicalData: {} });
    const a = assessSubmission(sub, [payment(sub.ackNo!, 300_000)], ctx(undefined, settings));
    expect(a.financeGate.cleared).toBe(true);
  });
});

describe("text and changes", () => {
  it("writes answers as one line each", () => {
    const plant = section("REG-01D", "generating_plant").fields[0]!;
    expect(
      fieldText(plant, [
        { unit: "GT1", installed: 3, fuel: "Gas" },
        { unit: "GT2", installed: 2 },
      ]),
    ).toBe("GT1, Gas, 3 MW | GT2, 2 MW");
    const customers = section("REG-01G", "customers_tariff").fields[0]!;
    expect(fieldText(customers, { residential: { metered: 120, unmetered: 4 } })).toBe(
      "Residential: Metered 120, Unmetered 4",
    );
    const ops = section("REG-01E", "operations").fields[0]!;
    expect(fieldText(ops, [{ month: "2026-09", amount_billed: 125_000_050 }])).toBe(
      "2026-09, ₦1,250,000.50",
    );
  });

  it("lists what changed, field by field, including 'does not apply'", () => {
    const before = answers("REG-01D", { generation_activity: { total_mw: 5 } });
    const after = answers("REG-01D", { generation_activity: { total_mw: 6 } }, ["operations"]);
    expect(technicalChanges(defs, before, after)).toEqual([
      {
        key: "technical:REG-01D:generation_activity:total_mw",
        label: "REG-01D Generation activity: Total installed capacity at all sites (MW)",
        before: "5 MW",
        after: "6 MW",
        certificate: false,
      },
      {
        key: "technical:REG-01D:operations",
        label: "REG-01D Operations — last 12 months",
        before: null,
        after: "does not apply",
        certificate: false,
      },
    ]);
    expect(technicalChanges(defs, before, before)).toEqual([]);
  });
});
