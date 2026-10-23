import { formatDate } from "@/domain/dates";
import { formatNaira } from "@/domain/money";
import type { IsoDate, Kobo } from "@/domain/types";
import { COLOURS, FlowDocument } from "./layout";

/** Merge data for the Notice of Deficiency (TEMPLATES.md §2, para 13(1)(b)). */
export interface DeficiencyContent {
  noticeRef: string;
  noticeDate: IsoDate;
  responseDue: IsoDate;
  ackNo: string;
  dateSubmitted: IsoDate;
  registeredName: string;
  address: string | null;
  complianceOfficer: string | null;
  categoryApplied: string;
  outstandingList: string[];
  /** New (TEMPLATES.md): failed evaluation checks and the evaluator's remarks. */
  failedChecks: { id: string; text: string }[];
  evaluatorRemarks: string | null;
  totalDue: Kobo;
  amountPaid: Kobo;
  balance: Kobo;
  /** A preview made before the notice is issued (SPEC §8.10): watermarked, never stored. */
  draft: boolean;
}

const or = (v: string | null | undefined) => (v && v.trim() ? v : "—");

export async function deficiencyPdf(c: DeficiencyContent): Promise<Uint8Array> {
  const pdf = await FlowDocument.create({
    title: `Notice of Deficiency ${c.noticeRef}`,
    subject: "Notice under paragraph 13(1)(b), Order No. OGSERC/ORD/2026/001",
    footerRef: c.noticeRef,
    draft: c.draft,
  });

  pdf.text("NOTICE OF DEFICIENCY", { size: 13, font: "bold", colour: COLOURS.green, after: 10 });
  pdf.table(
    [
      ["Our ref.", c.noticeRef],
      ["Date of notice", formatDate(c.noticeDate)],
      ["To", c.registeredName],
      ["Address", or(c.address)],
      ["Attention", or(c.complianceOfficer)],
    ],
    { labelWidth: 90, zebra: false },
  );
  pdf.text(`RE: NOTICE OF DEFICIENCY IN REGISTRATION SUBMISSION — ${c.ackNo}`, {
    font: "bold",
    after: 8,
  });
  pdf.text(
    `The Commission acknowledges receipt of your submission dated ${formatDate(c.dateSubmitted)} for registration under Order No. OGSERC/ORD/2026/001 (Category ${c.categoryApplied}). On review, the submission is incomplete for the reasons set out below.`,
    { after: 10 },
  );

  pdf.heading("Outstanding documents (Schedule 2)");
  if (c.outstandingList.length) pdf.list(c.outstandingList, { marker: () => "•" });
  else pdf.text("None", { after: 8 });

  if (c.failedChecks.length || c.evaluatorRemarks) {
    pdf.heading("Other deficiencies found in evaluation");
    if (c.failedChecks.length)
      pdf.list(
        c.failedChecks.map((f) => `${f.text} (check ${f.id})`),
        { marker: () => "•" },
      );
    if (c.evaluatorRemarks) pdf.text(`Evaluator's remarks: ${c.evaluatorRemarks}`, { after: 8 });
  }

  pdf.heading("Fees and charges");
  pdf.text(
    `Total due ${formatNaira(c.totalDue)}; paid ${formatNaira(c.amountPaid)}; balance ${formatNaira(Math.max(0, c.balance))}`,
    { after: 10 },
  );

  pdf.text(
    `Under paragraph 13(1)(b) of the Order, you are required to supply the outstanding information and payment by ${formatDate(c.responseDue)}. If they are not received by that date, your submission will lapse and you will be treated as not registered (paragraph 13(2)), without prejudice to your right to submit a fresh application.`,
    { font: "bold", after: 8 },
  );
  pdf.text("Please quote the acknowledgement number above in all correspondence.", { after: 6 });
  pdf.signature("", ["For: Ogun State Electricity Regulatory Commission"]);
  return pdf.save();
}
