// MakerWorld's bundle: this folder, providers/makerworld/ at the repository's root (its manifest and links, which all
// three packages share), the app's frontend/src/providers/makerworld/ and Grab's extension/src/providers/makerworld/.
// Wired in by providers/registry.ts and providers/routes.ts here, frontend/src/providers/collectionTiles.ts in the
// app, and the tables in extension/src/providers/ in Grab.
//
// Outside them, and why:
// - services/importService.ts: its models import by the shared link import, which every page link of no provider's
//   goes through too (LINK_PROVIDER in providers/registry.ts), woven into the download, plate and print steps there.
//   importResolvers.ts carries its cookie (ImportCookies) and print profile (MakerworldProfileRef) on that import's
//   body and metadata, and importJobRunner.ts tells its sign-in error (MakerworldAuthError) apart, which that import
//   throws as it is.
// - config.ts: IMPORT_MAKERWORLD_CALL_DELAY_MS, its pacing, with the other settings an admin sets by environment
//   variable.
// - services/adminService.ts and routes/admin.ts: whether a user has its cookie, a column of the admin's users list
//   from before Configuration → Providers showed every provider (the app's pages/UsersPage too).
// - The app: utils/settings.ts mirrors its cookie, which App.tsx hands through AppLayout, TopBar, ConfigurationDialog
//   and ProvidersPanel to AddMenu and useUploadImport, for the same link import; utils/translateCategoryDisplay.ts
//   names the starter categories by its ids, as they're its tree.
// - Grab: background/api.ts adds the browser's cookie to an import of its links, as every call to the instance passes
//   there; content/index.ts and content/panels/single.ts resolve its downloads in the page at steps of every
//   provider's import flow, and content/panels/index.ts opens its guided collection panel; shared/storage.ts keeps its
//   keys with the others (normalizeMakerworld, lastSyncedMakerworldCookie).
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.

import type { ProviderTrending } from "../types";
import { fetchMakerworldTrending } from "./api";

export const makerworldTrending: ProviderTrending = { fetch: (_userId, limit) => fetchMakerworldTrending(limit) };

export { makerworldLists } from "./lists";
export { makerworldDetails } from "./details";
