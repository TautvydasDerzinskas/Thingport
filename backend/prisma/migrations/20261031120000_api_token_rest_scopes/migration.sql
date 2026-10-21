-- What the user's API token may read over the REST API, by scope. Existing tokens get every scope, so
-- the apps using them keep reading what they could before.
ALTER TABLE "User" ADD COLUMN "apiTokenRestScopes" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "User"
SET "apiTokenRestScopes" = ARRAY[
  'search', 'models', 'dashboard', 'activity', 'collections', 'tags', 'categories', 'authors', 'images',
  'files', 'imports', 'other'
]
WHERE "apiTokenHash" IS NOT NULL;
