import { describe, expect, it } from "vitest";
import seed from "../../../seed-data.json";
import { nairaToKobo } from "../money";
import {
  planWorkbookImport,
  type ImportContext,
  type WbCell,
  type WbRow,
  type WorkbookData,
} from "../workbook-import";
import { activity, ctx, readySettings, ref } from "./helpers";

const TODAY = "2026-11-30";

type Value = WbCell["value"] | { f: WbCell["value"] };
const row = (n: number, values: Record<string, Value>): WbRow => ({
  row: n,
  cells: Object.fromEntries(
    Object.entries(values).map(([k, v]) => [
      k,
      v !== null && typeof v === "object"
        ? { value: v.f, formula: true }
        : { value: v, formula: false },
    ]),
  ),
});

const ACK = "OGSERC/ACK/2026/00002";

function register(n: number, overrides: Record<string, Value> = {}): WbRow {
  return row(n, {
    "Acknowledgement No.": { f: `OGSERC/ACK/2026/${String(n - 3).padStart(5, "0")}` },
    "Registered Name *": `Registrant ${n} Ltd`,
    "Date Submitted *": "2026-10-22",
    "Submission Channel": "By hand",
    "Registrant Type": "Company",
    "CAC / Registration No.": `RC${1000 + n}`,
    "Principal LGA *": "Ifo",
    "Primary Activity *": activity("MGD"),
    "Installed Capacity (MW)": 2.5,
    "Licence Status *": "NERC registration/permit (mini-grid/captive)",
    "Operating on Effective Date? (Y/N) *": "Y",
    "Registration Fee (₦)": { f: 250000 },
    "Late Registration Charge (₦)": { f: "" },
    "Total Due (₦)": { f: 250000 },
    "Status *": "Received - Under Review",
    ...overrides,
  });
}

const docs = (n: number, ack: string, value = "Y") =>
  row(n, {
    "Acknowledgement No.": { f: ack },
    ...Object.fromEntries(seed.schedule2_documents.map((d, i) => [`${i + 1}. ${d}`, value])),
  });

const evaluation = (n: number, ack: string, overrides: Record<string, Value> = {}) =>
  row(n, { "Acknowledgement No.": { f: ack }, ...overrides });

function workbook(parts: Partial<WorkbookData> = {}): WorkbookData {
  return {
    register: [register(5)],
    documents: [docs(5, ACK)],
    evaluation: [evaluation(5, ACK)],
    payments: [],
    ownUse: [],
    audit: [],
    ...parts,
  };
}

const context = (overrides: Partial<ImportContext["existing"]> = {}): ImportContext => ({
  ctx: ctx(TODAY, readySettings),
  lists: {
    lgas: seed.lgas,
    licenceStatuses: seed.licence_statuses,
    submissionChannels: seed.submission_channels,
    registrantTypes: seed.registrant_types,
  },
  users: [
    { id: "u-eval", name: "Blessing Ade", roles: ["EVALUATING_OFFICER"], active: true },
    { id: "u-sup", name: "Kelvin Obi", roles: ["REVIEWING_SUPERVISOR"], active: true },
  ],
  existing: {
    submissions: new Map(),
    ackSeqs: new Set(),
    ownUse: new Map(),
    ounSeqs: new Set(),
    payments: new Map(),
    paymentSeqs: new Set(),
    registrationNos: new Set(),
    ...overrides,
  },
});

const messages = (plan: ReturnType<typeof planWorkbookImport>, level: string) =>
  plan.problems.filter((p) => p.level === level).map((p) => p.message);

describe("planWorkbookImport", () => {
  it("plans a clean row with the workbook's numbers, documents and pricing", () => {
    const plan = planWorkbookImport(workbook(), context());
    expect(messages(plan, "error")).toEqual([]);
    expect(plan.submissions).toHaveLength(1);
    const s = plan.submissions[0]!;
    expect(s).toMatchObject({ ackNo: ACK, ackSeq: 2 });
    expect(s.data).toMatchObject({ primaryActivityCode: "MGD", status: "Received - Under Review" });
    expect(s.pricing.category).toBe("E");
    expect(s.documents.every((d) => d === "Y")).toBe(true);
    expect(plan.pricingDifferences).toEqual([]);
    expect(plan.counters.ack).toBe(2);
  });

  it("skips example rows and their payments (SPEC §8.8)", () => {
    const plan = planWorkbookImport(
      workbook({
        register: [
          register(5, { "Registered Name *": "EXAMPLE — Sample Mini-Grid Ltd (clear before use)" }),
        ],
        payments: [
          row(5, {
            "Payment Record No.": { f: "OGSERC/PAY/2026/00001" },
            "Date Received *": "2026-11-01",
            "Ack. No. or Own-Use Notification No. *": ACK,
            "Amount (₦) *": 250000,
          }),
        ],
      }),
      context(),
    );
    expect(plan.submissions).toEqual([]);
    expect(plan.payments).toEqual([]);
    expect(plan.problems.map((p) => p.level)).toEqual(["skipped", "skipped"]);
  });

  it("lists every error: required fields, list values, future dates, status consistency", () => {
    const plan = planWorkbookImport(
      workbook({
        register: [
          register(5, {
            "Principal LGA *": "Lagos Island",
            "Primary Activity *": "Space elevator",
            "Date Submitted *": "2027-01-01",
            "Operating on Effective Date? (Y/N) *": "maybe",
            "Status *": "Registered",
          }),
        ],
      }),
      context(),
    );
    expect(plan.submissions).toEqual([]);
    expect(messages(plan, "error")).toEqual([
      "Date Submitted is in the future",
      'Principal LGA "Lagos Island" is not in the app\'s list',
      'Primary Activity "Space elevator" is not in the activity list',
      "Operating on Effective Date? must be Y or N",
      "Registered but no Certificate Issue Date",
      "Registered but no registration number",
    ]);
  });

  it("keeps the issued registration number, else the workbook's generated one", () => {
    const registered = (overrides: Record<string, Value>) =>
      planWorkbookImport(
        workbook({
          register: [
            register(5, {
              "Status *": "Registered",
              "Date Submission Complete": "2026-10-22",
              "Certificate Issue Date": "2026-11-05",
              "Generated OGSERC Registration No.": { f: "OGSERC/REG/2026/E-MGD/0004" },
              ...overrides,
            }),
          ],
        }),
        context(),
      );
    expect(
      registered({ "Issued Registration No. (paste value to lock)": "OGSERC/REG/2026/E-MGD/0003" })
        .submissions[0]!.data.registrationNo,
    ).toBe("OGSERC/REG/2026/E-MGD/0003");
    const plan = registered({});
    expect(plan.submissions[0]!.data.registrationNo).toBe("OGSERC/REG/2026/E-MGD/0004");
    expect(plan.counters.registration).toEqual({ 2026: 4 });
  });

  it("refuses numbers the app already uses for something else, and skips rows already imported", () => {
    const sameName = planWorkbookImport(
      workbook(),
      context({ submissions: new Map([[ACK, { name: "registrant 5 ltd", ackSeq: 2 }]]) }),
    );
    expect(sameName.submissions).toEqual([]);
    expect(messages(sameName, "skipped")).toEqual([
      "Registrant 5 Ltd is already in the app; not changed",
    ]);

    const other = planWorkbookImport(
      workbook(),
      context({ submissions: new Map([[ACK, { name: "Someone Else Ltd", ackSeq: 2 }]]) }),
    );
    expect(messages(other, "error")).toEqual([
      'This number is already used in the app by "Someone Else Ltd"',
    ]);
    const seq = planWorkbookImport(workbook(), context({ ackSeqs: new Set([2]) }));
    expect(messages(seq, "error")).toEqual([
      "Serial 2 is already used by another acknowledgement in the app",
    ]);
  });

  it("takes pricing from the app's rules and reports where the workbook differs", () => {
    const plan = planWorkbookImport(
      workbook({
        register: [
          register(5, {
            "Registration Fee (₦)": { f: 200000 },
            "Total Due (₦)": { f: 200000 },
          }),
        ],
      }),
      context(),
    );
    expect(plan.submissions[0]!.pricing.registrationFee).toBe(nairaToKobo(250_000));
    expect(plan.pricingDifferences.map((d) => [d.item, d.workbook, d.app])).toEqual([
      ["Registration fee", nairaToKobo(200_000), nairaToKobo(250_000)],
      ["Total due", nairaToKobo(200_000), nairaToKobo(250_000)],
    ]);
  });

  it("imports typed check answers only, and matches officers by name and role", () => {
    const plan = planWorkbookImport(
      workbook({
        evaluation: [
          evaluation(5, ACK, {
            "Evaluating Officer": "blessing  ade",
            "Reviewing Supervisor": "Blessing Ade",
            "Approving Officer": "Nobody",
            "1.2 Correct form used": "Y",
            "1.1 Acknowledgement number issued": "N", // automatic: ignored
            "1.7 Multi-State licensee": { f: "N/A" }, // calculated in the workbook: ignored
            "2.1 A. Identity": "n/a",
            "2.2 B. Ownership": "maybe",
            "Final Decision": "",
          }),
        ],
      }),
      context(),
    );
    const ev = plan.submissions[0]!.evaluation;
    expect(ev.checks).toEqual({ "1.2": "Y", "2.1": "N/A" });
    expect(ev.evaluatingOfficerId).toBe("u-eval");
    expect(ev.reviewingSupervisorId).toBeNull();
    expect(messages(plan, "warning")).toEqual([
      'Reviewing supervisor "Blessing Ade" is not a user with that role; left unassigned',
      'Approving officer "Nobody" is not a user with that role; left unassigned',
      'Check 2.2: "maybe" is not Y, N or N/A; left pending',
    ]);
  });

  it("imports format problems as warnings, not errors", () => {
    const plan = planWorkbookImport(
      workbook({
        register: [register(5, { "CAC / Registration No.": "1234567899", Phone: "123" })],
      }),
      context(),
    );
    expect(plan.submissions).toHaveLength(1);
    expect(messages(plan, "warning")).toEqual([
      'CAC number "1234567899" is not RC/BN/IT + digits',
      'Phone "123" is not a Nigerian number',
    ]);
  });

  it("checks payments point at an imported record and own-use capacity", () => {
    const plan = planWorkbookImport(
      workbook({
        payments: [
          row(5, {
            "Payment Record No.": { f: "OGSERC/PAY/2026/00007" },
            "Date Received *": "2026-11-01",
            "Ack. No. or Own-Use Notification No. *": ACK,
            "Amount (₦) *": 250000,
            "Verified with bank? (Y/N)": "Y",
          }),
          row(6, {
            "Payment Record No.": { f: "OGSERC/PAY/2026/00008" },
            "Date Received *": "2026-11-01",
            "Ack. No. or Own-Use Notification No. *": "OGSERC/ACK/2026/09999",
            "Amount (₦) *": 1000,
          }),
        ],
        ownUse: [
          row(5, {
            "Notification No.": { f: "OGSERC/OUN/2026/0003" },
            "Name *": "Ifo Bottling",
            "Date Filed *": "2026-11-01",
            "LGA *": "Ifo",
            "Installed Capacity (kW) *": 650,
          }),
          row(6, {
            "Notification No.": { f: "OGSERC/OUN/2026/0004" },
            "Name *": "Big Plant",
            "Date Filed *": "2026-11-01",
            "LGA *": "Ifo",
            "Installed Capacity (kW) *": 1200,
          }),
        ],
      }),
      context(),
    );
    expect(plan.payments.map((p) => [p.paymentNo, p.amount, p.verifiedWithBank])).toEqual([
      ["OGSERC/PAY/2026/00007", nairaToKobo(250_000), true],
    ]);
    expect(plan.ownUse.map((o) => [o.ounNo, o.pricing.fee])).toEqual([
      ["OGSERC/OUN/2026/0003", ref.fees.find((f) => f.category === "I")!.registrationFee],
    ]);
    expect(messages(plan, "error")).toEqual([
      "1,000 kW or more: register as captive generation (para 3(3)(c)), not own-use",
      "Reference OGSERC/ACK/2026/09999 is not an imported Ack No. or OUN No.",
    ]);
    expect(plan.counters).toMatchObject({ oun: 3, payment: 7 });
  });

  it("keeps the workbook's audit log as marked history", () => {
    const plan = planWorkbookImport(
      workbook({
        audit: [
          row(5, {
            "Date and time": "2026-10-21 23:07",
            User: "Oluwafemi",
            Action: "Daily review",
            Detail: "Provisionally registered today: 0",
          }),
        ],
      }),
      context(),
    );
    expect(plan.audit).toEqual([
      {
        row: 5,
        action: "Workbook: Daily review",
        reference: null,
        detail: "2026-10-21 23:07 by Oluwafemi (Excel) - Provisionally registered today: 0",
      },
    ]);
  });
});
