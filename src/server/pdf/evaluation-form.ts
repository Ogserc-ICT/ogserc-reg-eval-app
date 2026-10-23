import { formatDate } from "@/domain/dates";
import type { CheckValue, IsoDate } from "@/domain/types";
import { COLOURS, FlowDocument, wrap } from "./layout";

/** Merge data for the internal evaluation form (TEMPLATES.md §4). */
export interface EvaluationFormContent {
  ackNo: string;
  registeredName: string;
  categoryActivity: string;
  evaluatingOfficer: string | null;
  reviewingSupervisor: string | null;
  approvingOfficer: string | null;
  dateEvaluationStarted: IsoDate | null;
  checks: {
    id: string;
    stage: string;
    text: string;
    value: CheckValue;
    automatic: boolean;
    postApproval: boolean;
  }[];
  counts: { satisfied: number; failed: number; na: number; pending: number };
  recommended: string;
  finalDecision: string | null;
  reasons: string | null;
  remarks: string | null;
  registrationNo: string | null;
  printedOn: IsoDate;
}

const or = (v: string | null | undefined) => (v && v.trim() ? v : "—");

export async function evaluationFormPdf(c: EvaluationFormContent): Promise<Uint8Array> {
  const pdf = await FlowDocument.create({
    title: `Evaluation Form EVAL-01 ${c.ackNo}`,
    subject: "Internal evaluation of a registration submission",
    footerRef: `EVAL-01 · ${c.ackNo} · printed ${formatDate(c.printedOn)}`,
  });

  pdf.text("REGISTRATION EVALUATION FORM (OGSERC/EVAL-01) — INTERNAL", {
    size: 12,
    font: "bold",
    colour: COLOURS.green,
    after: 8,
  });
  pdf.table([
    ["Acknowledgement No.", c.ackNo],
    ["Registrant", c.registeredName],
    ["Category / activity", c.categoryActivity],
    ["Evaluating officer", or(c.evaluatingOfficer)],
    ["Reviewing supervisor", or(c.reviewingSupervisor)],
    ["Approving officer", or(c.approvingOfficer)],
    [
      "Date evaluation started",
      c.dateEvaluationStarted ? formatDate(c.dateEvaluationStarted) : "—",
    ],
  ]);

  const size = 8.5;
  const lh = size * 1.3;
  const textWidth = pdf.width - 36 - 60;
  const drawStage = (stage: string, rows: EvaluationFormContent["checks"]) => {
    pdf.heading(stage, { size: 9.5, after: 2 });
    for (const row of rows) {
      const lines = wrap(row.text, pdf.fonts.regular, size, textWidth);
      const height = lines.length * lh + 4;
      pdf.ensure(height);
      const top = pdf.y;
      pdf.page.drawText(row.id, {
        x: pdf.margin.left,
        y: top - size - 2,
        size,
        font: pdf.fonts.bold,
        color: COLOURS.green,
      });
      lines.forEach((l, i) =>
        pdf.page.drawText(l, {
          x: pdf.margin.left + 36,
          y: top - size - 2 - i * lh,
          size,
          font: pdf.fonts.regular,
        }),
      );
      const value = `${row.value ?? "pending"}${row.automatic ? " (auto)" : ""}`;
      pdf.page.drawText(value, {
        x: pdf.margin.left + pdf.width - 58,
        y: top - size - 2,
        size,
        font: row.value === "N" ? pdf.fonts.bold : pdf.fonts.regular,
        color: row.value === "N" ? COLOURS.black : COLOURS.grey,
      });
      pdf.y -= height;
      pdf.page.drawLine({
        start: { x: pdf.margin.left, y: pdf.y + 1 },
        end: { x: pdf.margin.left + pdf.width, y: pdf.y + 1 },
        thickness: 0.3,
        color: COLOURS.rule,
      });
    }
    pdf.space(6);
  };

  const decision = c.checks.filter((r) => !r.postApproval);
  for (const stage of [...new Set(decision.map((r) => r.stage))]) {
    drawStage(
      stage,
      decision.filter((r) => r.stage === stage),
    );
  }

  pdf.heading("RESULT AND DECISION");
  pdf.table([
    [
      "Checks satisfied / failed / N/A / pending",
      `${c.counts.satisfied} / ${c.counts.failed} / ${c.counts.na} / ${c.counts.pending}`,
    ],
    ["Recommended outcome (automatic)", c.recommended],
    ["Final decision", or(c.finalDecision)],
    ["Reasons / comments", or([c.reasons, c.remarks].filter(Boolean).join(" — "))],
    ["Registration No.", or(c.registrationNo)],
  ]);
  for (const [role, name] of [
    ["Evaluating officer", c.evaluatingOfficer],
    ["Reviewing supervisor", c.reviewingSupervisor],
    ["Approving officer", c.approvingOfficer],
  ] as const) {
    pdf.signature(or(name), [`${role} — signature / date`], { width: 220 });
  }

  const post = c.checks.filter((r) => r.postApproval);
  if (post.length) drawStage("POST-APPROVAL ACTIONS", post);
  return pdf.save();
}
