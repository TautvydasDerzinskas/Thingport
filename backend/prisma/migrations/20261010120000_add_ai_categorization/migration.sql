-- Preserve the distinction between an existing category and a category chosen after AI categorization.
CREATE TYPE "CategorySource" AS ENUM ('MANUAL', 'RULE', 'AI', 'LEGACY');

ALTER TABLE "Print"
  ADD COLUMN "categorySource" "CategorySource",
  ADD COLUMN "aiSuggestion" JSONB,
  ADD COLUMN "aiRejectedCategoryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Existing assignments predate provenance tracking, so their origin cannot be inferred safely.
UPDATE "Print" SET "categorySource" = 'LEGACY' WHERE "categoryId" IS NOT NULL;
