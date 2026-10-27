-- A tool's labels, by language: { "en": { "key": "text" }, "lt": { … } }. Null for a tool that has none, which is
-- every tool until it ships a locales folder, so nothing needs backfilling.
ALTER TABLE "Tool" ADD COLUMN "locales" JSONB;
