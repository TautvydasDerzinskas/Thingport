-- What a copy of a partner's model needs to be the same model: its tags, creator, source, category and the rest.
ALTER TABLE "RemoteModel" ADD COLUMN "details" JSONB;
