-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('ACKNOWLEDGEMENT', 'EVALUATION_FORM', 'DEFICIENCY_NOTICE', 'CERTIFICATE');

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "deficiencyNoticeId" TEXT,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "note" TEXT,
    "generatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneratedDocument_submissionId_idx" ON "GeneratedDocument"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedDocument_submissionId_kind_version_key" ON "GeneratedDocument"("submissionId", "kind", "version");

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_deficiencyNoticeId_fkey" FOREIGN KEY ("deficiencyNoticeId") REFERENCES "DeficiencyNotice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The stored file must match its recorded hash and size, and must be a PDF.
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_size_matches" CHECK ("sizeBytes" = octet_length("content"));

-- Issued documents are records: never deleted, and the stored file never changes.
CREATE TRIGGER "GeneratedDocument_no_delete" BEFORE DELETE ON "GeneratedDocument"
  FOR EACH ROW EXECUTE FUNCTION ogserc_reject_change();

CREATE FUNCTION ogserc_generated_document_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."content" IS DISTINCT FROM OLD."content"
     OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
     OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
     OR NEW."fileName" IS DISTINCT FROM OLD."fileName"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."submissionId" IS DISTINCT FROM OLD."submissionId"
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

CREATE TRIGGER "GeneratedDocument_immutable" BEFORE UPDATE ON "GeneratedDocument"
  FOR EACH ROW EXECUTE FUNCTION ogserc_generated_document_immutable();
