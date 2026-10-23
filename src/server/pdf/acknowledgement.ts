import { countInWords } from "@/domain/certificate";
import { formatDate } from "@/domain/dates";
import { formatNaira } from "@/domain/money";
import type { IsoDate, Kobo } from "@/domain/types";
import { COLOURS, FlowDocument } from "./layout";

/** Merge data for the acknowledgement letter (TEMPLATES.md §1, para 10(3)). */
export interface AcknowledgementContent {
  ackNo: string;
  dateSubmitted: IsoDate;
  registeredName: string;
  address: string | null;
  complianceOfficer: string | null;
  submissionChannel: string | null;
  primaryActivity: string;
  secondaryActivity: string | null;
  installedCapacityMw: number | null;
  categoryApplied: string;
  categoryDescription: string;
  fee: Kobo;
  amountPaid: Kobo;
  balance: Kobo;
  daysLate: number;
  lateCharge: Kobo;
  receivedList: string[];
  outstandingList: string[];
  unlicensed: boolean;
  licenceApplicationDue: IsoDate | null;
  determinationDays: number;
  deficiencyDays: number;
  signatoryName: string;
}

const or = (v: string | null | undefined) => (v && v.trim() ? v : "—");

/** "by hand", "by email", "through the online portal" (TEMPLATES.md: "{{date}} by {{channel}}"). */
function channelPhrase(channel: string | null): string {
  if (!channel) return "";
  const lower = channel.trim().toLowerCase();
  if (lower.startsWith("by ")) return ` ${lower}`;
  if (lower.includes("portal")) return " through the online portal";
  return ` by ${lower}`;
}

export async function acknowledgementPdf(c: AcknowledgementContent): Promise<Uint8Array> {
  const pdf = await FlowDocument.create({
    title: `Acknowledgement of Registration Submission ${c.ackNo}`,
    subject: "Acknowledgement under paragraph 10(3), Order No. OGSERC/ORD/2026/001",
    footerRef: c.ackNo,
  });

  pdf.text("ACKNOWLEDGEMENT OF REGISTRATION SUBMISSION", {
    size: 13,
    font: "bold",
    colour: COLOURS.green,
    after: 10,
  });
  pdf.table(
    [
      ["Our ref.", c.ackNo],
      ["Date", formatDate(c.dateSubmitted)],
      ["To", c.registeredName],
      ["Address", or(c.address)],
      ["Attention", or(c.complianceOfficer)],
    ],
    { labelWidth: 90, zebra: false },
  );
  pdf.text(`RE: ACKNOWLEDGEMENT OF REGISTRATION SUBMISSION — ${c.ackNo}`, {
    font: "bold",
    after: 8,
  });
  pdf.text(
    "The Ogun State Electricity Regulatory Commission acknowledges receipt of your submission for registration under Order No. OGSERC/ORD/2026/001. This acknowledgement is issued under paragraph 10(3) of the Order. Your submission has been entered in the Register under the acknowledgement number above. Please quote it in all correspondence and as the reference for any payment.",
    { after: 10 },
  );

  pdf.heading("1. Your submission");
  pdf.table(
    [
      [
        "Date received (para 10(3))",
        `${formatDate(c.dateSubmitted)}${channelPhrase(c.submissionChannel)}`,
      ],
      [
        "Activities declared",
        c.secondaryActivity ? `${c.primaryActivity}; ${c.secondaryActivity}` : c.primaryActivity,
      ],
      [
        "Installed capacity",
        c.installedCapacityMw === null ? "—" : `${c.installedCapacityMw.toFixed(2)} MW`,
      ],
      [
        "Schedule 3 category (provisional)",
        `Category ${c.categoryApplied} — ${c.categoryDescription} (subject to evaluation)`,
      ],
      ["Registration fee for the category", formatNaira(c.fee)],
      [
        "Payment received to date",
        `${formatNaira(c.amountPaid)}; balance ${formatNaira(Math.max(0, c.balance))}`,
      ],
      [
        "Filed within the Registration Period?",
        c.daysLate === 0
          ? "Yes"
          : `No — ${c.daysLate} days late; late charge ${formatNaira(c.lateCharge)}`,
      ],
    ],
    { labelWidth: 170 },
  );

  pdf.heading("2. Documents received (Schedule 2) — a record of receipt, not yet evaluated");
  pdf.text(`Received: ${c.receivedList.length ? c.receivedList.join("; ") : "none"}`, { after: 6 });
  // TEMPLATES.md: when nothing is pending, print "Pending: none." only.
  pdf.text(
    c.outstandingList.length
      ? `Pending: ${c.outstandingList.join("; ")} — please supply these, or state the reason and propose a completion date (para 12(4)).`
      : "Pending: none.",
    { after: 10 },
  );

  const det = countInWords(c.determinationDays);
  const def = countInWords(c.deficiencyDays);
  pdf.heading("3. What happens next");
  pdf.list([
    "Evaluation. The Commission will now evaluate your submission. It is complete when it includes the information and documents required by paragraph 12 and evidence of payment of the registration fee (paragraph 13(1)).",
    `Decision within ${c.determinationDays} days. Within ${det} days of receiving a complete submission, the Commission will either issue a Registration Certificate bearing a unique OGSERC registration number (paragraph 13(1)(a)) or notify you in writing of any missing or deficient information (paragraph 13(1)(b)).`,
    `Deficiency notice. If you receive one, you must supply the information within ${def} days, or your submission will lapse and you will be treated as not registered (paragraph 13(2)).`,
    `Provisional registration. If the Commission has not acted within ${det} days of receiving your complete submission, you are provisionally registered from the next day, and the acknowledgement number above serves as your registration number (paragraph 13(4)).`,
    "Verification. Authorized officers may inspect your installations, meters and records on not less than forty-eight (48) hours' notice (paragraph 22).",
    "Refusal only on stated grounds, after written reasons and fourteen (14) days to respond (paragraphs 13(3) and 20).",
  ]);

  pdf.heading("4. Your obligations in the meantime");
  const obligations = [
    "Registration is not a licence and does not authorize any activity that requires one (paragraph 11(3)).",
    "Notify the Commission in writing within fourteen (14) days of any material change in the information submitted (paragraph 16(1)).",
    "Information claimed as commercially sensitive is treated as confidential until the Commission decides the claim (paragraph 15(3)); personal data is processed under the Nigeria Data Protection Act, 2023 (paragraph 15(4)).",
  ];
  if (c.unlicensed) {
    obligations.push(
      `As you are not licensed, you must apply for the appropriate licence or permit by ${c.licenceApplicationDue ? formatDate(c.licenceApplicationDue) : "the date set by the Commission"}. Until it is decided, maintain safe and continuous supply, connect no new customers and extend no network without written approval, and charge no tariff above that in force on the Effective Date (paragraph 18).`,
    );
  }
  pdf.list(obligations, { marker: (i) => `(${String.fromCharCode(97 + i)})` });

  pdf.text("This acknowledgement is not a Registration Certificate.", { font: "bold", after: 10 });
  pdf.text("Yours faithfully,");
  pdf.signature(c.signatoryName, ["For: Ogun State Electricity Regulatory Commission"]);
  return pdf.save();
}
