-- CreateEnum
CREATE TYPE "Role" AS ENUM ('REGISTRY_OFFICER', 'FINANCE_OFFICER', 'EVALUATING_OFFICER', 'REVIEWING_SUPERVISOR', 'APPROVING_OFFICER', 'ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('Received - Under Review', 'Deficiency Notice Issued', 'Provisionally Registered', 'Registered', 'Lapsed', 'Refused', 'Cancelled');

-- CreateEnum
CREATE TYPE "CheckValue" AS ENUM ('Y', 'N', 'N/A');

-- CreateEnum
CREATE TYPE "FinalDecision" AS ENUM ('Register (13(1)(a))', 'Issue deficiency notice (13(1)(b))', 'Refuse (13(3)) - after show-cause', 'Treat as lapsed (13(2))', 'Provisional registration (13(4))', 'Redirect to OUN-01 / outside scope');

-- CreateEnum
CREATE TYPE "PaymentRecordStatus" AS ENUM ('ACTIVE', 'REVERSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT NOT NULL,
    "roles" "Role"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "effectiveDate" DATE NOT NULL,
    "registrationPeriodDays" INTEGER NOT NULL,
    "extensionDays" INTEGER NOT NULL,
    "newOperatorLeadDays" INTEGER NOT NULL,
    "determinationDays" INTEGER NOT NULL,
    "deficiencyDays" INTEGER NOT NULL,
    "licenceApplicationDays" INTEGER NOT NULL,
    "licenceExpiryWindowDays" INTEGER NOT NULL,
    "amberWarningDays" INTEGER NOT NULL,
    "ownUseThresholdKw" INTEGER NOT NULL,
    "showCauseDays" INTEGER NOT NULL DEFAULT 14,
    "registrationPrefix" TEXT NOT NULL,
    "ackPrefix" TEXT NOT NULL,
    "ounPrefix" TEXT NOT NULL,
    "paymentPrefix" TEXT NOT NULL,
    "chairmanName" TEXT NOT NULL,
    "commissionerName" TEXT NOT NULL,
    "feesRevisedOn" DATE,
    "lateChargeBlocksCompleteness" BOOLEAN NOT NULL DEFAULT false,
    "waiverAppliesToLateCharge" BOOLEAN NOT NULL DEFAULT false,
    "flagsBlockApproval" BOOLEAN NOT NULL DEFAULT false,
    "tinPattern" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeCategory" (
    "category" TEXT NOT NULL,
    "registrationFee" BIGINT NOT NULL,
    "lateInitial" BIGINT NOT NULL,
    "lateDaily" BIGINT NOT NULL,
    "lateDailyCap" BIGINT NOT NULL,
    "lateTier" TEXT,
    "description" TEXT NOT NULL,

    CONSTRAINT "FeeCategory_pkey" PRIMARY KEY ("category")
);

-- CreateTable
CREATE TABLE "Activity" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cat10MwPlus" TEXT NOT NULL,
    "cat1To10Mw" TEXT NOT NULL,
    "catBelow1Mw" TEXT NOT NULL,
    "capacityBased" BOOLEAN NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Lga" (
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Lga_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "LookupValue" (
    "list" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "LookupValue_pkey" PRIMARY KEY ("list","value")
);

-- CreateTable
CREATE TABLE "Schedule2Document" (
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Schedule2Document_pkey" PRIMARY KEY ("number")
);

-- CreateTable
CREATE TABLE "EvaluationCheck" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "EvaluationCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "ackSeq" INTEGER NOT NULL,
    "ackNo" TEXT NOT NULL,
    "registeredName" TEXT NOT NULL,
    "dateSubmitted" DATE NOT NULL,
    "submissionChannel" TEXT,
    "registrantType" TEXT,
    "cacNo" TEXT,
    "tin" TEXT,
    "address" TEXT,
    "principalLga" TEXT NOT NULL,
    "otherAreasServed" TEXT,
    "primaryActivityCode" TEXT NOT NULL,
    "secondaryActivityCode" TEXT,
    "installedCapacityMw" DECIMAL(12,4),
    "customers" INTEGER,
    "licenceStatus" TEXT NOT NULL,
    "licenceNo" TEXT,
    "licenceExpiry" DATE,
    "complianceOfficer" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "operatingOnEffectiveDate" BOOLEAN NOT NULL,
    "plannedStartDate" DATE,
    "approvedWaiver" BIGINT NOT NULL DEFAULT 0,
    "categoryOverride" TEXT,
    "overrideReason" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'Received - Under Review',
    "dateSubmissionComplete" DATE,
    "deficiencyNoticeDate" DATE,
    "showCauseDate" DATE,
    "certificateIssueDate" DATE,
    "registrationNo" TEXT,
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChecklistItem" (
    "submissionId" TEXT NOT NULL,
    "documentNumber" INTEGER NOT NULL,
    "value" "CheckValue" NOT NULL,

    CONSTRAINT "DocumentChecklistItem_pkey" PRIMARY KEY ("submissionId","documentNumber")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "evaluatingOfficerId" TEXT,
    "dateEvaluationStarted" DATE,
    "reviewingSupervisorId" TEXT,
    "approvingOfficerId" TEXT,
    "evaluationRemarks" TEXT,
    "finalDecision" "FinalDecision",
    "reasons" TEXT,
    "reviewDate" DATE,
    "approvalDate" DATE,
    "flagOverrideReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationCheckValue" (
    "evaluationId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "value" "CheckValue" NOT NULL,

    CONSTRAINT "EvaluationCheckValue_pkey" PRIMARY KEY ("evaluationId","checkId")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "paymentSeq" INTEGER NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "dateReceived" DATE NOT NULL,
    "reference" TEXT NOT NULL,
    "submissionId" TEXT,
    "ownUseNotificationId" TEXT,
    "purpose" TEXT,
    "channel" TEXT,
    "amount" BIGINT NOT NULL,
    "rrr" TEXT,
    "verifiedWithBank" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "status" "PaymentRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnUseNotification" (
    "id" TEXT NOT NULL,
    "ounSeq" INTEGER NOT NULL,
    "ounNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dateFiled" DATE NOT NULL,
    "cacNo" TEXT,
    "siteAddress" TEXT,
    "lga" TEXT NOT NULL,
    "natureOfBusiness" TEXT,
    "gridConnected" BOOLEAN,
    "distributionLicensee" TEXT,
    "units" INTEGER,
    "installedCapacityKw" DECIMAL(12,3) NOT NULL,
    "fuel" TEXT,
    "avgMonthlyOutputMwh" DECIMAL(12,3),
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnUseNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "reference" TEXT,
    "detail" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_name_key" ON "Activity"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_ackSeq_key" ON "Submission"("ackSeq");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_ackNo_key" ON "Submission"("ackNo");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_registrationNo_key" ON "Submission"("registrationNo");

-- CreateIndex
CREATE INDEX "Submission_cacNo_idx" ON "Submission"("cacNo");

-- CreateIndex
CREATE INDEX "Submission_status_idx" ON "Submission"("status");

-- CreateIndex
CREATE INDEX "Submission_registeredName_idx" ON "Submission"("registeredName");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_submissionId_key" ON "Evaluation"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentSeq_key" ON "Payment"("paymentSeq");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentNo_key" ON "Payment"("paymentNo");

-- CreateIndex
CREATE INDEX "Payment_reference_idx" ON "Payment"("reference");

-- CreateIndex
CREATE INDEX "Payment_rrr_idx" ON "Payment"("rrr");

-- CreateIndex
CREATE UNIQUE INDEX "OwnUseNotification_ounSeq_key" ON "OwnUseNotification"("ounSeq");

-- CreateIndex
CREATE UNIQUE INDEX "OwnUseNotification_ounNo_key" ON "OwnUseNotification"("ounNo");

-- CreateIndex
CREATE INDEX "OwnUseNotification_cacNo_idx" ON "OwnUseNotification"("cacNo");

-- CreateIndex
CREATE INDEX "AuditLog_reference_idx" ON "AuditLog"("reference");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_cat10MwPlus_fkey" FOREIGN KEY ("cat10MwPlus") REFERENCES "FeeCategory"("category") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_cat1To10Mw_fkey" FOREIGN KEY ("cat1To10Mw") REFERENCES "FeeCategory"("category") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_catBelow1Mw_fkey" FOREIGN KEY ("catBelow1Mw") REFERENCES "FeeCategory"("category") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_primaryActivityCode_fkey" FOREIGN KEY ("primaryActivityCode") REFERENCES "Activity"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_secondaryActivityCode_fkey" FOREIGN KEY ("secondaryActivityCode") REFERENCES "Activity"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_categoryOverride_fkey" FOREIGN KEY ("categoryOverride") REFERENCES "FeeCategory"("category") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChecklistItem" ADD CONSTRAINT "DocumentChecklistItem_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChecklistItem" ADD CONSTRAINT "DocumentChecklistItem_documentNumber_fkey" FOREIGN KEY ("documentNumber") REFERENCES "Schedule2Document"("number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_evaluatingOfficerId_fkey" FOREIGN KEY ("evaluatingOfficerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_reviewingSupervisorId_fkey" FOREIGN KEY ("reviewingSupervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_approvingOfficerId_fkey" FOREIGN KEY ("approvingOfficerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationCheckValue" ADD CONSTRAINT "EvaluationCheckValue_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationCheckValue" ADD CONSTRAINT "EvaluationCheckValue_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "EvaluationCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ownUseNotificationId_fkey" FOREIGN KEY ("ownUseNotificationId") REFERENCES "OwnUseNotification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnUseNotification" ADD CONSTRAINT "OwnUseNotification_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integrity rules the app must never bypass (CLAUDE.md conventions, SPEC ?1.6)
-- ---------------------------------------------------------------------------

-- Settings is a single row.
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_single_row" CHECK ("id" = 1);

-- A payment belongs to exactly one submission or own-use notification.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_one_target"
  CHECK (("submissionId" IS NOT NULL) <> ("ownUseNotificationId" IS NOT NULL));

-- Money is never negative.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_waiver_non_negative" CHECK ("approvedWaiver" >= 0);

CREATE FUNCTION ogserc_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on table % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- Never delete Submissions, Payments or AuditLog rows; use statuses.
CREATE TRIGGER "Submission_no_delete" BEFORE DELETE ON "Submission"
  FOR EACH ROW EXECUTE FUNCTION ogserc_reject_change();
CREATE TRIGGER "Payment_no_delete" BEFORE DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION ogserc_reject_change();

-- AuditLog is append-only.
CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION ogserc_reject_change();

-- A locked registration number never changes.
CREATE FUNCTION ogserc_lock_registration_no() RETURNS trigger AS $$
BEGIN
  IF OLD."registrationNo" IS NOT NULL AND NEW."registrationNo" IS DISTINCT FROM OLD."registrationNo" THEN
    RAISE EXCEPTION 'Registration number % is locked', OLD."registrationNo";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Submission_lock_registration_no" BEFORE UPDATE ON "Submission"
  FOR EACH ROW EXECUTE FUNCTION ogserc_lock_registration_no();
