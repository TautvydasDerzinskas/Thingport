# Provider development

How a provider (a model site Thingport imports from) is built, what the existing ones do about each site's quirks,
and the steps to add one. How users set them up is in [PROVIDER_SETUP.md](PROVIDER_SETUP.md).

## How a provider is put together

Everything a provider does of its own lives in four folders:

| Folder                          | What's in it                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providers/<id>/`               | `manifest.ts` (what it is, typed by `providers/_lib/types.ts`), `urls.ts` (its links, read and written the same in all three packages) with `urls.fixtures.json`, `docs.ts` |
| `backend/src/providers/<id>/`   | `api.ts`, `index.ts` (import, lists, trending, details), `session.ts` and `connection.ts` for a sign-in, `browse.ts`, `sync.ts`, `categories.json`                          |
| `frontend/src/providers/<id>/`  | `CollectionTile.tsx`, and only what the generic UI can't do                                                                                                                 |
| `extension/src/providers/<id>/` | What Grab does on its pages: `content.ts`, `session.ts`, and anything else of its own                                                                                       |

Shared code reaches a provider only through the tables that wire providers in:

- **Backend:** `PROVIDERS` in `backend/src/providers/registry.ts` (`ProviderBackend`), and routes of its own in
  `providers/routes.ts`.
- **App:** `COLLECTION_TILES` in `frontend/src/providers/collectionTiles.ts`, and `PROVIDER_UI` in `overrides.ts`.
- **Grab:** `CONTENT_MODULES` (`content.ts`), `SESSION_SOURCES` (`sessions.ts`), `CAPTURE` (`accounts.ts`) and
  `PROVIDER_HANDLERS` and the event hooks (`background.ts`), all in `extension/src/providers/`.

Where shared code still has to name a provider, a comment there says why, and the top of the provider's backend
`index.ts` lists every such place in all three packages. Keep that list current.

### Generated files

`npm run providers:sync` (`scripts/sync-providers.mjs`) writes these. The pre-commit hook runs it, and CI fails when
they're out of date (`npm run providers:check`). Never edit them by hand:

- In each of `backend/`, `frontend/` and `extension/`: `src/providers/<id>/manifest.generated.ts` and
  `urls.generated.ts`, `src/providers/_lib/*.generated.ts`, and `src/providers/index.generated.ts` (`PROVIDER_IDS`,
  `MANIFESTS`, `URLS`, `TRENDING_PROVIDER_IDS`).
- `docs/assets/providers/<docsSlug>.svg`, the docs logo, drawn from the manifest's logo.
- The list and the comparison table in `docs/PROVIDER_SETUP.md`, between its `<!-- providers:… -->` markers.
- `web/src/lib/providers.generated.mjs`, the website's provider page entries.

The generator also checks the manifests. It fails when two providers share an `order` or a trending `rank`, when the
set of built-in Grab sites changes, and when an optional site asks for cookies in its manifest.

### Storage

A provider needs no column and no migration:

- **Sign-ins:** each user's sign-in and who they are on the site are a `ProviderConnection` row per user, provider
  and auth slot. Read and write them through `backend/src/providers/connections.ts`. What the `secret` JSON holds is
  up to the provider's `session.ts`.
- **Instance credentials:** an admin's key is a `Setting` row (Thingiverse's `token.ts`, MyMiniFactory's
  `apiKey.ts`).
- **Category ids:** the site's ids for the starter categories are `backend/src/providers/<id>/categories.json`,
  keyed by path (`"Parent/Child"`). New users' categories get them, and so do existing users' starter categories,
  once, at the first startup after the provider is added (`seedProviderCategoryIds` in
  `services/categorySiteIds.ts`).

A table of the provider's own is the exception, and it goes in `schema.prisma`: Printables' `ProviderListing`,
MakerOnline's `GrabImport`.

## Strategies the existing providers use

Sites differ most in four things: how the backend reaches them, how a sign-in is kept, where files come from, and
how lists are read. When a new site resembles one of these, copy that provider's approach.

### Reaching the site

| Approach                                         | Providers                                                                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Official API with an instance key                | Thingiverse (an admin's App Token), MyMiniFactory (an admin's API key as `?key=`)                                                                                                                                  |
| Official API with the user's key                 | Cults3D's GraphQL API (nickname + API key) for models, likes, printlists and orders, though never files                                                                                                            |
| Public GraphQL API, no sign-in                   | Printables (`api.printables.com` answers unauthenticated, unlike the Cloudflare-gated site)                                                                                                                        |
| The site's own private API (what its pages call) | Snapmaker, MakerOnline, Creality Cloud, NexPrint, Thangs. Each wraps answers in a `code` of its own, so check that, not the HTTP status. Creality Cloud refuses any call without its full set of `__cxy_*` headers |
| Model pages plus the maker's cloud API           | MakerWorld (page data, and `api.bambulab.com` with the user's cookie)                                                                                                                                              |
| Its pages' HTML, rendered on the server          | Pinshape, read with cheerio. Its own calls answer with more HTML (`{success, html, pagination}`), and its redirects are its answers: `/index` for a missing model or user, `/auth/login` for a refused sign-in     |

**Cloudflare:**

- `browserFetchOrigins` in the manifest lists the exact HTTPS origins that need a browser's TLS handshake
  (`backend/src/utils/browserFetch.ts`). Include every affected origin, including CDN and download hosts, as with
  Thingiverse, MyMiniFactory and Thangs. Headers and cookies don't help where Cloudflare distinguishes the handshake.
- FlareSolverr is a fallback for declared pages and API reads (`services/flaresolverr.ts`). A manifest's
  `solverRoutes` owns exact hosts, anchored path patterns, allowed query names and route-specific `credentials`
  (`query` names or `cookies: true`). Only those HTTPS destinations may enter the solver; ordinary query fields
  cannot carry credentials. Callers cannot override this policy. API tokens belong on API routes only.
  `helpers.flaresolverr` describes the provider's recommendation. Configuring the global solver URL enables
  fallback for all declared routes; clearing it disables every solve, including warm page-proxy cache requests. Thingiverse and MyMiniFactory still try guarded direct transport first and solve only a 429 or
  Cloudflare challenge; ordinary 401/403 responses remain credential rejections.
- Solver navigation can redirect or load third parties outside Thingport's per-hop destination guard. A declaration
  permits credential exposure to the configured solver and potentially its logs; it does not constrain the browser's
  later requests. Document that trust requirement and recommend a private, isolated solver. Binary downloads,
  authenticated Cults3D calls and MakerWorld's `api.bambulab.com` cloud API are unsupported; Cults3D's declaration is
  for public pages only. Regenerate all manifest copies with `npm run providers:sync`.
- Creality Cloud only needs a browser's User-Agent.
- Cults3D's site gets past no challenge at all. Its downloads use the browser's own `cf_clearance`, sent with the
  User-Agent it was issued to and from the browser's IP address, which Grab hands over.

### Keeping a sign-in

`signIn` and `auth` in the manifest declare what's needed, and the provider's `session.ts` keeps it:

| Provider       | What's kept                                                                     | How it stays valid                                                                                                 |
| -------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Printables     | Nothing                                                                         | Private lists and likes come from Grab while the user is on the site (below)                                       |
| Thingiverse    | An admin's App Token (instance)                                                 | Set once in Settings, and checked by `instanceHealth`                                                              |
| MyMiniFactory  | An admin's API key, plus each user's `PHPSESSID` for paid models                | The user's session is pasted, or sent by Grab                                                                      |
| MakerWorld     | The user's cookie                                                               | Grab sends it. A turned-down cookie is marked rejected until a new or re-verified one arrives                      |
| Snapmaker      | A day-long access token                                                         | **Only Grab renews it.** Refresh tokens are single-use and sign the old holder out, so the backend never refreshes |
| MakerOnline    | A JWT good for about 90 days, needed only for likes and own lists               | Grab sends each new one                                                                                            |
| Creality Cloud | `model_token` + `model_user_id`, set for 7 days                                 | Grab sends each new pair. The expiry is kept only for display, since the token may outlive the cookie              |
| NexPrint       | `auth_token`, sent as a Bearer token                                            | The site refreshes it as it's used, and Grab sends each new one                                                    |
| Thangs         | A 7-day access token and a refresh token good for about a year                  | **The backend renews it itself**, a little before expiry, since the refresh token survives use                     |
| Cults3D        | API key (`default` slot) and the browser's session + clearance (`browser` slot) | The 20-day session slides with use, the backend's own use included                                                 |
| Pinshape       | Flask-Login's year-long `remember_token`, and the `session` cookie              | Grab sends each new pair, only from a signed-in page: a visitor gets a `session` cookie too                        |

Rules of thumb:

- Never refresh a token the site treats as single-use.
- Keep an expiry only for display unless the site really stops accepting the token then (`honoursExpiry` in
  `connections.ts`, used by Snapmaker and MakerOnline).
- Accept a pasted Cookie header as well as a bare value. `manifest.sessionCookies` names the cookies to pick out,
  and Grab reads the same ones.

### Getting files

- **The shared pipeline** (`sourcedImport` in the registry: `requireAuth`, `resolveModel`, `mapError`, …) covers
  most providers. The provider resolves a model to its files and the pipeline does the rest.
- **MakerWorld** imports through the shared link import in `services/importService.ts`, which every page link of no
  provider's goes through too (`LINK_PROVIDER`). It pauses after a CAPTCHA until a manual retry (`liftHolds`), paces
  its calls (`IMPORT_MAKERWORLD_CALL_DELAY_MS`), and downloads a model with no print profiles as a zip of its raw
  files (`rawFilesZip`). Its 3MFs are Bambu Studio projects, so Grab and the app offer them normalized
  (`bambuProjects`).
- **MakerOnline** can't download server-side at all: the download call needs a Risk-Token that only the site's
  anti-bot script makes in a real page. It uses `customImport` with a `grabQueue`. The backend plans the files, Grab
  gets their links signed on a makeronline.com page, and imports started elsewhere wait in `GrabImport` until the
  user's next visit (`errorCodes.needsGrab`).
- **Cults3D** "orders" a free model for nothing, as its Download button does. An order line's download page then
  redirects to a signed CloudFront link that needs no credentials.
- **Snapmaker** and **NexPrint** return file links signed for whoever asked, so files only download with the user's
  token, even where the details are public.
- **Creality Cloud** links can name a model by an alias, so `keptId` maps the alias to the id it's kept under.
- **Pinshape**'s download link for each file redirects a signed-in user to a signed S3 link, and anyone else to its
  sign-in page, which is how a refused sign-in shows.

### Lists, trending and categories

- `capabilities.collections` and `likes` make the registry type require `lists`, `sync` and `browse`. Where the
  site's name for its lists differs, `docs.ts` relabels them ("Bookmarks", "Printlists").
- `ownLists`: `"signIn"` finds the user's own lists through their sign-in; `"username"` asks for a username.
- **Printables likes are private to their owner.** Grab reads them, and private collections, on a visit and pushes
  them (`printables/push.ts`). Syncs and the Browse tab then read what was pushed (`listings.ts`).
- **MakerWorld lists** import only through Grab, on their own pages, paced against the site's limits
  (`listImport: "grab"`). A sync turned on from the app brings only models added from then on (`syncsNewOnly`).
- **Trending** declares its list's `kind` (trending, popular, featured or recommended) and its `rank` on the
  dashboard panel, or `false` where the site has no such list.
- **Category ids** are numbers for most sites. Thangs has no ids, so its are paths (`categoryIds: "path"`). Pinshape's
  model pages don't say their category at all (`categoryIds: "none"`): its imports come uncategorized, its
  `categories.json` is empty, and the category mapping shows no row for it.

### Errors and limits

`errorCodes` names the codes clients act on:

- `session`: the sign-in is missing or was turned down;
- `downloadLimit`: the account's daily downloads are used up (MakerWorld, Thangs);
- `needsGrab`: only Grab can fetch the files.

`authStopText` and `stopTexts` explain why a batch stopped.

### Choosing for a new site

1. Find what the site's own pages call, and which calls need a sign-in. Record real responses for the contract test.
2. Keep everything server-side if the site allows it, with the sign-in Grab hands over.
3. If Cloudflare blocks Node, declare the affected `browserFetchOrigins` first and try FlareSolverr second.
4. Fall back to Grab doing the work on the site's pages (MakerOnline) only when nothing server-side works.
5. Prefer the generic shape. When a site doesn't fit, declare the exception rather than bending the shared code:
   `customImport`, `providers/routes.ts`, `PROVIDER_UI`, or a content or session module of its own.

## Adding a provider

Open an issue first, then:

1. **`providers/<id>/manifest.ts`**. The id is stored in the database and sent by clients, so it never changes. Its
   Grab site is `"optional"`: new built-in host access would switch Grab off for every user until they approve it.
2. **`providers/<id>/urls.ts`**, with cases in `urls.fixtures.json`, and **`providers/<id>/docs.ts`**: the providers
   page's list line and table cells, and the website description.
3. **`npm run providers:sync`** writes the generated files listed above.
4. **Backend**, `backend/src/providers/<id>/`: `api.ts`, `index.ts`, `session.ts` and `connection.ts` for a sign-in,
   `browse.ts` and `sync.ts` for its lists, and `categories.json`. Add its entry to `PROVIDERS` in
   `providers/registry.ts`; tsc requires it, with whatever its manifest's capabilities call for. Add any routes of its
   own to `providers/routes.ts`.
5. **A contract test**, `backend/tests/providers/<id>.contract.test.ts`, using `describeProviderContract`
   (`tests/providers/contract.ts`), with recorded responses in `tests/fixtures/providers/<id>/`. Never call the real
   site from a test.
6. **App**, `frontend/src/providers/<id>/`: its `CollectionTile.tsx` entered in `collectionTiles.ts`, and an
   `overrides.ts` entry only if needed. Its text goes under `providers.<id>` in every
   `frontend/src/i18n/locales/*.json`; `frontend/src/providers/strings.test.ts` lists what's missing.
7. **Grab**, `extension/src/providers/<id>/`: its entry in `CONTENT_MODULES`, and its sign-in in `SESSION_SOURCES` if
   Grab hands one over. See [extension/CONTRIBUTING.md](../extension/CONTRIBUTING.md#adding-a-provider-site).
8. **`docs/providers/<docsSlug>.md`**, its own page.
9. If it serves a GET that a dashboard app would read, give it an API token scope (`services/apiTokenScopes.ts`).

## What never changes

Clients in the wild, older Grab versions from the stores among them, depend on these:

- Provider ids, `errorCodes` and API token scope ids.
- The `legacy` endpoints and auth `legacyEndpoint`s in the older manifests, which are aliases of the generic routes.
  `backend/tests/providerFreeze.test.ts` and its route snapshot guard them. Providers added since have none.
- The built-in Grab sites (MakerWorld, Printables, Thingiverse). The `buildManifest` snapshot test fails on any change
  to their matches.
- `CategoryOut`'s `<id>_cat_ids` fields.

Credentials are stored unencrypted in `ProviderConnection` and `Setting`. Encrypting them at rest is a separate,
still-open decision.
