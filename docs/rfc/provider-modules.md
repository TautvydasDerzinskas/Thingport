# Plan: self-contained provider modules for Thingport

> **Status: done, Phases 0–8.** Where it was built differently from the plan below:
>
> - The generated copies sit beside each package's own provider code, as `src/providers/<id>/*.generated.ts`, not in
>   `_generated/` folders.
> - Phase 7 copies the columns into `ProviderConnection` and `CategorySiteId` without dual writes or fallback reads,
>   and drops them in the same branch. The starter categories' ids are `backend/src/providers/<id>/categories.json`,
>   as only the backend reads them, and the startup seed is SQL.
> - The docs' prose for each provider (`providers/<id>/docs.ts`) is read only by the generator, so no package carries
>   it.
> - Credentials are still stored unencrypted (D9).
>
> The current layout is in [providers/README.md](../../providers/README.md), and the checklist for a new provider in
> [CONTRIBUTING.md](../../CONTRIBUTING.md#adding-a-provider).

All paths below are relative to `/home/sebastian/git/github.com/Thingport`. I only read files. I made no edits and wrote no files.

## Goal

To add a provider, a contributor should only have to add:

- one shared provider folder: manifest, URL parsers, logo and starter-category map;
- one backend provider module;
- an optional extension content module;
- the translation block.

Backend, frontend, extension, web and docs then pick it up without hand edits.

**Acceptance criteria**

1. Re-doing NexPrint (PR #84, 68 files including `migration.sql` and `schema.prisma`) touches at most about 8 hand-written files plus generated output.
2. Missing wiring fails the build:
   - backend `tsc`: registry `satisfies` a mapped type over `ProviderId`;
   - frontend `tsc` plus the i18n test;
   - extension `tsc`;
   - `providers:check` in CI.
3. These stay exactly as they are:
   - provider ids;
   - error codes;
   - every existing HTTP route and payload;
   - the extension's `manifest.json` permissions;
   - `CategoryOut.*_cat_ids`.
4. Every phase ships on its own with unchanged behaviour.

**Assumptions**

- This is an upstream refactor of `TautvydasDerzinskas/Thingport`. CONTRIBUTING.md:8 asks for an issue first for "a new provider, a schema change". This plan should go up as an RFC issue before Phase 1.
- Build-time registry only. No runtime plugins: they would put user credentials within reach of third-party code, and the extension needs per-site code anyway.

---

## 1. What each provider supports today

Abbreviations:

- **IS** = `backend/src/services/importService.ts`
- **ST** = `backend/src/routes/settings.ts`
- **IR** = `backend/src/routes/imports.ts`
- **CSS** = `collectionSyncService.ts`
- **CSR** = `collectionSyncRunner.ts`
- **TR** = `providerTrendingService.ts`
- **FE** = `frontend/src`
- **EXT** = `extension/src`

### Auth, profiles, collections, trending

| Provider      | Auth kind and storage                                                                                                                                                                      | Import / profiles                                                                                                                                                                                         | Collections, likes, sync                                                                                                                                         | Trending (TR:57-118)          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| makerworld    | User cookie: `User.makerworldCookie`/`RejectedAt` (schema:61-63). ST:683/705, verified via FlareSolverr (ST:691-701). Public pages import without a login (`providerImports.test.ts:395`). | Own path at IS:2360-2417. Profiles via `addMakerworldProfileToPrint` IS:1024. Profiles job IR:990. Also cloud API, captcha (`makerworldCaptcha.ts`), extension page data (IS:374), zip-to-plates IS:2421. | Collections: browse (bearer), sync (CSR:119), guided extension job (`EXT/content/panels/makerworldCollection.ts`). No likes.                                     | trending                      |
| thingiverse   | Instance App Token (`settingsService.ts:190`, ST:487/495). Per-user `thingiverseUsername`. Health check `systemHealthService.ts:190`.                                                      | Generation 1, copy-pasted create block IS:1163-1264, concurrency 2 (IS:1124).                                                                                                                             | Collections and likes, anyone's (IR:374/412, 1070/1089; CSR:140).                                                                                                | popular, needs instance key   |
| printables    | None. `printablesUserId`/`Handle`/`PushOff` (schema:66-70).                                                                                                                                | Generation 1, IS:1266-1364.                                                                                                                                                                               | Collections (public via API) plus private ones and likes pushed by Grab (`providerListingsService.ts`, routes `/provider-collections/printables/{wanted,push}`). | trending                      |
| myminifactory | Instance API key (`settingsService.ts:212`, ST:513/528) plus optional user PHPSESSID (schema:75-77, ST:729/742). Username. Health check `systemHealthService.ts:204`.                      | Generation 1, IS:1484, library fallback IS:1428. Paid models supported.                                                                                                                                   | Collections by username/slug (IR:485/1137, CSR:153).                                                                                                             | popular, needs instance key   |
| snapmaker     | User JWT, about 1 day (schema:80-85, ST:770/783). Grab renews it on an alarm (`EXT/background/snapmakerSession.ts`).                                                                       | `createSourcedPrint` (IS:1653, add profile IS:1762). Profiles job IR:1007.                                                                                                                                | Own likes and bookmarks only (IR:538/1158, CSR:161). Owner gate in extension `content/index.ts:125-135`.                                                         | featured                      |
| makeronline   | Optional user token, for likes and private collections (schema:88-93, ST:815/827). Files only through Grab-signed links (`resolved_files`, IS:2229, error code `makeronline_grab`).        | IS:2224, add profiles IS:2246. `GrabImport` queue (`grabImportService.ts`, IR:800-952).                                                                                                                   | Collections and likes (CSR:168).                                                                                                                                 | trending                      |
| crealitycloud | User cookie header (`model_token` + `model_user_id`) (schema:96-101, ST:860/874).                                                                                                          | IS:1833. Alias re-key: `externalId` is replaced by the resolved alias (IS:1847). Profiles job IR:1021.                                                                                                    | Collections need no sign-in; own likes need it (IR:610/1188, CSR:179).                                                                                           | recommended                   |
| nexprint      | User bearer token (`auth_token`) (schema:104-107, ST:903/917).                                                                                                                             | IS:1955/2002. Profiles job IR:1035. Ids uppercased (IR:1232).                                                                                                                                             | Collections need no sign-in (IR:654/1218, CSR:192).                                                                                                              | recommended                   |
| thangs        | User access + refresh token. The server refreshes it (`withThangsToken`, ST:947/962). Daily download limit, error code `THANGS_DOWNLOAD_LIMIT` (IS:178).                                   | IS:2081. Print-only and paid models are refused (IS:2056).                                                                                                                                                | Collections and likes (IR:709/1245, CSR:198).                                                                                                                    | trending                      |
| cults3d       | Composite auth, two slots: API nick + key (ST:1001/1020) and browser session `_session_id` + `cf_clearance` + user agent (ST:1056).                                                        | IS:2147. Places free orders, refuses paid models, Cloudflare blocks reported as `CLOUDFLARE_BLOCKED` (IS:2131).                                                                                           | Printlists and anyone's likes (IR:767/1275, CSR:213).                                                                                                            | popular, needs the user's key |

### Facts that hold for all ten providers

- **Author linking.** All ten (`authorLinkingService.ts:213-263`). Exceptions: cults3d needs a user's key; makerworld goes via the cookie or a page scrape.
- **Fill gaps.** All ten (`fillGapsService.ts:43-151`). Every non-makerworld branch has the same shape: `resolveXModel(externalId)` plus `emptyImportedPageMetadata()`.
- **Description refetch.** All ten (`descriptionRefetchService.ts:20`).
- **Category ids** (IS:838-852):
  - Int columns: makerworld, thingiverse, printables, myminifactory, snapmaker, makeronline, crealitycloud, cults3d.
  - Text columns: nexprint (16 digits) and thangs (category paths).
  - Seed data lives in `seedData/defaultCategories.ts` (556 hits). Each new provider so far also needed an SQL backfill (see the nexprint migration).
- **Admin enable/disable.** All ten (`providerSettingsService.ts:9`). `providerOfUrl` (line 59) assumes the host is `<id>.com`, which only works by luck.
- **API token scopes.** Only `/import/makeronline/waiting` is provider-specific (`apiTokenScopes.ts`, "imports" scope). Every `/settings/*-session` GET falls under "other".
- **Extension sites.**
  - Built in: makerworld, printables, thingiverse (`EXT/../scripts/manifest.ts:11`, cookie hosts for makerworld and printables only, line 12).
  - Optional: the other seven (`EXT/shared/optionalSites.ts:12-21`).
  - Session sync: one file per provider (`EXT/background/*Session.ts`), wired at `background/index.ts:20-53`.
  - Profile loaders: `content/panels/single.ts:61-67`.

### Duplication found (each list exists 3–14 times)

- **Provider id lists:**
  - `providerSettingsService.ts:9`, `providerCollectionsService.ts:106`, `CSS:76`, `TR:20`, `authorLinkingService.ts:33`, `descriptionRefetchService.ts:20`, `importResolvers.ts:~498`;
  - frontend: `useDisabledProviders.ts` ALL, `api/settings.ts:247`, `providerLogos.tsx:6`, `importLinkDetection.ts:3`, `AddMenu.tsx:60`, `CollectionSyncBadge.tsx:13`, `SyncChain.tsx:28`, `ProvidersPage.tsx:32/127`, `GlobalSearch/pages.ts:80`, `UserMenu.tsx:30`;
  - extension: `urls.ts:3`.
- **Display names:** `providerSettingsService.ts:23`, `CSS:92`, `importJobRunner.ts:397-417`, `LogsPage/index.tsx:168`, `ProvidersPage.tsx:32`, `ProvidersPanel.tsx:32`, `EXT/funStatus.ts`, `EXT/syncToggle.ts`.
- **Logos and colours in three places, and they disagree:** `FE/.../providerLogos.tsx:31`, `EXT/popup/sites.ts:22`, and `FE/constants/importProviders.ts`. MakerWorld's logo is `#00AE42` but its chip is `#00B800`; MyMiniFactory's is `#00C4A6` vs `#00866F`.
- **URL parsers in three places:** backend `*Api.ts`, `FE/utils/importLinkDetection.ts`, and `EXT/shared/urls.ts`, whose line 1 says "Keep in sync by hand".
- **Model URL builders, twice:** `buildImportSourceUrl` IS:956 and `modelUrlFor` CSS:238.
- **Profile providers, twice:** `PROFILE_PROVIDERS` IS:2309 and `hasProfiles` CSS:106.

### Inconsistencies to keep during the port and fix in separate `fix:` commits

- Fixed in #152: `classifyImportFailure` not treating `myminifactory_session` as "auth", `providerOfUrl` deriving the
  host from the provider id, and the quirks the contract tests pinned (Snapmaker reusing a rejected token, Cults3D's
  bare 500 and fill gaps without a session code, fill gaps' tag casing, Creality Cloud's import status by id).
- Snapmaker's error says 400 in places where others use 404.

### Escape hatches the design must allow

| Provider      | Bespoke parts                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| makerworld    | Whole import path, captcha, cookie verification, guided collection job, page-data trust                   |
| makeronline   | Files only via Grab, `GrabImport` routes                                                                  |
| printables    | Grab push of private lists                                                                                |
| cults3d       | Composite auth, frontend status `cults3dStatus.ts`                                                        |
| crealitycloud | Alias re-key                                                                                              |
| snapmaker     | Likes/bookmarks switch (`EXT/content/panels/batch.ts:96`), list naming (`ProviderCollectionTile.tsx:497`) |

---

## 2. Interface design

### 2a. Shared manifest

Lives in `providers/<id>/manifest.ts`. It is pure data, with no imports except `providers/_lib`.

```ts
// providers/_lib/types.ts
export type Need = "required" | "recommended" | "optional" | "none";
export type ListKind = "collection" | "likes" | "bookmarks";
export type Logo = {
  viewBox?: string;
  color: string;
  path: string;
  fillRule?: "evenodd";
  layers?: { d: string; color: string }[];
};

export type AuthField = { name: string; kind: "secret" | "text"; multiline?: boolean; maxLength: number };
export type AuthSlot = {
  slot: "default" | "browser"; // cults3d has two
  scope: "instance" | "user";
  fields: readonly AuthField[];
  neededFor: "everything" | "downloads" | "likes" | "paid";
  renewal: "none" | "grab" | "grabAlarm" | "server";
  verifiable: boolean;
  legacyEndpoint: string; // "/settings/nexprint-session" — kept forever
};

export type ProviderManifest<Id extends string = string> = {
  id: Id; // persisted in DB: never change
  name: string;
  order: number;
  site: string;
  docsSlug: string;
  hosts: { exact: readonly string[]; suffix?: readonly string[] }; // replaces providerOfUrl's `${id}.com`
  brand: { chipBg: `#${string}` | "text"; chipFg?: `#${string}` | "dark" | "auto"; logo: Logo };
  auth: readonly AuthSlot[]; // [] = none (printables)
  helpers: { grab: Need; flaresolverr: Need };
  capabilities: {
    profiles:
      false | { scopes: readonly ("url" | "designer" | "all")[]; filesVia: "server" | "grab"; jobRoute: boolean };
    lists: false | { kinds: readonly ListKind[]; ownOnly?: readonly ListKind[]; sync: boolean; browse: boolean };
    trending:
      | false
      | {
          kind: "trending" | "popular" | "featured" | "recommended";
          moreUrl: string;
          needs?: "instanceKey" | "userKey";
        };
    categories: false | { idType: "int" | "text" };
    accountIdentity: false | { kind: "username" | "handle" | "nick"; reportedByGrab: boolean };
    authorLookup: boolean;
    fillGaps: boolean;
    descriptionRefetch: boolean;
    paidModels: boolean;
  };
  extension: {
    site: "builtin" | "optional"; // "builtin" frozen to the legacy 3 (checked)
    origins: readonly string[];
    sessionSync?:
      { cookieUrl: string; cookies: readonly string[]; pattern: string; send: "token" | "cookieHeader" } | "custom";
    content: "generic" | "custom";
  };
  errorCodes: { session?: string; downloadLimit?: string; needsGrab?: string }; // exact legacy strings
  legacy: {
    list?: { entries: string; start: string; idField: "thing_ids" | "model_ids" | "object_ids" | "design_ids" }[];
    profilesRoute?: string;
  };
  examples: { model: string; list?: string }; // IMPORT_LINK_EXAMPLES, SyncBrowse placeholders
};
export const defineProvider = <const M extends ProviderManifest>(m: M) => m;
```

URL module, in `providers/<id>/urls.ts`. Pure functions that use only `URL`, shared by all three packages:

```ts
export interface ProviderUrls {
  parseModel(url: string): { externalId: string; requestedProfileId: string | null } | null;
  modelUrl(externalId: string): string; // replaces buildImportSourceUrl + modelUrlFor
  modelIdFromUrl?(url: string): string | null;
  parseList?(url: string): { kind: ListKind; externalId: string; url: string; likesOf?: string } | null; // replaces parseSyncSource branches
  normalizeId?(id: string): string; // nexprint uppercasing
}
```

`providers/_generated/index.ts`, emitted by the generator:

- `PROVIDER_IDS` as a const tuple, in `order`;
- `type ProviderId`;
- `MANIFESTS: { [K in ProviderId]: Manifest<K> }`;
- `URLS: Record<ProviderId, ProviderUrls>`;
- `detectProvider(url)`;
- `classifyUrl(url)`.

### 2b. Backend provider interface and registry

Provider code lives in `backend/src/providers/<id>/`. The capability flags in the manifest decide at compile time which methods must exist:

```ts
export type ProviderCtx = { userId: string; body: ImportRequestBody };
export type ResolvedModel = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  profiles?: ProfileInfo[];
};

interface BaseImpl {
  connection: ConnectionStore; // status(userId) -> per slot "connected"|"disconnected"|"expired" (+account);
  // save(userId, slot, raw, {verify}) incl. normalize+verify (ST:768-996 bodies);
  // require(userId) -> creds | throws HttpError(400, connectMsg, manifest.errorCodes.session);
  // markRejected(userId, slot)
  resolveModel(ctx: ProviderCtx, externalId: string): Promise<ResolvedModel | null>; // import, fillGaps, refetch, authorLookup default
  downloadFiles(ctx: ProviderCtx, model: ResolvedModel, want: { profileId: string | null }): Promise<NewPlateInput[]>;
  mapError?(ctx: ProviderCtx, err: unknown): Promise<unknown>; // replaces *Failure() (IS:1622,1802,1927,2044,2120)
  canonicalSource?(model: ResolvedModel): { externalId: string }; // crealitycloud alias (IS:1847)
  lookupAuthor?(ctx: ProviderCtx, externalId: string): Promise<ImportedAuthorInfo | null>;
  health?(): Promise<HealthFound>; // instance-key providers
  routes?(router: Router): void; // makeronline waiting, printables push, makerworld captcha
  importOverride?(ctx: ProviderCtx, url: string, existing: ExistingImportedPrint | null): Promise<ImportResult>; // makerworld only
}
type ProfilesImpl = {
  select(m: ResolvedModel, scope: Scope, requested: string | null): string[];
  details(m: ResolvedModel): ProfileDetails;
};
type ListsImpl = {
  entries(
    ctx: ProviderCtx,
    url: string,
  ): Promise<{ title: string; total: number; truncated: boolean; entries: ListEntry[] }>;
  browse?(ctx: ProviderCtx): Promise<ProviderCollectionCard[]>; // providerCollectionsService.ts:469-525
  fetchListing(sync: SyncRef): Promise<string[] | null>; // CSR:115-226
  connectionProblem?(sync: SyncRef): Promise<ConnectionProblem | null>; // CSR:269-435
};

type Impl<M extends ProviderManifest> = BaseImpl &
  (M["capabilities"]["profiles"] extends false ? { profiles?: never } : { profiles: ProfilesImpl }) &
  (M["capabilities"]["lists"] extends false ? { lists?: never } : { lists: ListsImpl }) &
  (M["capabilities"]["trending"] extends false
    ? { trending?: never }
    : { trending(ctx: ProviderCtx): Promise<TrendingModel[] | TrendingSetup> });

// backend/src/providers/registry.ts — the ONE hand-edited line per provider
export const PROVIDERS = {
  makerworld,
  thingiverse,
  printables,
  myminifactory,
  snapmaker,
  makeronline,
  crealitycloud,
  nexprint,
  thangs,
  cults3d,
} satisfies { [K in ProviderId]: Impl<Manifests[K]> & { manifest: Manifests[K]; urls: ProviderUrls } };
```

**Generic pipeline** in `backend/src/providers/importPipeline.ts`. It replaces IS:2319-2358 and the three copy-pasted blocks:

1. identify;
2. find existing;
3. if the provider has profiles, add a profile (generalises IS:1762, 1885, 2002); otherwise return `alreadyImported`;
4. `assertProviderEnabled`;
5. `connection.require`;
6. `resolveModel`, then `canonicalSource`;
7. `downloadFiles`, with temp-file cleanup;
8. `createSourcedPrint` (IS:1695).

Other generic replacements:

- `classifyImportFailure`, `authStopText` and `downloadLimitSite` (`importJobRunner.ts:127, 1208, 1218`) read `manifest.errorCodes` and `manifest.name`.
- The generic URL fallback (IS:2360) is split out of the makerworld path into `importGenericUrl`.

### 2c. How the frontend gets manifests

**Static data is bundled** (generated copy), for type safety and logos without network.

**Runtime state comes from a new endpoint** `GET /api/providers`:

```json
{
  "providers": [
    {
      "id": "nexprint",
      "enabled": true,
      "slots": { "default": { "status": "connected", "account": null, "expires_at": null } },
      "ready": true
    }
  ]
}
```

- This replaces the ten `getXSession` calls in `ProvidersPanel.tsx:114-188`, the duplicated state in `UserMenu.tsx:70-130`, and `useDisabledProviders`.
- The frontend shows the intersection of the bundled manifests and the ids the backend lists. That covers version skew between separately versioned images in both directions.
- `/settings/providers` stays for the extension (`EXT/content/providerSettings.ts:13`).

**API-token scope:** `/providers` and `/providers/:id/connection` are settings data, so I'd leave them under "Everything else". No `apiTokenScopes.ts` change and no migration.

### 2d. Generic UI

| Element                    | Comes from                                                                                                                                           | Replaces                                                                                                                                                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect form               | `auth[].fields` → generic `ConnectBox` (multiline, secret, two fields)                                                                               | the per-id `if` chain at `ProvidersPanel.tsx:200-246` and `:510-515`                                                                                                                                                                                                                                           |
| Lock / shared / admin-only | `auth[].scope === "instance"`                                                                                                                        | `SHARED`, `SESSION_PROVIDERS` (`ProvidersPanel.tsx:47-66`), `KEYED` (`ProvidersPage.tsx:45`)                                                                                                                                                                                                                   |
| Chips, colours, logos      | manifest `brand` → `theme.thingport.providers[id]` built in `theme.ts`, so components still read colours from the theme                              | `importProviders.ts`, `providerFacts.ts`, `providerLogos.tsx`                                                                                                                                                                                                                                                  |
| Link detection / dispatch  | `classifyUrl` → `{provider, kind, listKind}`; `useUploadImport`/`AddMenu` call `importsApi.listEntries(provider, …)` and `startList`/`startProfiles` | `importLinkDetection.ts` `is*Url`; about 20 callbacks in `ImportJobContext.tsx`; per-provider functions in `api/imports.ts`                                                                                                                                                                                    |
| Menus, lists               | `capabilities.lists`/`.profiles`/`.categories`/`.trending`                                                                                           | `AddMenu`, `UserMenu`, `CollectionSyncBadge`, `SyncChain`, `SyncBrowse`, `CategoryMetaDialog`, `CategoryManager`, `ProviderCategoryMappings.MAPPED_PROVIDERS`, `api/dashboard.ts` `TRENDING_PROVIDERS`, `LogsPage` names, `GlobalSearch/pages.ts` keywords, `DashboardPage/templates.ts`, `IconPicker` catalog |
| Admin toggles              | loop over `PROVIDER_IDS`                                                                                                                             | `ProvidersPage.tsx:127`                                                                                                                                                                                                                                                                                        |

Escape hatch:

```ts
// frontend/src/providers/overrides.ts
type ProviderUi = {
  status?(s: ProviderState, t: TFunction): string | undefined;
  ConnectExtra?: React.FC<{ state: ProviderState }>;
  CollectionTile?: React.FC<{ collection: ProviderCollection }>;
  listName?(c: ProviderCollection, t: TFunction): string | undefined;
};
export const PROVIDER_UI: Partial<Record<ProviderId, ProviderUi>> = {
  cults3d: { status: cults3dStatus, ConnectExtra: Cults3dBrowserSignIn },
  snapmaker: { listName: snapmakerListName },
};
```

There is one generic `ProviderCollectionTile`. Keep the bespoke tiles from `TILES` (`ProviderCollectionTile.tsx:482`) only where they really differ.

### 2e. Extension

- **URLs and sites.** `shared/urls.ts` becomes a re-export of the generated `classifyUrl`.
- **Optional sites.** `OPTIONAL_SITES` comes from the manifests.
- **Built-in matches and cookie hosts.** `scripts/manifest.ts:11-12` reads `site: "builtin"`, behind a snapshot check: the built-in set equals the legacy three and `manifest.json` output is byte-identical. Otherwise browsers disable Grab for all users (`extension/CONTRIBUTING.md` "Adding a provider site").
- **Session sync.** One generic `background/sessionSync.ts` driven by `sessionSync` (nexprint, crealitycloud, myminifactory). Custom modules for snapmaker (alarm), thangs (refresh), cults3d (clearance + user agent), makerworld and makeronline.
- **Messages.** `SYNC_<X>_SESSION` (`messages.ts`) becomes `SYNC_PROVIDER_SESSION {provider}`. These messages are internal to the bundle, so no compatibility issue.
- **Storage keys.** The eight `lastSynced*` keys (`storage.ts:20-63`) become `lastSyncedSessions[id]`. One idempotent re-send per user is acceptable; keep `lastSyncedMakerworldCookie` as is.
- **Content modules.** `extension/src/content/providers/<id>.ts` with `{ loadProfiles?, blockReason?, ownerGate? }`, typed as `{ [K in ProviderId]: ContentModule }`. Replaces `single.ts:61-67, 95, 151-177` and `content/index.ts:125-145`.
- **Endpoints.** The extension keeps calling the legacy per-provider endpoints listed in `manifest.legacy`. Store versions lag, and those routes exist on every backend.

---

## 3. Shared-package mechanics

### Constraints I checked

- There is no npm workspace. Each of `backend/`, `frontend/`, `extension/`, `web/` and `regression/` has its own lockfile.
- Docker build contexts are `./backend` and `./frontend`: `docker-compose.yml:30/64`, `regression/docker-compose.yml:22/51`, `manual-image.yml:34/51`, `frontend-image.yml:75`.
- CI path filters are per folder (`backend-image.yml:9-18`).
- semantic-release-monorepo versions each folder separately.
- Module systems differ: backend is CommonJS with `moduleResolution: node` and `rootDir: src` (`backend/tsconfig.json:4-8`); frontend and extension use ESNext with Bundler resolution.

### Options

| Option                                                                            | Verdict                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. npm workspaces + `packages/providers`**                                      | Rejected. It needs repo-root Docker contexts (4 compose/workflow files), one merged lockfile, dual CJS/ESM output, new path filters, and changes to release attribution. Large blast radius for no runtime gain.                              |
| **B. tsconfig path / relative `../../providers`**                                 | Rejected. Breaks the Docker context and `rootDir: src`.                                                                                                                                                                                       |
| **C. Canonical `providers/` at the root, committed generated copies per package** | **Recommended.** The repo already does this: `backend/scripts/syncProviderCategories.ts` writes into `frontend/src/components/categoryMapping/providerCategories.json`, and `frontend icons:sync` writes `backend/src/mcp/builtinIcons.json`. |

### How C works

- **Source:** `providers/_lib/*.ts` plus `providers/<id>/{manifest.ts, urls.ts, urls.fixtures.json, logo.svg?, categories.json}`. Erasable TypeScript only (no enums, no namespaces), no runtime dependencies.
- **Generator:** `scripts/sync-providers.ts`, run with `tsx` added to the root devDependencies. Node 24 type-stripping can't resolve the extensionless imports that the backend's `moduleResolution: node` needs. The generator copies the TS sources verbatim, formats them with the root's Prettier, and emits:
  - `backend/src/providers/_generated/**`
  - `frontend/src/providers/_generated/**`
  - `extension/src/shared/providers/_generated/**`
  - `web/src/lib/providers.generated.json` (data only)
  - `docs/assets/providers/<docsSlug>.svg`
  - the table block in `docs/PROVIDER_SETUP.md` between markers

  Every output starts with a "GENERATED — do not edit" header.

- **Root scripts:** `providers:sync` and `providers:check` (regenerate into a temp directory and diff).
- **CI:** add `providers:check` to `format.yml`, which runs on every PR. The copies live inside each package, so the existing path filters and per-package versioning trigger correctly.
- **Pre-commit:** add `"providers/**": () => "npm run providers:sync"` to `lint-staged.config.js`, and stage the outputs.
- **Dockerfiles:** no change. **Web:** `site.mjs` spreads `DOCS` entries built from the generated JSON.

---

## 4. i18n

**Today:** about 175 provider-specific keys spread over:

- `app.providers.<id>` (54)
- `app.providerAbout.providers.<id>` (41)
- `app.adminSettings.providers.descriptions.<id>`
- `app.adminSettings.health.components`
- `app.userMenu.<id>DisabledReason`
- `models.collections.sync.browse.notConnected.<id>`, `usernameHint`, `usernamePlaceholder`

There are four locales (en, lt, fr, es). The no-code translation workflow (`docs/TRANSLATING.md`: copy `en.json`) and `scripts/i18n-check.mjs` both assume one file per language.

**Recommendation:** keep one file per language and add a top-level `providers` namespace in each locale JSON. Add it to `NAMESPACES` (`frontend/src/i18n/index.ts:10`).

- Fixed key layout: `providers:<id>.{connect.steps, connect.placeholder, connect.<field>Label, status.notConnected, status.expired, status.expiredStatus, about.{summary,signIn,grab,setup}, admin.description, sync.notConnected, sync.usernameHint?, health?}`.
- Generic strings with `{{name}}` stay in `app`.

**Enforcement:** a frontend vitest test derives the required keys per provider from its manifest (auth slots → `connect.*` and `status.*`; `lists.browse` → `sync.notConnected`; `accountIdentity` → `usernameHint`). It asserts those keys exist in `en.json` and in every other locale. A forgotten translation fails `npm run verify`.

**Moving the keys:** a one-off script `frontend/scripts/move-provider-keys.mjs` moves the keys in all four files and keeps existing translations. Check by running `i18n:check` before and after: identical "missing" counts.

**Not part of this:**

- Backend `HttpError` texts are English and not translated today. They move into each provider's backend module.
- Extension strings are English too and come from `manifest.name`.

**Rejected:** per-provider locale fragments merged at build time. That breaks the copy-`en.json` workflow and `i18n:check`.

---

## 5. Migration in phases

Every PR keeps behaviour unchanged. Effort is in developer-days (d). Order:

- 0 is the safety net.
- 1–2 are shared data and URLs.
- 3–4 are the backend.
- 5 is the frontend.
- 6 is the extension.
- 7 is the database.
- 8 is docs.

### Phase 0 — Safety net (see §6) — 6–8 d

| #   | Step                                                                                                                                                                                              | Files                                                                                                                                                                                                                 | d   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 0.1 | URL corpus per provider (models, lists, lang prefixes, `www`, hashes) plus a cross-implementation comparison. Record and decide each divergence.                                                  | `providers/<id>/urls.fixtures.json` (create early); `backend/tests/urlCorpus.test.ts`; `frontend/src/utils/importLinkDetection.test.ts`; add vitest to `extension/package.json` + `extension/src/shared/urls.test.ts` | 2   |
| 0.2 | Contract and characterisation tests for the five providers without end-to-end import tests: makeronline, crealitycloud, nexprint, thangs, cults3d. Plus `fetchListing` and fill-gaps for all ten. | `backend/tests/providers/contract.ts`, `<id>.contract.test.ts`, fixtures                                                                                                                                              | 4–5 |
| 0.3 | Freeze tests: provider ids, error codes, `CategoryOut` keys, Express route+method inventory, extension `buildManifest()` output for chrome, firefox and edge.                                     | `backend/tests/providerFreeze.test.ts`, `extension/scripts/manifest.test.ts`                                                                                                                                          | 1   |

### Phase 1 — Manifests and generator, read-only consumption — 5–7 d

| #   | Step                                                                                                                                                                                                                                                                                                                 | Files                                                                                                                                                                                                                                                                                                                          | d   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| 1.1 | `providers/_lib`, ten manifests (data copied from `providerFacts.ts`, `importProviders.ts`, `providerLogos.tsx`, `optionalSites.ts`, `PROVIDER_NAMES`), generator, `providers:check` in CI, lint-staged hook, `tsx` at root.                                                                                         | `providers/**`, `scripts/sync-providers.ts`, `package.json`, `.github/workflows/format.yml`, `lint-staged.config.js`                                                                                                                                                                                                           | 2–3 |
| 1.2 | Backend id and name lists from manifests: `PROVIDERS`/`PROVIDER_NAMES`/`providerOfUrl` (`providerSettingsService.ts:9,23,59`, using `hosts`), `BROWSABLE_PROVIDERS`, `SyncProvider`/`PROVIDER_NAMES` (CSS:76,92), `TRENDING_PROVIDERS`, `LOOKUP_PROVIDERS`, `SOURCE_PROVIDERS`, `ImportedPageMetadata.categorySite`. | about 8 backend files                                                                                                                                                                                                                                                                                                          | 1   |
| 1.3 | Frontend lists, names, logos, colours from manifests; colours exposed through `theme.thingport.providers`. Check light and dark visually.                                                                                                                                                                            | `importProviders.ts`, `providerFacts.ts`, `providerLogos.tsx`, `theme.ts`, `useDisabledProviders.ts`, `api/settings.ts`, `api/dashboard.ts`, `AddMenu`, `UserMenu` types, `CollectionSyncBadge`, `SyncChain`, `SyncBrowse`, `ProvidersPage`, `LogsPage`, `GlobalSearch/pages.ts`, `ProviderCategoryMappings`, `iconCatalog.ts` | 2   |
| 1.4 | Extension names and logos: `popup/sites.ts` LOGOS, `funStatus`, `syncToggle`, `OPTIONAL_SITES`.                                                                                                                                                                                                                      | 4 files                                                                                                                                                                                                                                                                                                                        | 0.5 |

### Phase 2 — One set of URL parsers — 3–4 d

Move each `parse*Url`/`*ModelUrl` into `providers/<id>/urls.ts`, one PR per three or four providers. The backend `*Api.ts` files re-export them so test imports keep working. `importLinkDetection.ts` and `EXT/shared/urls.ts` become thin wrappers over `classifyUrl`. One `modelUrl` replaces IS:956 and CSS:238/252. The 0.1 corpus tests guard each PR.

### Phase 3 — Backend registry and providers — 18–24 d

| #   | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | d   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 3.1 | `backend/src/providers/{types.ts, registry.ts, importPipeline.ts}`. Registry entries first just wrap the existing functions. Route everything through the registry: `identifySourceModel` (IS:888), `requestedProfileOf` (IS:913), `PROFILE_PROVIDERS`/`hasProfiles`, `fetchSourceMeta`, `lookUpAuthor`, trending `SOURCES`, `CATEGORY_SITE_CAT_IDS_FIELD` (IS:838; the column name is still in the adapter), `classifyImportFailure`/`authStopText`.                                   | 3   |
| 3.2 | **Pilot: NexPrint.** Move `nexprintApi.ts` and `nexprintSessionService.ts` into `providers/nexprint/`, implement `resolveModel`/`downloadFiles`/`profiles`/`lists`/`connection`, delete IS:1911-2025, use the generic batch and profiles runners (`importJobRunner.ts:389-417, 643-733`). Why NexPrint: newest and cleanest code; covers user token, profiles, collections, text category ids, optional extension site and simple cookie sync; PR #84 is a ready-made list to tick off. | 3   |
| 3.3 | `createSourcedPrint`-generation providers, one PR each: snapmaker, crealitycloud (alias), thangs (refresh, download limit), cults3d (two slots, Cloudflare code), makeronline (`filesVia: "grab"`, its routes via `routes()`).                                                                                                                                                                                                                                                          | 6–8 |
| 3.4 | Generation 1: thingiverse (concurrency 2, instance token, `health`), printables (download-link step, `routes()` for push), myminifactory (key plus library session, zip). Deletes the copy-pasted blocks IS:1163-1364 and 1484-1576.                                                                                                                                                                                                                                                    | 4–5 |
| 3.5 | **MakerWorld last.** First `importOverride` wrapping IS:1024 and IS:2360-2417, with `importGenericUrl` split out for non-provider links. Then port `profiles` and `lists`; keep captcha, cookie verification and the cloud API inside its folder.                                                                                                                                                                                                                                       | 3–5 |

### Phase 4 — Generic backend routes — 5–6 d

- Add these generic routes:
  - `GET /providers`
  - `GET/PATCH /providers/:id/connection[/:slot]`
  - `POST /import/:provider/list/entries`
  - `POST /import/:provider/list`
  - `POST /import/:provider/profiles`
- Register legacy aliases for every path in `manifest.legacy` and `auth[].legacyEndpoint` on the same handler, with the same payload field names (`thing_ids`, `object_ids`, …).
- Remove the per-provider route bodies from:
  - `routes/settings.ts:483-1069`
  - `routes/imports.ts:374-1290`
  - `routes/providerCollections.ts`
- Remove the per-provider branches in `providerCollectionsService.ts:139-525`, CSR:115-435 and `parseSyncSource` (CSS:134-236).
- The route inventory test from 0.3 must still pass.

### Phase 5 — Frontend generic UI — 7–9 d

| #   | Step                                                                                                                      | d   |
| --- | ------------------------------------------------------------------------------------------------------------------------- | --- |
| 5.1 | `useProviders()` on `GET /providers`, replacing `useDisabledProviders` and the per-provider session getters.              | 1   |
| 5.2 | `ProvidersPanel` generic `ConnectBox` plus `PROVIDER_UI` overrides (cults3d); `UserMenu` chips as a loop.                 | 2   |
| 5.3 | `api/imports.ts`, `ImportJobContext`, `useUploadImport`, `AddMenu` generic dispatch.                                      | 2   |
| 5.4 | Sync UI (`SyncBrowse`, `ProviderCollectionTile` generic tile plus overrides), category mapping UI, admin `ProvidersPage`. | 1.5 |
| 5.5 | i18n move script plus the required-key test (§4).                                                                         | 1.5 |

Follow the UI rules in `.claude/CLAUDE.md`: Menu/Segmented, HelpTip, both themes, `aria-label`. Run `regression/run.sh` locally after 5.2 and 5.3.

### Phase 6 — Extension — 4–5 d

Generated urls and `classifyUrl`, `OPTIONAL_SITES`, `scripts/manifest.ts` from manifests (output snapshot unchanged), generic `sessionSync.ts`, content-module registry, generic `BATCH_ENDPOINTS` from `manifest.legacy.list` (`content/panels/batch.ts:20-95`). Test in Chrome and Firefox as `extension/CONTRIBUTING.md` requires. Weekly release.

### Phase 7 — Generic storage, expand then contract — 6–8 d plus one release

- **Expand.** New tables:
  - `ProviderConnection(userId, provider, slot, secret Json, expiresAt, rejectedAt, accountId, accountName, @@id([userId,provider,slot]))`
  - `CategorySiteId(categoryId, provider, siteId text, @@id([categoryId,provider,siteId]), @@index([provider,siteId]))`

  Then:
  - backfill both from the old columns in a migration;
  - read from the new tables with a fallback to the old columns;
  - write to both.

- **Starter categories.** `providers/<id>/categories.json` (path → ids) replaces the inline fields in `defaultCategories.ts`. A boot-time, idempotent "seed reconcile" keyed by the setting `provider_category_seed:<id>` re-implements the name/parent match from `20261022120000_nexprint_provider/migration.sql`, so a new provider needs no SQL.
- **DTO.** `CategoryOut` keeps the flat `<id>_cat_ids` fields through a mapped type.
- **Contract,** in the next release: drop the 37 user columns (schema:61-131) and the 10 `*CatIds` columns.

### Phase 8 — Docs and web — 1–2 d

Generated `PROVIDER_SETUP.md` table and provider list, `web/src/lib/site.mjs` `DOCS` provider entries from JSON. Rewrite the "Adding a provider site" section in `extension/CONTRIBUTING.md` and add an "Adding a provider" section to `CONTRIBUTING.md` (the checklist in §8).

**Total: about 55–75 d.** You can stop after Phase 6 with most of the value; a new provider then still needs one generated migration.

---

## 6. Tests and regression safety net

### What exists

- Backend vitest against real Postgres (`backend/vitest.config.ts`; `fileParallelism: false`), with `fetch` stubbed via `vi.stubGlobal` (pattern at `nexprintApi.test.ts:33`).
- End-to-end import tests exist only for:
  - makerworld, thingiverse, printables (`providerImports.test.ts`);
  - myminifactory (`myminifactoryImport.test.ts`);
  - snapmaker (`snapmakerImport.test.ts`);
  - makerworld profiles.
- makeronline, crealitycloud, nexprint, thangs and cults3d have only `*Api.test.ts` unit tests.
- `collectionSync.test.ts` and `providerCollections.test.ts` cover only makerworld, thingiverse and printables.
- The frontend has a handful of pure-function tests and no link-detection test.
- **The extension has no tests at all.**
- `regression/` (Playwright, weekly on `main`) has no provider scenarios: only auth, models, uploads, collections.

### Add before refactoring (Phase 0)

1. **Contract suite** `describeProviderContract(id, fixtures)`. For each provider it asserts:
   - `parseModel`/`modelUrl` round trip;
   - import creates a print with `sourceProvider`/`sourceExternalId`, author, rule-based category, gallery;
   - re-import is deduplicated, or adds a profile when the provider has profiles;
   - missing credentials → 400 with the exact `errorCodes.session`;
   - rejected credentials → `markRejected` plus the code;
   - provider disabled → 403 `provider_disabled`;
   - list entries flag `already_imported`;
   - `fetchListing` returns the ids;
   - `fetchSourceMeta` fills gaps.

   Fixtures are recorded JSON in `backend/tests/fixtures/providers/<id>/`, taken from existing stub shapes or captured once with a recorder script that strips secrets. The same suite becomes the acceptance test for every future provider.

2. **URL corpus** run against all three implementations (0.1).
3. **Freeze tests** (0.3): ids, error codes, `CategoryOut` keys, Express route inventory, extension `manifest.json`.

### Checks per step

- `npm --prefix backend test`, `npm --prefix frontend run verify`, `npm --prefix extension run verify`, `npm run providers:check`, `npm run format:check`.
- Before and after Phases 5 and 6: `regression/run.sh`.
- Manually, for each provider a PR touches: one real import, one re-import with a new profile, one list import, connect/disconnect in light and dark, and one Grab visit (session sync plus panel). Recorded fixtures can't catch upstream API drift, so state in each PR description what was checked live.

---

## 7. Risks and decisions for you

| #   | Decision or risk                                                                                                                  | My recommendation                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | How to share the manifests                                                                                                        | Committed generated copies plus a CI drift check. Not workspaces (§3).                                                                                                            |
| D2  | Database storage                                                                                                                  | Do Phase 7 (generic tables, expand/contract) only after the code refactor. If you stop earlier, add `providers:migration <id>` to generate the column migration and SQL backfill. |
| D3  | Frontend data source                                                                                                              | Bundled manifests plus `GET /providers` for runtime state. Show the intersection, so frontend/backend version skew is harmless.                                                   |
| D4  | i18n                                                                                                                              | One file per language, new `providers` namespace, required-key test.                                                                                                              |
| D5  | Legacy routes                                                                                                                     | Keep them indefinitely as registry-generated aliases, guarded by the route inventory test. Older Grab versions in the stores call them, and so do API clients.                    |
| D6  | Extension endpoints                                                                                                               | Keep using the legacy endpoints from `manifest.legacy` until there is a minimum-backend-version policy.                                                                           |
| D7  | MakerWorld                                                                                                                        | `importOverride` escape hatch first; a full port only if it stays readable. Do not force captcha or the guided collection job into generic shapes.                                |
| D8  | Existing inconsistencies (myminifactory session code not treated as auth, host derived from id)                                   | Keep them during the port; fix in separate `fix:` commits so the refactor diff stays behaviour-neutral.                                                                           |
| D9  | Credentials are stored in plain text in `User` columns; nothing in `backend/src` encrypts. Common practice is encryption at rest. | Add it when `ProviderConnection` arrives (Phase 7, key from env). Treat it as a separate decision, outside this refactor.                                                         |
| D10 | Brand colours are hex values, but the project rule says "colours from the theme"                                                  | Inject them via `theme.thingport.providers` and keep a single source in the manifests.                                                                                            |
| D11 | Extension permissions                                                                                                             | Only "optional" sites are allowed for new providers; the `buildManifest` snapshot test fails on any change to built-in matches.                                                   |
| D12 | Over-abstraction                                                                                                                  | Escape hatches (`routes`, `importOverride`, `PROVIDER_UI`, custom content and session modules) are part of the design. The rule is "generic by default, bespoke by declaration".  |
| D13 | Upstream ownership                                                                                                                | CONTRIBUTING.md:8 asks for an issue first. Post this plan as an RFC before Phase 1, then work task by task in worktrees.                                                          |
| D14 | Generator runtime                                                                                                                 | Add `tsx` to the root devDependencies; Node 24 type-stripping can't resolve extensionless imports.                                                                                |

---

## 8. Adding a provider after the refactor

1. `providers/<id>/manifest.ts` with `defineProvider({...})`: id (permanent), name, hosts, brand (logo SVG path), auth slots with `legacyEndpoint`, capabilities, extension (`site: "optional"`, origins, `sessionSync` or `"custom"`), `errorCodes`, examples.
2. `providers/<id>/urls.ts` with `ProviderUrls`, plus `urls.fixtures.json`.
3. `providers/<id>/categories.json`: starter-category path → site ids, if `capabilities.categories`.
4. Run `npm run providers:sync`. It regenerates the backend, frontend, extension and web copies, the docs logo and the `PROVIDER_SETUP.md` table.
5. `backend/src/providers/<id>/{index.ts, api.ts}`: `connection`, `resolveModel`, `downloadFiles`, plus `profiles`/`lists`/`trending`/`health` as the manifest requires. Add one line to `backend/src/providers/registry.ts`; `tsc` fails until it's there.
6. `backend/tests/providers/<id>.contract.test.ts` with recorded fixtures.
7. Optional: `extension/src/content/providers/<id>.ts` (profile loader, block reason, owner gate) and `extension/src/background/providers/<id>.ts` if the session sync can't be declared.
8. Optional: an entry in `frontend/src/providers/overrides.ts` for bespoke status, tiles or connect extras.
9. `providers:<id>` block in `frontend/src/i18n/locales/en.json`, `lt.json`, `fr.json`, `es.json`; the required-key test lists what's missing.
10. `docs/providers/<docsSlug>.md`.
11. Nothing else: no schema migration (after Phase 7), no route edits, no edits to `ProvidersPanel`, `AddMenu`, `UserMenu`, `scripts/manifest.ts` or `apiTokenScopes.ts`. All generic routes are POST/PATCH or settings GETs and stay under "Everything else". If the provider exposes a GET a dashboard app would read, apply the API-token-scope rule from `.claude/CLAUDE.md`.

---

**Most central files:**

- `backend/src/services/importService.ts`
- `backend/src/services/importJobRunner.ts`
- `backend/src/routes/imports.ts`
- `backend/src/routes/settings.ts`
- `backend/src/services/collectionSyncRunner.ts`
- `backend/src/services/collectionSyncService.ts`
- `backend/src/services/providerCollectionsService.ts`
- `backend/prisma/schema.prisma`
- `frontend/src/components/Layout/ConfigurationDialog/ProvidersPanel.tsx`
- `frontend/src/utils/importLinkDetection.ts`
- `frontend/src/components/uploads/useUploadImport.tsx`
- `extension/src/shared/urls.ts`
- `extension/src/shared/optionalSites.ts`
- `extension/scripts/manifest.ts`
- `web/src/lib/site.mjs`
