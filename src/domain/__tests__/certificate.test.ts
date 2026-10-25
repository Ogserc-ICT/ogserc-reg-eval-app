import { describe, expect, it } from "vitest";
import {
  certificateBlockers,
  certificateFields,
  countInWords,
  licenceText,
  numberInWords,
  serviceAreaText,
} from "../certificate";
import { assessSubmission } from "../submission";
import { LICENCE, STATUS } from "../types";
import { activity, ctx, licence, makeSubmission, readySettings, settings } from "./helpers";

const registered = (o: Parameters<typeof makeSubmission>[0] = {}) =>
  makeSubmission({
    status: STATUS.REGISTERED,
    registrationNo: "OGSERC/REG/2026/F-MSL/0001",
    certificateIssueDate: "2026-10-22",
    primaryActivity: activity("MSL"),
    licenceStatus: LICENCE.MULTI_STATE,
    licences: [licence("NERC/MS/7")],
    ...o,
  });

describe("CERT-01 fields (SPEC §7)", () => {
  it("maps every field", () => {
    const sub = registered({
      registeredName: "Mighty Power Ltd",
      cacNo: "RC123456",
      address: "1 Power Road, Sagamu",
      otherActivities: [activity("TRD")],
      principalLga: "Sagamu",
      otherAreasServed: "Remo North; Ikenne",
    });
    const fields = certificateFields(sub, assessSubmission(sub, [], ctx()), readySettings);
    expect(fields).toEqual({
      SERIAL: "0001",
      REG_NO: "OGSERC/REG/2026/F-MSL/0001",
      NAME: "MIGHTY POWER LTD",
      CAC: "RC123456",
      ADDRESS: "1 Power Road, Sagamu",
      CATEGORY:
        "F — Distribution licensees other than successor distribution companies; trading and bulk supply",
      ACTIVITY: "Multi-State licensee – non-successor (Ogun operations)",
      OTHER: "Trading / bulk supply",
      AREA: "Sagamu; Remo North; Ikenne",
      LICENCE: "NERC licence (multi-State), No. NERC/MS/7",
      DAY: "22nd",
      MONTH: "October",
      YEAR: "2026",
      CHAIR_NAME: "A. Chairman",
      COMM_NAME: "B. Commissioner",
    });
  });

  it("uses the defaults for missing values", () => {
    const sub = registered({
      cacNo: null,
      address: null,
      otherActivities: [],
      otherAreasServed: null,
    });
    const f = certificateFields(sub, assessSubmission(sub, [], ctx()), readySettings);
    expect(f).toMatchObject({ CAC: "N/A", ADDRESS: "—", OTHER: "None", AREA: "Abeokuta South" });
  });

  it("words the licence line, with every licence number in the table", () => {
    expect(licenceText(LICENCE.UNLICENSED, [])).toBe("None — application pending");
    expect(licenceText(null, [])).toBe("None — application pending");
    expect(licenceText("OGSERC licence/permit", [])).toBe("OGSERC licence/permit");
    expect(licenceText("OGSERC licence/permit", [licence(null)])).toBe("OGSERC licence/permit");
    expect(licenceText("OGSERC licence/permit", [licence(" L-9 ")])).toBe(
      "OGSERC licence/permit, No. L-9",
    );
    expect(licenceText("OGSERC licence/permit", [licence("L-9"), licence("NERC/2")])).toBe(
      "OGSERC licence/permit, No. L-9, NERC/2",
    );
  });

  it("lists every other activity, and the LGAs served after the principal LGA", () => {
    const sub = registered({
      otherActivities: [activity("TRD"), activity("MET")],
      principalLga: "Sagamu",
      lgasServed: ["Ikenne", "Sagamu", "Remo North"],
      otherAreasServed: "Ogere estate",
    });
    const f = certificateFields(sub, assessSubmission(sub, [], ctx()), readySettings);
    expect(f.OTHER).toBe("Trading / bulk supply; Metering services");
    expect(f.AREA).toBe("Sagamu, Ikenne, Remo North; Ogere estate");
    expect(serviceAreaText({ principalLga: "Ifo", lgasServed: [], otherAreasServed: null })).toBe(
      "Ifo",
    );
  });

  it("is blocked while a signatory is '[Name]' or the record is not registered", () => {
    const sub = registered();
    expect(certificateBlockers(sub, assessSubmission(sub, [], ctx()), readySettings)).toEqual([]);
    expect(certificateBlockers(sub, assessSubmission(sub, [], ctx()), settings)).toEqual([
      "Certificate signatory names are not set in Settings",
    ]);
    const open = makeSubmission();
    expect(certificateBlockers(open, assessSubmission(open, [], ctx()), readySettings)).toEqual([
      "Status is Received - Under Review, not Registered",
      "No locked registration number",
      "No certificate issue date",
    ]);
  });
});

describe("numbers in words", () => {
  it.each([
    [0, "zero"],
    [14, "fourteen"],
    [30, "thirty"],
    [48, "forty-eight"],
    [90, "ninety"],
    [183, "one hundred and eighty-three"],
  ])("%d → %s", (n, words) => expect(numberInWords(n)).toBe(words));

  it("writes the legal form", () => expect(countInWords(30)).toBe("thirty (30)"));
});
