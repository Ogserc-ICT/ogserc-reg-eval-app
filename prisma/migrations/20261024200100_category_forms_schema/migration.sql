-- Category forms REG-01A to REG-01K, part 2 of 4: new columns and tables (additive). The old columns
-- stay until part 3 has moved their data; part 4 drops them.

-- Settings: open policy points (docs/DECISIONS.md), each audited when changed.
ALTER TABLE "Settings" ADD COLUMN "annualConfirmationDue" TEXT NOT NULL DEFAULT '01-31',
ADD COLUMN "filingFeeOnUpdates" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "otherActivitiesRequireDocs" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "ownUseCertificate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "supplyRetailCategory1MwPlus" TEXT NOT NULL DEFAULT 'K',
ADD COLUMN "wrongFormHandling" "WrongFormHandling" NOT NULL DEFAULT 'ACCEPT';

-- Forms and their Schedule 2 documents (registration-forms.json; the seed creates the same rows).
CREATE TABLE "RegistrationForm" (
    "form" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "para" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "RegistrationForm_pkey" PRIMARY KEY ("form")
);
CREATE UNIQUE INDEX "RegistrationForm_category_key" ON "RegistrationForm"("category");

CREATE TABLE "FormDocument" (
    "form" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "requiredWhen" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "FormDocument_pkey" PRIMARY KEY ("form","key")
);
ALTER TABLE "FormDocument" ADD CONSTRAINT "FormDocument_form_fkey" FOREIGN KEY ("form") REFERENCES "RegistrationForm"("form") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "RegistrationForm" ("form", "category", "title", "para", "sortOrder") VALUES
  ('REG-01A', 'A', 'Successor distribution companies', '12; Schedule 1 Part A', 1),
  ('REG-01B', 'B', 'Integrated utilities', '12; Schedule 1 Part A', 2),
  ('REG-01C', 'C', 'Generation of 10 MW and above', '12; Schedule 1 Part A', 3),
  ('REG-01D', 'D', 'Generation of 1 MW to below 10 MW', '12; Schedule 1 Part A', 4),
  ('REG-01E', 'E', 'Mini-grids and interconnected mini-grids', '12; Schedule 1 Part A', 5),
  ('REG-01F', 'F', 'Other distribution licensees; trading and bulk supply', '12; Schedule 1 Part A', 6),
  ('REG-01G', 'G', 'Private, estate and industrial-park networks', '12; Schedule 1 Part A', 7),
  ('REG-01H', 'H', 'Metering service providers', '12; Schedule 1 Part A', 8),
  ('REG-01I', 'I', 'Own-use generation notification (200 kW to below 1 MW)', '3(4); Schedule 1 Part B', 9),
  ('REG-01J', 'J', 'Franchisees and sub-franchisees', '12; Schedule 1 Part A', 10),
  ('REG-01K', 'K', 'Any other activity below 1 MW', '12; Schedule 1 Part A', 11)
ON CONFLICT DO NOTHING;

INSERT INTO "FormDocument" ("form", "key", "text", "requiredWhen", "sortOrder") VALUES
  ('REG-01A', 'incorporation', 'Certificate of incorporation and CAC status report (or equivalent)', NULL, 1),
  ('REG-01A', 'constitution', 'Memorandum and articles of association (or equivalent)', NULL, 2),
  ('REG-01A', 'licences', 'Copy of every licence, permit or registration held', 'holds_any_licence', 3),
  ('REG-01A', 'single_line_diagram', 'Single-line diagram of the Ogun State network', NULL, 4),
  ('REG-01A', 'asset_register', 'Asset register with GPS coordinates of substations', NULL, 5),
  ('REG-01A', 'bulk_supply_agreements', 'Bulk supply and interface agreements', NULL, 6),
  ('REG-01A', 'tariff_order', 'Approved tariff order and band classification applied', NULL, 7),
  ('REG-01A', 'customer_enumeration', 'Customer enumeration summary by class and metering status', NULL, 8),
  ('REG-01A', 'largest_customers', 'List of the 20 largest customers', NULL, 9),
  ('REG-01A', 'env_safety_permits', 'Environmental and safety permits', NULL, 10),
  ('REG-01A', 'financials', 'Audited financial statements, last two years (or para 12(2) alternative)', NULL, 11),
  ('REG-01A', 'multistate_ringfencing', 'Multi-State: ring-fencing plan, separate Ogun registers and cross-boundary register (para 7(3))', 'multi_state_licensee', 12),
  ('REG-01A', 'board_resolution', 'Board resolution, or equivalent authorization, approving the registration and signatories', NULL, 13),
  ('REG-01A', 'payment_evidence', 'Evidence of payment of the registration fee', NULL, 14),
  ('REG-01B', 'incorporation', 'Certificate of incorporation and CAC status report (or equivalent)', NULL, 1),
  ('REG-01B', 'constitution', 'Memorandum and articles of association (or equivalent)', NULL, 2),
  ('REG-01B', 'licences', 'Copy of every licence, permit or registration held', 'holds_any_licence', 3),
  ('REG-01B', 'single_line_diagram', 'Single-line diagram of the plant and network', NULL, 4),
  ('REG-01B', 'asset_register', 'Asset register with GPS coordinates of plant and substations', NULL, 5),
  ('REG-01B', 'fuel_supply_agreements', 'Gas or fuel supply agreements', NULL, 6),
  ('REG-01B', 'supply_ppa_agreements', 'Bulk supply, power purchase and customer supply agreements', NULL, 7),
  ('REG-01B', 'tariff_order', 'Approved tariff order or tariff schedule applied', NULL, 8),
  ('REG-01B', 'customer_enumeration', 'Customer enumeration summary by class and metering status', NULL, 9),
  ('REG-01B', 'env_permits_eia', 'Environmental permits, including EIA approval', NULL, 10),
  ('REG-01B', 'financials', 'Audited financial statements, last two years (or para 12(2) alternative)', NULL, 11),
  ('REG-01B', 'board_resolution', 'Board resolution, or equivalent authorization, approving the registration and signatories', NULL, 12),
  ('REG-01B', 'payment_evidence', 'Evidence of payment of the registration fee', NULL, 13),
  ('REG-01C', 'incorporation', 'Certificate of incorporation and CAC status report (or equivalent)', NULL, 1),
  ('REG-01C', 'constitution', 'Memorandum and articles of association (or equivalent)', NULL, 2),
  ('REG-01C', 'licences', 'Copy of every licence, permit or registration held', 'holds_any_licence', 3),
  ('REG-01C', 'single_line_diagram', 'Single-line diagram of the plant and connection', NULL, 4),
  ('REG-01C', 'asset_register', 'Asset register with GPS coordinates of each plant', NULL, 5),
  ('REG-01C', 'connection_agreement', 'Grid or network connection agreement', NULL, 6),
  ('REG-01C', 'ppa_offtake', 'Power purchase and offtake agreements (sale only)', 'generation_for_sale', 7),
  ('REG-01C', 'fuel_supply_agreements', 'Gas or fuel supply agreements', NULL, 8),
  ('REG-01C', 'env_permits_eia', 'Environmental permits, including EIA approval', NULL, 9),
  ('REG-01C', 'financials', 'Audited financial statements, last two years (or para 12(2) alternative)', NULL, 10),
  ('REG-01C', 'board_resolution', 'Board resolution, or equivalent authorization, approving the registration and signatories', NULL, 11),
  ('REG-01C', 'payment_evidence', 'Evidence of payment of the registration fee', NULL, 12),
  ('REG-01D', 'incorporation', 'Certificate of incorporation and CAC status report (or equivalent)', NULL, 1),
  ('REG-01D', 'constitution', 'Memorandum and articles of association (or equivalent)', NULL, 2),
  ('REG-01D', 'licences', 'Copy of every licence, permit or registration held', 'holds_any_licence', 3),
  ('REG-01D', 'single_line_diagram', 'Single-line diagram of the plant and connection', NULL, 4),
  ('REG-01D', 'asset_register', 'Asset register with GPS coordinates of each plant', NULL, 5),
  ('REG-01D', 'connection_agreement', 'Grid or network connection agreement (if connected)', 'grid_connected', 6),
  ('REG-01D', 'ppa_offtake', 'Power purchase and offtake agreements (sale only)', 'generation_for_sale', 7),
  ('REG-01D', 'fuel_supply_agreements', 'Gas or fuel supply agreements', NULL, 8),
  ('REG-01D', 'env_permits', 'Environmental permits', NULL, 9),
  ('REG-01D', 'financials', 'Audited financial statements, last two years (or para 12(2) alternative)', NULL, 10),
  ('REG-01D', 'board_resolution', 'Board resolution, or equivalent authorization, approving the registration and signatories', NULL, 11),
  ('REG-01D', 'payment_evidence', 'Evidence of payment of the registration fee', NULL, 12),
  ('REG-01E', 'incorporation', 'Certificate of incorporation / registration (or community or cooperative registration)', NULL, 1),
  ('REG-01E', 'constitution', 'Constitutional documents (or equivalent)', NULL, 2),
  ('REG-01E', 'licences', 'Copy of every NERC or OGSERC permit or registration, by site', 'holds_any_licence', 3),
  ('REG-01E', 'single_line_diagram', 'Site layout or single-line diagram for each site', NULL, 4),
  ('REG-01E', 'asset_register', 'Asset list with GPS coordinates of each site', NULL, 5),
  ('REG-01E', 'community_consent', 'Community agreement or host consent for each site', NULL, 6),
  ('REG-01E', 'interconnection_agreement', 'Interconnection agreement with the DisCo (interconnected only)', 'interconnected_minigrid', 7),
  ('REG-01E', 'tariff_order', 'Tariff approval or tariff schedule applied', NULL, 8),
  ('REG-01E', 'customer_list', 'Customer list by site and class', NULL, 9),
  ('REG-01E', 'env_safety_permits', 'Environmental and safety permits', NULL, 10),
  ('REG-01E', 'financials', 'Financial statements or management accounts (para 12(2))', NULL, 11),
  ('REG-01E', 'board_resolution', 'Board resolution, or equivalent authorization, approving the registration and signatories', NULL, 12),
  ('REG-01E', 'payment_evidence', 'Evidence of payment of the registration fee', NULL, 13),
  ('REG-01F', 'incorporation', 'Certificate of incorporation and CAC status report (or equivalent)', NULL, 1),
  ('REG-01F', 'constitution', 'Memorandum and articles of association (or equivalent)', NULL, 2),
  ('REG-01F', 'licences', 'Copy of every licence, permit or registration held', 'holds_any_licence', 3),
  ('REG-01F', 'single_line_diagram', 'Single-line diagram of the network (distribution)', 'f_distribution', 4),
  ('REG-01F', 'asset_register', 'Asset register with GPS coordinates (distribution)', 'f_distribution', 5),
  ('REG-01F', 'supply_ppa_agreements', 'Bulk supply, power purchase and sale agreements', NULL, 6),
  ('REG-01F', 'wheeling_agreements', 'Use-of-system or wheeling agreements (trading)', 'f_trading', 7),
  ('REG-01F', 'tariff_order', 'Tariff or price schedules applied', NULL, 8),
  ('REG-01F', 'customer_enumeration', 'Customer enumeration summary (distribution)', 'f_distribution', 9),
  ('REG-01F', 'credit_support', 'Evidence of credit support (trading)', 'f_trading', 10),
  ('REG-01F', 'env_safety_permits', 'Environmental and safety permits (distribution)', 'f_distribution', 11),
  ('REG-01F', 'financials', 'Audited financial statements, last two years (or para 12(2) alternative)', NULL, 12),
  ('REG-01F', 'board_resolution', 'Board resolution, or equivalent authorization, approving the registration and signatories', NULL, 13),
  ('REG-01F', 'payment_evidence', 'Evidence of payment of the registration fee', NULL, 14),
  ('REG-01G', 'incorporation', 'Certificate of incorporation and CAC status report (or equivalent)', NULL, 1),
  ('REG-01G', 'constitution', 'Memorandum and articles of association (or equivalent)', NULL, 2),
  ('REG-01G', 'licences', 'Copy of every licence, permit or registration held', 'holds_any_licence', 3),
  ('REG-01G', 'developer_agreement', 'Agreement with the developer or owner of the development', NULL, 4),
  ('REG-01G', 'bulk_supply_agreements', 'Bulk supply agreement and bulk meter details', 'g_disco_bulk_supply', 5),
  ('REG-01G', 'single_line_diagram', 'Single-line diagram of the network', NULL, 6),
  ('REG-01G', 'asset_register', 'Asset register with GPS coordinates of transformers', NULL, 7),
  ('REG-01G', 'tariff_order', 'Tariff schedule and basis', NULL, 8),
  ('REG-01G', 'customer_enumeration', 'Customer enumeration summary', NULL, 9),
  ('REG-01G', 'financials', 'Financial statements or management accounts (para 12(2))', NULL, 10),
  ('REG-01G', 'board_resolution', 'Board resolution, or equivalent authorization, approving the registration and signatories', NULL, 11),
  ('REG-01G', 'payment_evidence', 'Evidence of payment of the registration fee', NULL, 12),
  ('REG-01H', 'incorporation', 'Certificate of incorporation and CAC status report (or equivalent)', NULL, 1),
  ('REG-01H', 'constitution', 'Memorandum and articles of association (or equivalent)', NULL, 2),
  ('REG-01H', 'licences', 'Copy of every licence, permit or registration held', 'holds_any_licence', 3),
  ('REG-01H', 'nemsa_accreditation', 'NEMSA certification or accreditation', NULL, 4),
  ('REG-01H', 'type_test_certificates', 'Type-test certificates for each meter model', NULL, 5),
  ('REG-01H', 'client_contracts', 'Contracts with distribution licensees or other clients', NULL, 6),
  ('REG-01H', 'installers_list', 'List of certified installers and technical staff', NULL, 7),
  ('REG-01H', 'financials', 'Financial statements or management accounts (para 12(2))', NULL, 8),
  ('REG-01H', 'board_resolution', 'Board resolution, or equivalent authorization, approving the registration and signatories', NULL, 9),
  ('REG-01H', 'payment_evidence', 'Evidence of payment of the registration fee', NULL, 10),
  ('REG-01I', 'incorporation', 'Certificate of incorporation / business registration', NULL, 1),
  ('REG-01I', 'nameplate_photos', 'Photographs of generator nameplates', NULL, 2),
  ('REG-01I', 'payment_evidence', 'Evidence of payment of the notification fee', NULL, 3),
  ('REG-01J', 'incorporation', 'Certificate of incorporation and CAC status report (or equivalent)', NULL, 1),
  ('REG-01J', 'constitution', 'Memorandum and articles of association (or equivalent)', NULL, 2),
  ('REG-01J', 'licences', 'Copy of every licence, permit or registration held', 'holds_any_licence', 3),
  ('REG-01J', 'franchise_agreement', 'Franchise or sub-franchise agreement', NULL, 4),
  ('REG-01J', 'franchisor_consent', 'Franchisor''s consent or approval (sub-franchise)', 'sub_franchise', 5),
  ('REG-01J', 'territory_map', 'Map or list of feeders and communities in the territory', NULL, 6),
  ('REG-01J', 'asset_register', 'Asset register with GPS coordinates of transformers', NULL, 7),
  ('REG-01J', 'customer_enumeration', 'Customer enumeration summary', NULL, 8),
  ('REG-01J', 'financials', 'Financial statements or management accounts (para 12(2))', NULL, 9),
  ('REG-01J', 'board_resolution', 'Board resolution, or equivalent authorization, approving the registration and signatories', NULL, 10),
  ('REG-01J', 'payment_evidence', 'Evidence of payment of the registration fee', NULL, 11),
  ('REG-01K', 'incorporation', 'Certificate of incorporation and CAC status report (or equivalent)', NULL, 1),
  ('REG-01K', 'constitution', 'Memorandum and articles of association (or equivalent)', NULL, 2),
  ('REG-01K', 'licences', 'Copy of every licence, permit or registration held', 'holds_any_licence', 3),
  ('REG-01K', 'single_line_diagram', 'Single-line diagram or simple layout of the installation', NULL, 4),
  ('REG-01K', 'asset_register', 'Asset list with GPS coordinates', NULL, 5),
  ('REG-01K', 'supply_sale_agreements', 'Supply or sale agreements', NULL, 6),
  ('REG-01K', 'tariff_order', 'Tariff or price schedule', NULL, 7),
  ('REG-01K', 'financials', 'Financial statements or management accounts (para 12(2))', NULL, 8),
  ('REG-01K', 'board_resolution', 'Board resolution, or equivalent authorization, approving the registration and signatories', NULL, 9),
  ('REG-01K', 'payment_evidence', 'Evidence of payment of the registration fee', NULL, 10)
ON CONFLICT DO NOTHING;

-- Submission: filing, form filed (filled by part 3, then NOT NULL), common sections, conditions.
ALTER TABLE "Submission" ADD COLUMN "categoryConfirmedById" TEXT,
ADD COLUMN "categoryConfirmedOn" DATE,
ADD COLUMN "categoryConfirmedReason" TEXT,
ADD COLUMN "confirmedCategory" TEXT,
ADD COLUMN "fDistribution" BOOLEAN,
ADD COLUMN "fTrading" BOOLEAN,
ADD COLUMN "filingType" "FilingType" NOT NULL DEFAULT 'New registration',
ADD COLUMN "formFiled" TEXT,
ADD COLUMN "gDiscoBulkSupply" BOOLEAN,
ADD COLUMN "generationForSale" BOOLEAN,
ADD COLUMN "gridConnected" BOOLEAN,
ADD COLUMN "holdsAnyLicence" BOOLEAN,
ADD COLUMN "incorporationDate" DATE,
ADD COLUMN "interconnectedMinigrid" BOOLEAN,
ADD COLUMN "lgasServed" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "linkedSubmissionId" TEXT,
ADD COLUMN "mdEmail" TEXT,
ADD COLUMN "mdName" TEXT,
ADD COLUMN "mdPhone" TEXT,
ADD COLUMN "multiStateLicensee" BOOLEAN,
ADD COLUMN "operationalAddress" TEXT,
ADD COLUMN "signatory1Date" DATE,
ADD COLUMN "signatory1Designation" TEXT,
ADD COLUMN "signatory1Name" TEXT,
ADD COLUMN "signatory2Date" DATE,
ADD COLUMN "signatory2Designation" TEXT,
ADD COLUMN "signatory2Name" TEXT,
ADD COLUMN "subFranchise" BOOLEAN,
ADD COLUMN "tradingName" TEXT,
ADD COLUMN "website" TEXT;
CREATE INDEX "Submission_linkedSubmissionId_idx" ON "Submission"("linkedSubmissionId");
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_categoryConfirmedById_fkey" FOREIGN KEY ("categoryConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_formFiled_fkey" FOREIGN KEY ("formFiled") REFERENCES "RegistrationForm"("form") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_linkedSubmissionId_fkey" FOREIGN KEY ("linkedSubmissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Child tables of the common sections.
CREATE TABLE "SubmissionActivity" (
    "submissionId" TEXT NOT NULL,
    "activityCode" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "SubmissionActivity_pkey" PRIMARY KEY ("submissionId","activityCode")
);

CREATE TABLE "SubmissionLicence" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "type" TEXT,
    "issuingAuthority" TEXT,
    "number" TEXT,
    "issueDate" DATE,
    "expiryDate" DATE,
    "activityCovered" TEXT,

    CONSTRAINT "SubmissionLicence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubmissionShareholder" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nationality" TEXT,
    "percentHolding" DECIMAL(5,2),
    "beneficialOwner" BOOLEAN,

    CONSTRAINT "SubmissionShareholder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubmissionDirector" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "phone" TEXT,
    "email" TEXT,

    CONSTRAINT "SubmissionDirector_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubmissionConfidentiality" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "item" TEXT NOT NULL,
    "reasons" TEXT,

    CONSTRAINT "SubmissionConfidentiality_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubmissionHseIncident" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "date" DATE,
    "location" TEXT,
    "type" TEXT,
    "description" TEXT,

    CONSTRAINT "SubmissionHseIncident_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubmissionLicence_submissionId_idx" ON "SubmissionLicence"("submissionId");
CREATE INDEX "SubmissionShareholder_submissionId_idx" ON "SubmissionShareholder"("submissionId");
CREATE INDEX "SubmissionDirector_submissionId_idx" ON "SubmissionDirector"("submissionId");
CREATE INDEX "SubmissionConfidentiality_submissionId_idx" ON "SubmissionConfidentiality"("submissionId");
CREATE INDEX "SubmissionHseIncident_submissionId_idx" ON "SubmissionHseIncident"("submissionId");
ALTER TABLE "SubmissionActivity" ADD CONSTRAINT "SubmissionActivity_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionActivity" ADD CONSTRAINT "SubmissionActivity_activityCode_fkey" FOREIGN KEY ("activityCode") REFERENCES "Activity"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionLicence" ADD CONSTRAINT "SubmissionLicence_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionShareholder" ADD CONSTRAINT "SubmissionShareholder_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionDirector" ADD CONSTRAINT "SubmissionDirector_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionConfidentiality" ADD CONSTRAINT "SubmissionConfidentiality_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubmissionHseIncident" ADD CONSTRAINT "SubmissionHseIncident_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checklist items by shared document key (filled by part 3; part 4 makes it the key).
ALTER TABLE "DocumentChecklistItem" ADD COLUMN "documentKey" TEXT;

-- Own-use (Form REG-01I): generator units, checklist, optional registration with a certificate.
ALTER TABLE "OwnUseNotification" ADD COLUMN "certificateIssueDate" DATE,
ADD COLUMN "flagOverrideReason" TEXT,
ADD COLUMN "registeredById" TEXT,
ADD COLUMN "registrationNo" TEXT;
CREATE UNIQUE INDEX "OwnUseNotification_registrationNo_key" ON "OwnUseNotification"("registrationNo");
ALTER TABLE "OwnUseNotification" ADD CONSTRAINT "OwnUseNotification_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "OwnUseUnit" (
    "id" TEXT NOT NULL,
    "ownUseNotificationId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "makeModel" TEXT,
    "capacityKw" DECIMAL(12,3) NOT NULL,
    "fuel" TEXT,
    "avgMonthlyMwh" DECIMAL(12,3),

    CONSTRAINT "OwnUseUnit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OwnUseUnit_capacity_positive" CHECK ("capacityKw" > 0)
);
CREATE INDEX "OwnUseUnit_ownUseNotificationId_idx" ON "OwnUseUnit"("ownUseNotificationId");
ALTER TABLE "OwnUseUnit" ADD CONSTRAINT "OwnUseUnit_ownUseNotificationId_fkey" FOREIGN KEY ("ownUseNotificationId") REFERENCES "OwnUseNotification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OwnUseDocumentItem" (
    "ownUseNotificationId" TEXT NOT NULL,
    "documentKey" TEXT NOT NULL,
    "value" "CheckValue" NOT NULL,

    CONSTRAINT "OwnUseDocumentItem_pkey" PRIMARY KEY ("ownUseNotificationId","documentKey")
);
ALTER TABLE "OwnUseDocumentItem" ADD CONSTRAINT "OwnUseDocumentItem_ownUseNotificationId_fkey" FOREIGN KEY ("ownUseNotificationId") REFERENCES "OwnUseNotification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Generated documents may belong to an own-use notification (its certificate).
ALTER TABLE "GeneratedDocument" DROP CONSTRAINT "GeneratedDocument_submissionId_fkey";
ALTER TABLE "GeneratedDocument" ADD COLUMN "ownUseNotificationId" TEXT,
ALTER COLUMN "submissionId" DROP NOT NULL;
CREATE UNIQUE INDEX "GeneratedDocument_ownUseNotificationId_kind_version_key" ON "GeneratedDocument"("ownUseNotificationId", "kind", "version");
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_ownUseNotificationId_fkey" FOREIGN KEY ("ownUseNotificationId") REFERENCES "OwnUseNotification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_one_owner" CHECK (num_nonnulls("submissionId", "ownUseNotificationId") = 1);

-- EVAL-01: new automatic check 1.10 after 1.9, and the own-use form's new name in 1.2 and 7.5
-- (seed-data.json has the same). No-ops on an empty table; the seed then creates all checks.
UPDATE "EvaluationCheck" SET "sortOrder" = "sortOrder" + 1
WHERE "sortOrder" > (SELECT "sortOrder" FROM "EvaluationCheck" WHERE "id" = '1.9');
INSERT INTO "EvaluationCheck" ("id", "stage", "text", "sortOrder")
SELECT '1.10', "stage", 'Form filed matches the confirmed category (or accepted and re-categorised with reasons)', "sortOrder" + 1
FROM "EvaluationCheck" WHERE "id" = '1.9'
ON CONFLICT DO NOTHING;
UPDATE "EvaluationCheck" SET "text" = 'Correct form used: REG-01A to K for operators; REG-01I for own-use 200 kW to <1 MW' WHERE "id" = '1.2';
UPDATE "EvaluationCheck" SET "text" = 'Own-use site of 1 MW+ on REG-01I directed to REG-01C or REG-01D (3(3)(c))' WHERE "id" = '7.5';

-- Registrant type "Other" (the forms list it).
INSERT INTO "LookupValue" ("list", "value", "sortOrder")
SELECT 'registrant_types', 'Other', max("sortOrder") + 1 FROM "LookupValue" WHERE "list" = 'registrant_types'
HAVING count(*) > 0
ON CONFLICT DO NOTHING;
