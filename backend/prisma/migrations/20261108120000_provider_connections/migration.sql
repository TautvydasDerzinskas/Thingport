-- Each provider's sign-in and account in a table of their own, a row per user, provider and auth slot, instead of a
-- column apiece on "User", so a new provider needs no migration. The columns are copied, not moved: they stay one
-- release, unread, so a downgrade still finds them.

-- CreateTable
CREATE TABLE "ProviderConnection" (
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "slot" TEXT NOT NULL DEFAULT 'default',
    "secret" JSONB,
    "expiresAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "accountId" TEXT,
    "accountName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("userId","provider","slot")
);

-- AddForeignKey
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Secrets keep their fields' names as the providers' session.ts read them, nulls included; a sign-in with none left
-- is NULL.
INSERT INTO "ProviderConnection" ("userId", "provider", "secret", "rejectedAt", "updatedAt")
SELECT "id", 'makerworld', jsonb_build_object('cookie', "makerworldCookie"), "makerworldRejectedAt", CURRENT_TIMESTAMP
FROM "User" WHERE "makerworldCookie" IS NOT NULL OR "makerworldRejectedAt" IS NOT NULL;

-- A forgotten Printables account is a turned-down one with no account: Grab's pushes are refused until it's given again.
INSERT INTO "ProviderConnection" ("userId", "provider", "accountId", "accountName", "rejectedAt", "updatedAt")
SELECT "id", 'printables', "printablesUserId", "printablesHandle",
  CASE WHEN "printablesPushOff" THEN CURRENT_TIMESTAMP END, CURRENT_TIMESTAMP
FROM "User" WHERE "printablesUserId" IS NOT NULL OR "printablesHandle" IS NOT NULL OR "printablesPushOff";

INSERT INTO "ProviderConnection" ("userId", "provider", "accountName", "updatedAt")
SELECT "id", 'thingiverse', "thingiverseUsername", CURRENT_TIMESTAMP
FROM "User" WHERE "thingiverseUsername" IS NOT NULL;

INSERT INTO "ProviderConnection" ("userId", "provider", "secret", "rejectedAt", "accountName", "updatedAt")
SELECT "id", 'myminifactory',
  CASE WHEN "myminifactoryCookie" IS NOT NULL THEN jsonb_build_object('cookie', "myminifactoryCookie") END,
  "myminifactoryRejectedAt", "myminifactoryUsername", CURRENT_TIMESTAMP
FROM "User"
WHERE "myminifactoryCookie" IS NOT NULL OR "myminifactoryRejectedAt" IS NOT NULL OR "myminifactoryUsername" IS NOT NULL;

INSERT INTO "ProviderConnection" ("userId", "provider", "secret", "expiresAt", "rejectedAt", "accountId", "updatedAt")
SELECT "id", 'snapmaker', CASE WHEN "snapmakerToken" IS NOT NULL THEN jsonb_build_object('token', "snapmakerToken") END,
  "snapmakerTokenExpiresAt", "snapmakerRejectedAt", "snapmakerUserId", CURRENT_TIMESTAMP
FROM "User" WHERE "snapmakerToken" IS NOT NULL OR "snapmakerUserId" IS NOT NULL OR "snapmakerRejectedAt" IS NOT NULL;

INSERT INTO "ProviderConnection" ("userId", "provider", "secret", "expiresAt", "rejectedAt", "accountId", "updatedAt")
SELECT "id", 'makeronline',
  CASE WHEN "makeronlineToken" IS NOT NULL THEN jsonb_build_object('token', "makeronlineToken") END,
  "makeronlineTokenExpires", "makeronlineRejectedAt", "makeronlineUserId", CURRENT_TIMESTAMP
FROM "User"
WHERE "makeronlineToken" IS NOT NULL OR "makeronlineUserId" IS NOT NULL OR "makeronlineRejectedAt" IS NOT NULL;

INSERT INTO "ProviderConnection" ("userId", "provider", "secret", "expiresAt", "rejectedAt", "accountId", "updatedAt")
SELECT "id", 'crealitycloud',
  CASE WHEN "crealitycloudToken" IS NOT NULL THEN jsonb_build_object('token', "crealitycloudToken") END,
  "crealitycloudExpiresAt", "crealitycloudRejectedAt", "crealitycloudUserId", CURRENT_TIMESTAMP
FROM "User"
WHERE "crealitycloudToken" IS NOT NULL OR "crealitycloudUserId" IS NOT NULL OR "crealitycloudRejectedAt" IS NOT NULL;

INSERT INTO "ProviderConnection" ("userId", "provider", "secret", "expiresAt", "rejectedAt", "updatedAt")
SELECT "id", 'nexprint', CASE WHEN "nexprintToken" IS NOT NULL THEN jsonb_build_object('token', "nexprintToken") END,
  "nexprintExpiresAt", "nexprintRejectedAt", CURRENT_TIMESTAMP
FROM "User" WHERE "nexprintToken" IS NOT NULL OR "nexprintRejectedAt" IS NOT NULL;

INSERT INTO "ProviderConnection" ("userId", "provider", "secret", "expiresAt", "rejectedAt", "accountId", "updatedAt")
SELECT "id", 'thangs',
  CASE WHEN "thangsToken" IS NOT NULL OR "thangsRefreshToken" IS NOT NULL
    THEN jsonb_build_object('token', "thangsToken", 'refreshToken', "thangsRefreshToken") END,
  "thangsExpiresAt", "thangsRejectedAt", "thangsUserId", CURRENT_TIMESTAMP
FROM "User"
WHERE "thangsToken" IS NOT NULL OR "thangsRefreshToken" IS NOT NULL OR "thangsUserId" IS NOT NULL
  OR "thangsRejectedAt" IS NOT NULL;

-- Cults3D has two: its API credentials, and the browser's sign-in its downloads need.
INSERT INTO "ProviderConnection" ("userId", "provider", "secret", "rejectedAt", "updatedAt")
SELECT "id", 'cults3d',
  CASE WHEN "cults3dNick" IS NOT NULL AND "cults3dApiKey" IS NOT NULL
    THEN jsonb_build_object('nick', "cults3dNick", 'apiKey', "cults3dApiKey") END,
  "cults3dApiRejectedAt", CURRENT_TIMESTAMP
FROM "User" WHERE "cults3dApiKey" IS NOT NULL OR "cults3dApiRejectedAt" IS NOT NULL;

INSERT INTO "ProviderConnection" ("userId", "provider", "slot", "secret", "rejectedAt", "updatedAt")
SELECT "id", 'cults3d', 'browser',
  CASE WHEN "cults3dSession" IS NOT NULL
    THEN jsonb_build_object('session', "cults3dSession", 'clearance', "cults3dClearance", 'userAgent', "cults3dUserAgent")
  END,
  "cults3dSessionRejectedAt", CURRENT_TIMESTAMP
FROM "User" WHERE "cults3dSession" IS NOT NULL OR "cults3dSessionRejectedAt" IS NOT NULL;
