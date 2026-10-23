import { formatNaira } from "@/domain/money";
import { formatPaymentNo } from "@/domain/numbers";
import { can } from "@/domain/roles";
import { paymentSchema, reasonSchema as reverseSchema } from "@/lib/schemas";
import { writeAudit } from "./audit";
import { loadContext } from "./context";
import { COUNTER, nextCounter } from "./counters";
import {
  ConfirmationRequiredError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { fromIsoDate, koboToNumber, loadList } from "./reference-data";
import type { Actor, Db } from "./types";

export const CONFIRM_DUPLICATE_RRR = "confirmDuplicateRrr";

/**
 * §4.2 Record payment. The reference must be an existing Ack No. or OUN No.; a duplicate RRR needs
 * confirmation.
 */
export async function recordPayment(
  db: Db,
  actor: Actor,
  input: unknown,
  opts: { confirmDuplicateRrr?: boolean } = {},
) {
  if (!can(actor.roles, "payment.record")) throw new ForbiddenError();
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const v = parsed.data;

  return db.$transaction(async (tx) => {
    const ctx = await loadContext(tx);
    const errors: Record<string, string[]> = {};
    const [submission, ownUse, purposes, channels] = await Promise.all([
      tx.submission.findUnique({ where: { ackNo: v.reference }, select: { id: true } }),
      tx.ownUseNotification.findUnique({ where: { ounNo: v.reference }, select: { id: true } }),
      loadList(tx, "payment_purposes"),
      loadList(tx, "payment_channels"),
    ]);
    if (!submission && !ownUse) {
      errors.reference = ["No submission or own-use notification has this Ack No. / OUN No."];
    }
    if (v.dateReceived > ctx.today) errors.dateReceived = ["Cannot be in the future"];
    if (v.purpose && !purposes.includes(v.purpose)) errors.purpose = ["Choose from the list"];
    if (v.channel && !channels.includes(v.channel)) errors.channel = ["Choose from the list"];
    if (Object.keys(errors).length) {
      throw new ValidationError("Please correct the highlighted fields.", errors);
    }

    let duplicate = false;
    if (v.rrr) {
      const other = await tx.payment.findFirst({
        where: { rrr: { equals: v.rrr, mode: "insensitive" }, status: "ACTIVE" },
        select: { paymentNo: true, reference: true },
      });
      if (other && !opts.confirmDuplicateRrr) {
        throw new ConfirmationRequiredError(
          CONFIRM_DUPLICATE_RRR,
          `RRR / bank reference ${v.rrr} is already recorded on ${other.paymentNo} (${other.reference}). Record it again?`,
        );
      }
      duplicate = !!other;
    }

    const seq = await nextCounter(tx, COUNTER.PAYMENT);
    const payment = await tx.payment.create({
      data: {
        paymentSeq: seq,
        paymentNo: formatPaymentNo(ctx.settings.paymentPrefix, v.dateReceived, seq),
        dateReceived: fromIsoDate(v.dateReceived),
        reference: v.reference,
        submissionId: submission?.id ?? null,
        ownUseNotificationId: submission ? null : (ownUse?.id ?? null),
        purpose: v.purpose,
        channel: v.channel,
        amount: BigInt(v.amount),
        rrr: v.rrr,
        recordedById: actor.id,
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Payment recorded",
      reference: v.reference,
      detail:
        `${formatNaira(v.amount)} - ref ${v.rrr ?? "(none)"} - ${payment.paymentNo}` +
        (duplicate ? "; duplicate RRR confirmed" : ""),
    });
    return payment;
  });
}

/**
 * Finance or Admin: reverse a payment recorded in error, including a confirmed one (§4.12). The row
 * stays (visible, marked reversed, with who, when and why) and stops counting towards totals. A
 * reversal is final.
 */
export async function reversePayment(db: Db, actor: Actor, paymentId: string, input: unknown) {
  if (!can(actor.roles, "payment.reverse")) throw new ForbiddenError();
  const parsed = reverseSchema.safeParse(input);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);

  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundError("Payment not found.");
    if (payment.status === "REVERSED")
      throw new ValidationError("This payment is already reversed.");
    if (payment.financeStatus === "REJECTED")
      throw new ValidationError("A rejected payment never counted; there is nothing to reverse.");

    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: "REVERSED",
        reversalReason: parsed.data.reason,
        reversedById: actor.id,
        reversedAt: new Date(),
      },
    });
    await writeAudit(tx, {
      userId: actor.id,
      action: "Payment reversed",
      reference: payment.reference,
      detail: `${payment.paymentNo} ${formatNaira(koboToNumber(payment.amount))}. Reason: ${parsed.data.reason}`,
    });
    return updated;
  });
}
