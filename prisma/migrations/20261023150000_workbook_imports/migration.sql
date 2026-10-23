-- CreateTable
CREATE TABLE "WorkbookImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedById" TEXT,
    "importedAt" TIMESTAMP(3),
    "summary" TEXT,

    CONSTRAINT "WorkbookImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkbookImport_sha256_idx" ON "WorkbookImport"("sha256");

-- AddForeignKey
ALTER TABLE "WorkbookImport" ADD CONSTRAINT "WorkbookImport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookImport" ADD CONSTRAINT "WorkbookImport_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Uploaded workbooks are a permanent record: never deleted; the file never changes; once imported,
-- nothing changes. The only allowed update is recording the import (importedAt, importedById, summary).
CREATE FUNCTION ogserc_workbook_import_locked() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Uploaded workbooks are never deleted';
  END IF;
  IF OLD."importedAt" IS NOT NULL
     OR NEW."bytes" IS DISTINCT FROM OLD."bytes"
     OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
     OR NEW."fileName" IS DISTINCT FROM OLD."fileName"
     OR NEW."uploadedById" IS DISTINCT FROM OLD."uploadedById"
     OR NEW."uploadedAt" IS DISTINCT FROM OLD."uploadedAt" THEN
    RAISE EXCEPTION 'An uploaded workbook cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WorkbookImport_locked" BEFORE UPDATE OR DELETE ON "WorkbookImport"
  FOR EACH ROW EXECUTE FUNCTION ogserc_workbook_import_locked();
