-- A widget's labels, by language: { "en": { "key": "text" }, "lt": { … } }. Null for a widget that has none, which
-- is every widget until it ships a locales folder, so nothing needs backfilling.
ALTER TABLE "CustomWidget" ADD COLUMN "locales" JSONB;
