-- Finance confirmation gate, part 1 of 3: the new first status. On its own, because PostgreSQL does not
-- allow a new enum value to be used in the transaction that adds it.
ALTER TYPE "SubmissionStatus" ADD VALUE 'Acknowledged - Awaiting Payment' BEFORE 'Received - Under Review';
