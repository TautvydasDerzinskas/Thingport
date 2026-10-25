-- The provider columns on "User" and "Category", copied into ProviderConnection and CategorySiteId
-- (20261108120000_provider_connections, 20261109120000_category_site_ids) and unread since.

-- DropIndex
DROP INDEX "Category_crealitycloudCatIds_idx";

-- DropIndex
DROP INDEX "Category_cults3dCatIds_idx";

-- DropIndex
DROP INDEX "Category_makeronlineCatIds_idx";

-- DropIndex
DROP INDEX "Category_makerworldCatIds_idx";

-- DropIndex
DROP INDEX "Category_myminifactoryCatIds_idx";

-- DropIndex
DROP INDEX "Category_nexprintCatIds_idx";

-- DropIndex
DROP INDEX "Category_printablesCatIds_idx";

-- DropIndex
DROP INDEX "Category_snapmakerCatIds_idx";

-- DropIndex
DROP INDEX "Category_thangsCatIds_idx";

-- DropIndex
DROP INDEX "Category_thingiverseCatIds_idx";

-- AlterTable
ALTER TABLE "Category" DROP COLUMN "crealitycloudCatIds",
DROP COLUMN "cults3dCatIds",
DROP COLUMN "makeronlineCatIds",
DROP COLUMN "makerworldCatIds",
DROP COLUMN "myminifactoryCatIds",
DROP COLUMN "nexprintCatIds",
DROP COLUMN "printablesCatIds",
DROP COLUMN "snapmakerCatIds",
DROP COLUMN "thangsCatIds",
DROP COLUMN "thingiverseCatIds";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "crealitycloudExpiresAt",
DROP COLUMN "crealitycloudRejectedAt",
DROP COLUMN "crealitycloudToken",
DROP COLUMN "crealitycloudUserId",
DROP COLUMN "cults3dApiKey",
DROP COLUMN "cults3dApiRejectedAt",
DROP COLUMN "cults3dClearance",
DROP COLUMN "cults3dNick",
DROP COLUMN "cults3dSession",
DROP COLUMN "cults3dSessionRejectedAt",
DROP COLUMN "cults3dUserAgent",
DROP COLUMN "makeronlineRejectedAt",
DROP COLUMN "makeronlineToken",
DROP COLUMN "makeronlineTokenExpires",
DROP COLUMN "makeronlineUserId",
DROP COLUMN "makerworldCookie",
DROP COLUMN "makerworldRejectedAt",
DROP COLUMN "myminifactoryCookie",
DROP COLUMN "myminifactoryRejectedAt",
DROP COLUMN "myminifactoryUsername",
DROP COLUMN "nexprintExpiresAt",
DROP COLUMN "nexprintRejectedAt",
DROP COLUMN "nexprintToken",
DROP COLUMN "printablesHandle",
DROP COLUMN "printablesPushOff",
DROP COLUMN "printablesUserId",
DROP COLUMN "snapmakerRejectedAt",
DROP COLUMN "snapmakerToken",
DROP COLUMN "snapmakerTokenExpiresAt",
DROP COLUMN "snapmakerUserId",
DROP COLUMN "thangsExpiresAt",
DROP COLUMN "thangsRefreshToken",
DROP COLUMN "thangsRejectedAt",
DROP COLUMN "thangsToken",
DROP COLUMN "thangsUserId",
DROP COLUMN "thingiverseUsername";
