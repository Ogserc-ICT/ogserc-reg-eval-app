-- Category forms REG-01A to REG-01K, part 1 of 4: enum values. On their own, because PostgreSQL does
-- not allow a new enum value to be used in the transaction that adds it.

-- Updates and annual confirmations close as "Changes Applied" once approved (para 16).
ALTER TYPE "SubmissionStatus" ADD VALUE 'Changes Applied';

-- The own-use notification is now Form REG-01I (it was OUN-01).
ALTER TYPE "FinalDecision" RENAME VALUE 'Redirect to OUN-01 / outside scope' TO 'Redirect to REG-01I / outside scope';
ALTER TYPE "FinalDecision" ADD VALUE 'Accept filing and apply changes (para 16)';

CREATE TYPE "WrongFormHandling" AS ENUM ('ACCEPT', 'REQUIRE_CORRECT_FORM');
CREATE TYPE "FilingType" AS ENUM ('New registration', 'Update: material change', 'Annual confirmation');
