-- Finance confirmation gate, part 3 of 3: existing records (docs/DECISIONS.md).
-- Every submission not yet closed with no payment confirmed by Finance goes back to
-- "Acknowledged - Awaiting Payment", with one audit entry per submission. Payments already recorded
-- are Pending (part 2's column default). Preview the effect first: npm run finance-gate:dry-run
-- (same rule as below).

-- Status is a workflow field (DB trigger); allow this migration to change it.
SELECT set_config('ogserc.workflow', 'on', false);

CREATE TEMP TABLE ogserc_finance_gate_moves AS
SELECT s."id", s."ackNo", s."status"::text AS "oldStatus"
FROM "Submission" s
WHERE s."status" NOT IN ('Acknowledged - Awaiting Payment', 'Registered', 'Refused', 'Lapsed', 'Cancelled')
  AND NOT EXISTS (
    SELECT 1 FROM "Payment" p
    WHERE p."submissionId" = s."id" AND p."status" = 'ACTIVE' AND p."financeStatus" = 'CONFIRMED'
  );

UPDATE "Submission"
SET "status" = 'Acknowledged - Awaiting Payment'
WHERE "id" IN (SELECT "id" FROM ogserc_finance_gate_moves);

INSERT INTO "AuditLog" ("userId", "action", "reference", "detail")
SELECT NULL, 'Returned to awaiting payment', m."ackNo",
       m."oldStatus" || ' → Acknowledged - Awaiting Payment. Finance confirmation gate introduced: no payment confirmed by Finance yet (data migration).'
FROM ogserc_finance_gate_moves m
ORDER BY m."ackNo";

INSERT INTO "AuditLog" ("userId", "action", "reference", "detail")
SELECT NULL, 'Finance gate introduced', NULL,
       (SELECT count(*) FROM ogserc_finance_gate_moves) || ' submission(s) returned to Acknowledged - Awaiting Payment; '
       || (SELECT count(*) FROM "Payment" WHERE "financeStatus" = 'PENDING') || ' payment(s) recorded before the gate are Pending until Finance confirms them.';

DROP TABLE ogserc_finance_gate_moves;
SELECT set_config('ogserc.workflow', '', false);
