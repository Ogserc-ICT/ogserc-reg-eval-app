-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "certificateNeedsReissue" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DeficiencyNotice" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "noticeRef" TEXT NOT NULL,
    "noticeDate" DATE NOT NULL,
    "responseDue" DATE NOT NULL,
    "responseReceivedDate" DATE,
    "issuedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeficiencyNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeficiencyNotice_noticeRef_key" ON "DeficiencyNotice"("noticeRef");

-- CreateIndex
CREATE UNIQUE INDEX "DeficiencyNotice_submissionId_seq_key" ON "DeficiencyNotice"("submissionId", "seq");

-- AddForeignKey
ALTER TABLE "DeficiencyNotice" ADD CONSTRAINT "DeficiencyNotice_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeficiencyNotice" ADD CONSTRAINT "DeficiencyNotice_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: one notice per submission that already has a deficiency notice date.
INSERT INTO "DeficiencyNotice" ("id", "submissionId", "seq", "noticeRef", "noticeDate", "responseDue", "issuedById")
SELECT 'backfill-' || s."id", s."id", 1,
       'OGSERC/DEF/' || to_char(s."deficiencyNoticeDate", 'YYYY') || '/' || lpad(s."ackSeq"::text, 5, '0'),
       s."deficiencyNoticeDate",
       s."deficiencyNoticeDate" + (SELECT "deficiencyDays" FROM "Settings" WHERE "id" = 1),
       s."createdById"
FROM "Submission" s
WHERE s."deficiencyNoticeDate" IS NOT NULL;

-- Notices are records: never deleted.
CREATE TRIGGER "DeficiencyNotice_no_delete" BEFORE DELETE ON "DeficiencyNotice"
  FOR EACH ROW EXECUTE FUNCTION ogserc_reject_change();

-- ---------------------------------------------------------------------------
-- Workflow fields: status, decision and the dates/numbers set by workflow actions change only inside
-- a workflow transaction, which runs `SET LOCAL ogserc.workflow = 'on'` (src/server/workflow.ts).
-- No edit form, script or direct UPDATE can set them.
-- ---------------------------------------------------------------------------
CREATE FUNCTION ogserc_workflow_fields_locked() RETURNS trigger AS $$
DECLARE
  allowed boolean := coalesce(current_setting('ogserc.workflow', true), '') = 'on';
BEGIN
  IF allowed THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'RECEIVED'
       OR NEW."dateSubmissionComplete" IS NOT NULL
       OR NEW."deficiencyNoticeDate" IS NOT NULL
       OR NEW."showCauseDate" IS NOT NULL
       OR NEW."certificateIssueDate" IS NOT NULL
       OR NEW."registrationNo" IS NOT NULL THEN
      RAISE EXCEPTION 'A new submission starts as Received - Under Review; workflow fields are set by workflow actions';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status"
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

CREATE TRIGGER "Submission_workflow_fields_locked" BEFORE INSERT OR UPDATE ON "Submission"
  FOR EACH ROW EXECUTE FUNCTION ogserc_workflow_fields_locked();

CREATE FUNCTION ogserc_decision_fields_locked() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('ogserc.workflow', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."finalDecision" IS NOT NULL OR NEW."approvalDate" IS NOT NULL OR NEW."reviewDate" IS NOT NULL THEN
      RAISE EXCEPTION 'Decision fields are set by workflow actions';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."finalDecision" IS DISTINCT FROM OLD."finalDecision"
     OR NEW."approvalDate" IS DISTINCT FROM OLD."approvalDate"
     OR NEW."reviewDate" IS DISTINCT FROM OLD."reviewDate"
     OR NEW."reasons" IS DISTINCT FROM OLD."reasons"
     OR NEW."flagOverrideReason" IS DISTINCT FROM OLD."flagOverrideReason" THEN
    RAISE EXCEPTION 'Decision fields change only through workflow actions';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Evaluation_decision_fields_locked" BEFORE INSERT OR UPDATE ON "Evaluation"
  FOR EACH ROW EXECUTE FUNCTION ogserc_decision_fields_locked();
