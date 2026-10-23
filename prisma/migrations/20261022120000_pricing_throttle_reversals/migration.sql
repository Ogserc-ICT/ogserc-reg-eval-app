-- Session tokens are now stored hashed; existing plaintext sessions cannot be converted, so everyone signs in again.
DELETE FROM "Session";

-- DropIndex
DROP INDEX "Session_sessionToken_key";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedById" TEXT;

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "sessionToken",
ADD COLUMN     "tokenHash" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "pricedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "pricedCategory" TEXT NOT NULL,
ADD COLUMN     "pricedDeadline" DATE,
ADD COLUMN     "pricedEffectiveDate" DATE NOT NULL,
ADD COLUMN     "pricedLateDaily" BIGINT NOT NULL,
ADD COLUMN     "pricedLateDailyCap" BIGINT NOT NULL,
ADD COLUMN     "pricedLateInitial" BIGINT NOT NULL,
ADD COLUMN     "pricedRegistrationFee" BIGINT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastFailedLoginAt" TIMESTAMP(3),
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" BIGSERIAL NOT NULL,
    "ip" TEXT NOT NULL,
    "email" TEXT,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Payment reversals: a reason, who and when are required; the original row stays.
-- ---------------------------------------------------------------------------
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversal_fields" CHECK (
  ("status" = 'ACTIVE' AND "reversalReason" IS NULL AND "reversedById" IS NULL AND "reversedAt" IS NULL)
  OR
  ("status" = 'REVERSED' AND btrim(coalesce("reversalReason", '')) <> '' AND "reversedById" IS NOT NULL AND "reversedAt" IS NOT NULL)
);

-- What was received is never edited; a reversal is final.
CREATE FUNCTION ogserc_payment_immutable() RETURNS trigger AS $$
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Payment_immutable" BEFORE UPDATE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION ogserc_payment_immutable();

-- ---------------------------------------------------------------------------
-- Pricing snapshot: changes only inside an admin recalculation, which sets
-- `SET LOCAL ogserc.reprice = 'on'` in its transaction (src/server/pricing.ts).
-- ---------------------------------------------------------------------------
CREATE FUNCTION ogserc_pricing_snapshot_locked() RETURNS trigger AS $$
BEGIN
  IF (NEW."pricedCategory" IS DISTINCT FROM OLD."pricedCategory"
      OR NEW."pricedRegistrationFee" IS DISTINCT FROM OLD."pricedRegistrationFee"
      OR NEW."pricedLateInitial" IS DISTINCT FROM OLD."pricedLateInitial"
      OR NEW."pricedLateDaily" IS DISTINCT FROM OLD."pricedLateDaily"
      OR NEW."pricedLateDailyCap" IS DISTINCT FROM OLD."pricedLateDailyCap"
      OR NEW."pricedDeadline" IS DISTINCT FROM OLD."pricedDeadline"
      OR NEW."pricedEffectiveDate" IS DISTINCT FROM OLD."pricedEffectiveDate"
      OR NEW."pricedAt" IS DISTINCT FROM OLD."pricedAt")
     AND coalesce(current_setting('ogserc.reprice', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Pricing snapshot of % can only change through an admin recalculation', OLD."ackNo";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Submission_pricing_locked" BEFORE UPDATE ON "Submission"
  FOR EACH ROW EXECUTE FUNCTION ogserc_pricing_snapshot_locked();
