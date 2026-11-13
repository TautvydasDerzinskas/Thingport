-- Administration > Migrate, online: the old instance's address and the token its admin made there.
ALTER TABLE "MigrationRun" ADD COLUMN "remote" JSONB;
