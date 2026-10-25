-- Category forms REG-01A to REG-01K, part 4 of 4: drop the replaced columns (their data was moved by
-- part 3) and add the database rules.

ALTER TABLE "Submission" ALTER COLUMN "formFiled" SET NOT NULL;
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_secondaryActivityCode_fkey";
ALTER TABLE "Submission" DROP COLUMN "licenceExpiry",
DROP COLUMN "licenceNo",
DROP COLUMN "secondaryActivityCode";

ALTER TABLE "DocumentChecklistItem" DROP CONSTRAINT "DocumentChecklistItem_documentNumber_fkey";
ALTER TABLE "DocumentChecklistItem" DROP CONSTRAINT "DocumentChecklistItem_pkey",
DROP COLUMN "documentNumber",
ALTER COLUMN "documentKey" SET NOT NULL,
ADD CONSTRAINT "DocumentChecklistItem_pkey" PRIMARY KEY ("submissionId", "documentKey");
DROP TABLE "Schedule2Document";

ALTER TABLE "OwnUseNotification" DROP COLUMN "avgMonthlyOutputMwh",
DROP COLUMN "fuel",
DROP COLUMN "installedCapacityKw",
DROP COLUMN "units";

-- What a submission is never changes once saved: its filing type and the registration it updates.
CREATE FUNCTION ogserc_filing_locked() RETURNS trigger AS $$
BEGIN
  IF NEW."filingType" IS DISTINCT FROM OLD."filingType"
     OR NEW."linkedSubmissionId" IS DISTINCT FROM OLD."linkedSubmissionId" THEN
    RAISE EXCEPTION 'The filing type and linked registration of % cannot change', OLD."ackNo";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Submission_filing_locked" BEFORE UPDATE ON "Submission"
  FOR EACH ROW EXECUTE FUNCTION ogserc_filing_locked();

-- An own-use registration number and certificate date, once set, never change (like a submission's).
CREATE FUNCTION ogserc_own_use_registration_locked() RETURNS trigger AS $$
BEGIN
  IF OLD."registrationNo" IS NOT NULL AND (
       NEW."registrationNo" IS DISTINCT FROM OLD."registrationNo"
       OR NEW."certificateIssueDate" IS DISTINCT FROM OLD."certificateIssueDate"
       OR NEW."registeredById" IS DISTINCT FROM OLD."registeredById") THEN
    RAISE EXCEPTION 'Own-use registration % is locked', OLD."registrationNo";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OwnUseNotification_registration_locked" BEFORE UPDATE ON "OwnUseNotification"
  FOR EACH ROW EXECUTE FUNCTION ogserc_own_use_registration_locked();

-- Issued documents stay immutable, including which record they belong to.
CREATE OR REPLACE FUNCTION ogserc_generated_document_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."content" IS DISTINCT FROM OLD."content"
     OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
     OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
     OR NEW."fileName" IS DISTINCT FROM OLD."fileName"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."submissionId" IS DISTINCT FROM OLD."submissionId"
     OR NEW."ownUseNotificationId" IS DISTINCT FROM OLD."ownUseNotificationId"
     OR NEW."deficiencyNoticeId" IS DISTINCT FROM OLD."deficiencyNoticeId"
     OR NEW."generatedById" IS DISTINCT FROM OLD."generatedById"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."note" IS DISTINCT FROM OLD."note"
     OR (OLD."supersededAt" IS NOT NULL AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt") THEN
    RAISE EXCEPTION 'Issued document % v% cannot be changed', OLD."kind", OLD."version";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
