-- Finance confirmation gate, part 2 of 3: payment Finance status, release date, settings, DB rules.
-- Existing payments become PENDING (column default); existing records are moved in part 3.

-- CreateEnum
CREATE TYPE "PaymentFinanceStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "financeDecidedAt" TIMESTAMP(3),
ADD COLUMN     "financeDecidedById" TEXT,
ADD COLUMN     "financeRemarks" TEXT,
ADD COLUMN     "financeStatus" "PaymentFinanceStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "lateChargeRequiredForRelease" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unpaidReminderDays" INTEGER;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "releasedForEvaluationDate" DATE,
ALTER COLUMN "status" SET DEFAULT 'Acknowledged - Awaiting Payment';

-- CreateIndex
CREATE INDEX "Payment_financeStatus_idx" ON "Payment"("financeStatus");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_financeDecidedById_fkey" FOREIGN KEY ("financeDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A Finance decision records who and when; a rejection needs its reason. The user who recorded a
-- payment can never be the one who confirms it.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_finance_fields" CHECK (
  ("financeStatus" = 'PENDING' AND "financeDecidedById" IS NULL AND "financeDecidedAt" IS NULL)
  OR
  ("financeStatus" IN ('CONFIRMED', 'REJECTED') AND "financeDecidedById" IS NOT NULL
     AND "financeDecidedAt" IS NOT NULL
     AND ("financeStatus" <> 'REJECTED' OR btrim(coalesce("financeRemarks", '')) <> ''))
);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_confirmer_not_recorder" CHECK (
  "financeStatus" <> 'CONFIRMED' OR "financeDecidedById" <> "recordedById"
);

ALTER TABLE "Settings" ADD CONSTRAINT "Settings_unpaid_reminder_days" CHECK (
  "unpaidReminderDays" IS NULL OR "unpaidReminderDays" BETWEEN 1 AND 3650
);

-- Payments: what was received is never edited; a reversal is final; a Finance decision is made once
-- (Pending → Confirmed or Rejected) and is final; a reversed payment cannot be confirmed.
CREATE OR REPLACE FUNCTION ogserc_payment_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."paymentSeq" IS DISTINCT FROM OLD."paymentSeq"
     OR NEW."paymentNo" IS DISTINCT FROM OLD."paymentNo"
     OR NEW."dateReceived" IS DISTINCT FROM OLD."dateReceived"
     OR NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."submissionId" IS DISTINCT FROM OLD."submissionId"
     OR NEW."ownUseNotificationId" IS DISTINCT FROM OLD."ownUseNotificationId"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."recordedById" IS DISTINCT FROM OLD."recordedById"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Payment % cannot be edited; reverse it and record a new payment', OLD."paymentNo";
  END IF;
  IF OLD."status" = 'REVERSED' AND (
       NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."reversalReason" IS DISTINCT FROM OLD."reversalReason"
       OR NEW."reversedById" IS DISTINCT FROM OLD."reversedById"
       OR NEW."reversedAt" IS DISTINCT FROM OLD."reversedAt") THEN
    RAISE EXCEPTION 'Payment % is reversed; a reversal is final', OLD."paymentNo";
  END IF;
  IF OLD."financeStatus" <> 'PENDING' AND (
       NEW."financeStatus" IS DISTINCT FROM OLD."financeStatus"
       OR NEW."financeDecidedById" IS DISTINCT FROM OLD."financeDecidedById"
       OR NEW."financeDecidedAt" IS DISTINCT FROM OLD."financeDecidedAt"
       OR NEW."financeRemarks" IS DISTINCT FROM OLD."financeRemarks") THEN
    RAISE EXCEPTION 'The Finance decision on payment % is final', OLD."paymentNo";
  END IF;
  IF OLD."status" = 'REVERSED' AND NEW."financeStatus" IS DISTINCT FROM OLD."financeStatus" THEN
    RAISE EXCEPTION 'Payment % is reversed and cannot be confirmed or rejected', OLD."paymentNo";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Submissions start as "Acknowledged - Awaiting Payment"; the release date is a workflow field.
CREATE OR REPLACE FUNCTION ogserc_workflow_fields_locked() RETURNS trigger AS $$
DECLARE
  allowed boolean := coalesce(current_setting('ogserc.workflow', true), '') = 'on';
BEGIN
  IF allowed THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'Acknowledged - Awaiting Payment'
       OR NEW."releasedForEvaluationDate" IS NOT NULL
       OR NEW."dateSubmissionComplete" IS NOT NULL
       OR NEW."deficiencyNoticeDate" IS NOT NULL
       OR NEW."showCauseDate" IS NOT NULL
       OR NEW."certificateIssueDate" IS NOT NULL
       OR NEW."registrationNo" IS NOT NULL THEN
      RAISE EXCEPTION 'A new submission starts as Acknowledged - Awaiting Payment; workflow fields are set by workflow actions';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status"
     OR NEW."releasedForEvaluationDate" IS DISTINCT FROM OLD."releasedForEvaluationDate"
     OR NEW."dateSubmissionComplete" IS DISTINCT FROM OLD."dateSubmissionComplete"
     OR NEW."deficiencyNoticeDate" IS DISTINCT FROM OLD."deficiencyNoticeDate"
     OR NEW."showCauseDate" IS DISTINCT FROM OLD."showCauseDate"
     OR NEW."certificateIssueDate" IS DISTINCT FROM OLD."certificateIssueDate"
     OR NEW."registrationNo" IS DISTINCT FROM OLD."registrationNo" THEN
    RAISE EXCEPTION 'Status and workflow dates of % change only through workflow actions', OLD."ackNo";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
