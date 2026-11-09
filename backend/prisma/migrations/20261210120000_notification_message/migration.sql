-- A notification's title as a key and values the app translates; `title` keeps the English.
ALTER TABLE "Notification" ADD COLUMN "message" JSONB;
