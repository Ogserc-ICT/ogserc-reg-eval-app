-- Category forms REG-01A to REG-01K, part 3 of 4: existing records (docs/DECISIONS.md).
-- Preview the effect first: npm run category-forms:dry-run (it runs these same statements in a
-- transaction and rolls them back).
--
-- Submissions: form filed = REG-01{applied category}; filing type New registration (column default);
-- the licence number and expiry become a row of the licences table; the secondary activity becomes
-- an "other activity"; "holds any licence" and "multi-State licensee" follow from the licence status.
-- The old 13-item checklist values move to the form's keys where the documents match
-- (src/domain/legacy-documents.ts); the rest are left pending, and each submission's audit entry
-- lists what was not carried over. Own-use notifications: one generator-unit row each, from the
-- recorded capacity, fuel and output.

-- 1. Form filed and the conditions that follow from the licence status.
UPDATE "Submission" SET "formFiled" = 'REG-01' || "pricedCategory" WHERE "formFiled" IS NULL;
UPDATE "Submission"
SET "holdsAnyLicence" = ("licenceStatus" <> 'Unlicensed'),
    "multiStateLicensee" = ("licenceStatus" = 'NERC licence (multi-State)');

-- 2. Licence number and expiry → the licences table.
INSERT INTO "SubmissionLicence" ("id", "submissionId", "sortOrder", "type", "number", "expiryDate")
SELECT gen_random_uuid()::text, s."id", 1, s."licenceStatus", s."licenceNo", s."licenceExpiry"
FROM "Submission" s
WHERE s."licenceNo" IS NOT NULL OR s."licenceExpiry" IS NOT NULL;

-- 3. Secondary activity → other activities.
INSERT INTO "SubmissionActivity" ("submissionId", "activityCode", "sortOrder")
SELECT s."id", s."secondaryActivityCode", 1
FROM "Submission" s
WHERE s."secondaryActivityCode" IS NOT NULL AND s."secondaryActivityCode" <> s."primaryActivityCode";

-- 4. Checklist: old item number → the form's key. Item 10 has a different key on different forms
-- (each form has one of them). Items 7, 12 and 13 have no single match (12, evidence of payment,
-- now ticks itself from confirmed payments).
CREATE TEMP TABLE ogserc_legacy_keys ("number" INTEGER, "key" TEXT);
INSERT INTO ogserc_legacy_keys VALUES
  (1, 'incorporation'), (2, 'constitution'), (3, 'licences'), (4, 'single_line_diagram'),
  (5, 'asset_register'), (6, 'financials'), (8, 'tariff_order'), (9, 'customer_enumeration'),
  (10, 'env_safety_permits'), (10, 'env_permits_eia'), (10, 'env_permits'), (11, 'board_resolution');

UPDATE "DocumentChecklistItem" d
SET "documentKey" = k."key"
FROM "Submission" s, ogserc_legacy_keys k, "FormDocument" f
WHERE s."id" = d."submissionId"
  AND k."number" = d."documentNumber"
  AND f."form" = s."formFiled"
  AND f."key" = k."key";

-- 5. One audit entry per submission, then drop the values that were not carried over.
CREATE TEMP TABLE ogserc_forms_moves AS
SELECT s."id", s."ackNo", s."formFiled", s."pricedCategory", s."licenceNo", s."licenceExpiry",
       s."primaryActivityCode", s."secondaryActivityCode",
       (SELECT count(*) FROM "DocumentChecklistItem" d
         WHERE d."submissionId" = s."id" AND d."documentKey" IS NOT NULL) AS kept,
       (SELECT string_agg(sd."name" || ' = ' || d."value"::text
                || CASE WHEN d."documentNumber" = 12 THEN ' (now ticked automatically from confirmed payments)' ELSE '' END,
                '; ' ORDER BY d."documentNumber")
          FROM "DocumentChecklistItem" d JOIN "Schedule2Document" sd ON sd."number" = d."documentNumber"
         WHERE d."submissionId" = s."id" AND d."documentKey" IS NULL) AS dropped
FROM "Submission" s;

INSERT INTO "AuditLog" ("userId", "action", "reference", "detail")
SELECT NULL, 'Migrated to category forms', m."ackNo",
       'Form filed ' || m."formFiled" || ' (Category ' || m."pricedCategory" || ' applied); New registration. '
       || 'Checklist values carried over: ' || m.kept || '. '
       || 'Not carried over (left pending): ' || coalesce(m.dropped, 'none') || '.'
       || CASE WHEN m."licenceNo" IS NOT NULL OR m."licenceExpiry" IS NOT NULL
               THEN ' Licence ' || coalesce('No. ' || m."licenceNo", '(no number)')
                    || coalesce(', expiry ' || to_char(m."licenceExpiry", 'YYYY-MM-DD'), '')
                    || ' moved to the licences table.'
               ELSE '' END
       || CASE WHEN m."secondaryActivityCode" IS NOT NULL AND m."secondaryActivityCode" <> m."primaryActivityCode"
               THEN ' Secondary activity ' || m."secondaryActivityCode" || ' is now an other activity.'
               ELSE '' END
FROM ogserc_forms_moves m
ORDER BY m."ackNo";

DELETE FROM "DocumentChecklistItem" WHERE "documentKey" IS NULL;

-- 6. Own-use notifications: one generator-unit row from the recorded total.
INSERT INTO "OwnUseUnit" ("id", "ownUseNotificationId", "sortOrder", "makeModel", "capacityKw", "fuel", "avgMonthlyMwh")
SELECT gen_random_uuid()::text, o."id", 1,
       CASE WHEN o."units" > 1 THEN 'Total of ' || o."units" || ' units (recorded before Form REG-01I)' END,
       o."installedCapacityKw", o."fuel", o."avgMonthlyOutputMwh"
FROM "OwnUseNotification" o;

INSERT INTO "AuditLog" ("userId", "action", "reference", "detail")
SELECT NULL, 'Migrated to Form REG-01I', o."ounNo",
       'One generator-unit row: ' || o."installedCapacityKw"::text || ' kW'
       || coalesce(', ' || o."fuel", '')
       || CASE WHEN o."units" > 1 THEN ' (total of ' || o."units" || ' units)' ELSE '' END
       || '. Documents checklist starts pending; evidence of payment ticks itself once Finance confirms the fee.'
FROM "OwnUseNotification" o
ORDER BY o."ounNo";

INSERT INTO "AuditLog" ("userId", "action", "reference", "detail")
SELECT NULL, 'Category forms introduced', NULL,
       (SELECT count(*) FROM ogserc_forms_moves) || ' submission(s) filed as REG-01{applied category}, New registration; '
       || (SELECT coalesce(sum(kept), 0) FROM ogserc_forms_moves) || ' checklist value(s) carried over to the per-form lists; '
       || (SELECT count(*) FROM "SubmissionLicence") || ' licence row(s); '
       || (SELECT count(*) FROM "OwnUseUnit") || ' own-use notification(s) given a generator-unit row.';

DROP TABLE ogserc_forms_moves;
DROP TABLE ogserc_legacy_keys;
