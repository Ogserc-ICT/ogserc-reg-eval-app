-- The SubmissionStatus enum is stored under its display labels (@map), so compare with
-- 'Received - Under Review', not the Prisma name RECEIVED.
CREATE OR REPLACE FUNCTION ogserc_workflow_fields_locked() RETURNS trigger AS $$
DECLARE
  allowed boolean := coalesce(current_setting('ogserc.workflow', true), '') = 'on';
BEGIN
  IF allowed THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'Received - Under Review'
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
