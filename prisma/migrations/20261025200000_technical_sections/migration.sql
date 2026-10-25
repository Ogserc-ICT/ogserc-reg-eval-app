-- Category forms REG-01A to REG-01K, part 2: answers to the category-specific ("technical")
-- sections, by form (technical-sections.json). Optional; existing records start with none.
ALTER TABLE "Submission" ADD COLUMN "technicalData" JSONB NOT NULL DEFAULT '{}';
