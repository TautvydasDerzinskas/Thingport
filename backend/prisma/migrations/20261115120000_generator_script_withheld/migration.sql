-- The source published the script a model is generated from, but its creator chose not to share it: the model
-- imports with no script beside it, which is indistinguishable from a model that never had one unless this is
-- recorded. False for everything already here, which is what the default gives them -- nothing to backfill,
-- since the sites are only asked at import.
ALTER TABLE "Print" ADD COLUMN "generatorScriptWithheld" BOOLEAN NOT NULL DEFAULT false;
