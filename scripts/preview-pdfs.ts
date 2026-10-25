// Render sample documents to PNG for visual review:  npx tsx scripts/preview-pdfs.ts <outDir>
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { acknowledgementPdf } from "../src/server/pdf/acknowledgement";
import { certificatePdf } from "../src/server/pdf/certificate";
import { deficiencyPdf } from "../src/server/pdf/deficiency";
import { evaluationFormPdf } from "../src/server/pdf/evaluation-form";
import forms from "../registration-forms.json";
import seed from "../seed-data.json";

/** The REG-01E (mini-grid) checklist texts, for sample letters. */
const e = forms.forms.find((f) => f.form === "REG-01E")!.documents.map((d) => d.text);
import { pdfPageCount, renderPage } from "../tests/support/pdf";

const naira = (n: number) => n * 100;

async function main() {
  const out = process.argv[2] ?? "pdf-preview";
  await mkdir(out, { recursive: true });
  const save = async (name: string, bytes: Uint8Array) => {
    await writeFile(path.join(out, `${name}.pdf`), bytes);
    const pages = await pdfPageCount(bytes);
    for (let p = 1; p <= pages; p++) {
      await writeFile(path.join(out, `${name}-p${p}.png`), await renderPage(bytes, p, 1.4));
    }
    console.log(`${name}: ${pages} page(s), ${bytes.length} bytes`);
  };

  await save(
    "certificate",
    await certificatePdf({
      SERIAL: "0001",
      REG_NO: "OGSERC/REG/2026/F-MSL/0001",
      NAME: "MIGHTY POWER DISTRIBUTION AND TRADING COMPANY OF NIGERIA LIMITED",
      CAC: "RC1234567",
      ADDRESS: "Plot 14, Industrial Estate Road, Off Lagos–Abeokuta Expressway, Ota, Ogun State",
      CATEGORY:
        "F — Distribution licensees other than successor distribution companies; trading and bulk supply",
      ACTIVITY: "Multi-State licensee – non-successor (Ogun operations)",
      OTHER: "Trading / bulk supply",
      AREA: "Ado-Odo/Ota; Ifo; Ewekoro; Agbara industrial estate feeders 1–4",
      LICENCE: "NERC licence (multi-State), No. NERC/LIC/DIS/2019/044",
      DAY: "22nd",
      MONTH: "October",
      YEAR: "2026",
      CHAIR_NAME: "Engr. Adebayo O. Ogunleye",
      COMM_NAME: "Barr. Funmilayo K. Adeyemi",
      reissuedOn: null,
      verifyUrl: "https://registration.ogserc.gov.ng/verify/cm0example000000000000000",
    }),
  );

  await save(
    "acknowledgement",
    await acknowledgementPdf({
      ackNo: "OGSERC/ACK/2026/00001",
      dateSubmitted: "2026-10-22",
      registeredName: "Ogun Sunrise Mini-Grid Ltd",
      address: "1 Example Road, Abeokuta",
      complianceOfficer: "Jane Doe",
      submissionChannel: "By hand",
      formFiled: "REG-01E",
      filing: { label: "New registration", linked: false, linkedRegistrationNo: null },
      primaryActivity: "Mini-grid / interconnected mini-grid",
      otherActivities: [],
      installedCapacityMw: 2.5,
      categoryApplied: "E",
      categoryDescription: "Mini-grids and interconnected mini-grids",
      fee: naira(250_000),
      amountPaid: naira(100_000),
      balance: naira(150_000),
      daysLate: 0,
      lateCharge: 0,
      receivedList: e.slice(0, 9),
      outstandingList: e.slice(9),
      unlicensed: true,
      licenceApplicationDue: "2027-01-20",
      determinationDays: 30,
      deficiencyDays: 14,
      signatoryName: "Evan Evaluator",
    }),
  );

  await save(
    "deficiency-draft",
    await deficiencyPdf({
      noticeRef: "OGSERC/DEF/2026/00001",
      noticeDate: "2026-10-22",
      responseDue: "2026-11-05",
      ackNo: "OGSERC/ACK/2026/00001",
      dateSubmitted: "2026-10-01",
      registeredName: "Ogun Sunrise Mini-Grid Ltd",
      address: null,
      complianceOfficer: null,
      categoryApplied: "E",
      outstandingList: e.slice(3, 6),
      failedChecks: [
        { id: "2.2", text: seed.evaluation_checks[10]!.text },
        { id: "4.5", text: seed.evaluation_checks.find((c) => c.id === "4.5")!.text },
      ],
      evaluatorRemarks: "Shareholding schedule does not match the CAC status report.",
      totalDue: naira(250_000),
      amountPaid: naira(100_000),
      balance: naira(150_000),
      draft: true,
    }),
  );

  await save(
    "evaluation-form",
    await evaluationFormPdf({
      ackNo: "OGSERC/ACK/2026/00001",
      registeredName: "Ogun Sunrise Mini-Grid Ltd",
      categoryActivity: "E — Mini-grid / interconnected mini-grid",
      evaluatingOfficer: "Evan Evaluator",
      reviewingSupervisor: "Sade Supervisor",
      approvingOfficer: "Ade Approver",
      dateEvaluationStarted: "2026-10-22",
      checks: seed.evaluation_checks.map((c, i) => ({
        ...c,
        value: c.id.startsWith("9.") ? null : i % 11 === 3 ? "N/A" : "Y",
        automatic: ["1.1", "1.3", "1.4", "3.0", "5.5"].includes(c.id),
        postApproval: c.id.startsWith("9."),
      })),
      counts: { satisfied: 50, failed: 0, na: 5, pending: 0 },
      recommended: "Register (13(1)(a))",
      finalDecision: null,
      reasons: null,
      remarks: "All documents verified against originals.",
      registrationNo: null,
      printedOn: "2026-10-23",
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
