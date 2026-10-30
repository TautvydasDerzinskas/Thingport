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
  `providers/routes.ts`, with `providerBodyLimits` there for a route whose body outgrows the global JSON parser's
  100 kB (OwlCAD's exports).
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
  `MANIFESTS`, `ABOUT`, `URLS`, `TRENDING_PROVIDER_IDS`).
- `docs/assets/providers/<docsSlug>.svg`, the docs logo, drawn from the manifest's logo.
- The list and the comparison table in `docs/PROVIDER_SETUP.md`, between its `<!-- providers:… -->` markers.
- `web/src/lib/providers.generated.mjs`, the website's provider page entries (`PROVIDER_DOCS`), what each page shows
  besides its Markdown -- its brand accent, its highlight and the facts its links to feature pages are chosen by
  (`PROVIDER_PAGES`) -- and the comparison table at the foot of each (`PROVIDER_COMPARISON`), from the same data as
  `docs/PROVIDER_SETUP.md`'s table.

The generator also checks the manifests. It fails when two providers share an `order` or a trending `rank`, when the
set of built-in Grab sites changes, when an optional site asks for cookies in its manifest, when a `docs.ts`
`about` runs past 240 characters or its `highlight` is missing, too long or links oddly, and when a manifest names
a slicer the app's slicer setting doesn't list (`SLICER_OPTIONS` in `frontend/src/constants/settingsOptions.ts`, which
names them on the website too).

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

A table of the provider's own is the exception, and it goes in `schema.prisma`: Printables' `ProviderListing`, and
`GrabImport`, the imports waiting for Grab, which MakerOnline and OwlCAD share, told apart by its `provider`.

## Strategies the existing providers use

Sites differ most in four things: how the backend reaches them, how a sign-in is kept, where files come from, and
how lists are read. When a new site resembles one of these, copy that provider's approach.

### Reaching the site

| Approach                                          | Providers                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official API with an instance key                 | Thingiverse (an admin's App Token), MyMiniFactory (an admin's API key as `?key=`)                                                                                                                                                                                                                                                             |
| Official API with the user's key                  | Cults3D's GraphQL API (nickname + API key) for models, likes, printlists and orders, though never files                                                                                                                                                                                                                                       |
| Public GraphQL API, no sign-in                    | Printables (`api.printables.com` answers unauthenticated, unlike the Cloudflare-gated site)                                                                                                                                                                                                                                                   |
| The site's own private API (what its pages call)  | Snapmaker, MakerOnline, Creality Cloud, NexPrint, Thangs, eufyMake, Makerables, GrabCAD. Most wrap answers in a `code` of their own, so check that, not the HTTP status; GrabCAD's answers with plain statuses, a visitor's `/members/me` with a 204. Creality Cloud refuses any call without its full set of `__cxy_*` headers               |
| Model pages plus the maker's cloud API            | MakerWorld (page data, and `api.bambulab.com` with the user's cookie)                                                                                                                                                                                                                                                                         |
| Its pages' HTML, rendered on the server           | Pinshape and Toymakr3D, read with cheerio. Pinshape's own calls answer with more HTML (`{success, html, pagination}`), and both sites' redirects are their answers: Pinshape's `/index` for a missing model, `/auth/login` for a refused sign-in; Toymakr3D's `/login` for one, and its canonical product page for a link whose name is wrong |
| Its pages' data, as the JSON they hold or ask for | CGTrader: its listings answer JSON to a page's own script, a model page hands its React components their data as `data-react-props`, and `/products/<slug>.js`, the script the page loads to learn who's looking, says whether the user bought the model. Its redirect to `/not_found` is its 404                                             |
| A Firebase app's public endpoints                 | OwlCAD: its gallery is a Firestore collection read over REST, its library parts are Firebase Storage objects, and its one call is a Cloud Function, all answering without a sign-in. Firestore answers a document that isn't there with 403, not 404                                                                                          |

**Cloudflare:**

- `browserFetch: true` in the manifest sends every request to the provider's hosts with a browser's TLS handshake
  (`backend/src/utils/browserFetch.ts`). Use it where Cloudflare tells Node's fetch apart by its handshake, as with
  Thingiverse, MyMiniFactory and Thangs. Headers and cookies don't help there.
- FlareSolverr is a fallback for challenge pages (`services/flaresolverr.ts`), used by MakerWorld, Thingiverse,
  MyMiniFactory and Thangs. `helpers.flaresolverr` in the manifest says how much the provider leans on it.
- Creality Cloud only needs a browser's User-Agent. So does GrabCAD's CloudFront, which turns away a request without
  one, its pictures and files included; the import pipeline's own downloads send one.
- Cults3D's site gets past no challenge at all. Its downloads use the browser's own `cf_clearance`, sent with the
  User-Agent it was issued to and from the browser's IP address, which Grab hands over.

**AWS WAF:** CGTrader's bot check is AWS's, which challenges with a 202 and `x-amzn-waf-action` rather than a
Cloudflare page. A browser passing it gets an `aws-waf-token` cookie, which, unlike Cloudflare's clearance, isn't tied
to the browser or its address, so the backend sends one with every request: the browser's, which Grab hands over with
the sign-in, or one FlareSolverr's browser got by running the challenge (`cookiesViaFlaresolverr`, which waits for its
script, as FlareSolverr doesn't know to). A challenge is answered once with a fresh one (`cgtrader/waf.ts`).

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
| eufyMake       | The auth token and user id the site keeps in page storage as `mk-userinfo`      | Grab reads it from an open site tab and sends each new one. Only the likes need it, with the id's MD5 as `Gtoken`  |
| Pinshape       | Flask-Login's year-long `remember_token`, and the `session` cookie              | Grab sends each new pair, only from a signed-in page: a visitor gets a `session` cookie too                        |
| Toymakr3D      | Laravel's session cookie and its `remember_web_…` one beside it                 | Grab sends each new pair, only from a signed-in page: a visitor gets a session cookie too                          |
| Makerables     | Auth0's `__session` cookie, split across `__session__0`, `__session__1`, …      | Grab sends each new set; the backend turns it into the Bearer token the API takes, as the site's own pages do      |
| CGTrader       | Rails' `_cgtrader_session_id`, and the browser's `aws-waf-token` beside it      | Grab sends each new pair, only while the browser has the signed-in `user_id` cookie: a visitor gets a session too  |
| GrabCAD        | Rails' `_grabcad_session`, with no remember-me cookie beside it                 | Grab sends each new one, only from a signed-in page. It lasts two days from its last use, Thingport's included     |
| OwlCAD         | Nothing                                                                         | Its gallery, its files and its one call all answer without a sign-in                                               |

Rules of thumb:

- Never refresh a token the site treats as single-use.
- Keep an expiry only for display unless the site really stops accepting the token then (`honoursExpiry` in
  `connections.ts`, used by Snapmaker and MakerOnline).
- Accept a pasted Cookie header as well as a bare value. `manifest.sessionCookies` names the cookies to pick out,
  and Grab reads the same ones.

### Getting files

- **The shared pipeline** (`sourcedImport` in the registry: `requireAuth`, `resolveModel`, `mapError`, …) covers
  most providers. The provider resolves a model to its files and the pipeline does the rest.
- **Generator scripts** come along with a model's files. Choose what to download with `kit.isImportableFile`: any file
  a plate takes, and a `.scad` script, which is kept beside the model as a supporting file so it can be generated
  again. `kit.isModelFile` says only what may become a plate, so filtering by it drops the scripts. Where the site says
  a model's creator kept its script back, report it in `meta.parametricSource` with `withheld: true`, as MakerWorld
  does for a design whose `.scad` files are all `protected`: the model then shows "Script not shared" rather than
  looking as if Thingport lost the script.
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
- **Toymakr3D** hands over one zip of a model's files, which the import unpacks: its download page redirects a
  signed-in user to a signed CloudFront link and anyone else to its sign-in page. A bought model's zip is
  watermarked per buyer and built when it's first asked for, so until it's ready that page shows the progress
  instead, which the provider reports as "come back in a minute" rather than a failure.
- **Makerables** keeps a project's files on its CDN unsigned, so an import needs no sign-in at all. They sit on three
  tabs -- NC programs, CAM projects and the model files the other two were cut from -- and only the model files are
  worth importing, so the other two tabs are never asked for. A project named by its id is kept under the slug its
  page gives as canonical (`canonicalId` and `keptId`, as Creality Cloud's alias is).
- **CGTrader** lists a model's files one by one on its download page, each redirecting a signed-in user to a signed
  CloudFront link, a free model's and a bought one's alike. It often has the same mesh in many formats, so only what
  a plate takes and the zips that may hold some are fetched first, its OBJs only when those brought nothing. Free
  downloads are limited per account, which `/items/<id>/can-download-item-files` answers 403 for, as the site asks
  before each (`errorCodes.downloadLimit`).
- **GrabCAD** lists a model's files folder by folder, anyone's to read, each with its API's download link, which
  answers a signed-in user with where the file is on the site's own host. Its models are mostly CAD parts, the same part
  in several formats, so only what a plate takes and the zips its `system` says are of one are fetched first, its OBJs
  and zips of a CAD system's own files only when those brought nothing.
- **OwlCAD** has two kinds of model. A library part is a GLB in Firebase Storage, which the backend converts to the STL
  OwlCAD itself would place; it converts a CAD project that is nothing but an imported mesh too. Any other CAD project
  has no file anywhere -- its document is a script only OwlCAD's kernel turns into geometry -- so Grab opens it in
  OwlCAD's editor, in a tab of its own, and exports it there through the editor's automation bridge
  (`window.owlcadAgent.exportMesh`), which refuses a model over 250,000 triangles. Like MakerOnline it uses
  `customImport` with a `grabQueue`: Grab first asks the backend whether a model needs the editor at all
  (`/import/owlcad/plan`), and imports started elsewhere wait in `GrabImport` for the user's next owlcad.com visit
  (`errorCodes.needsGrab`).
- **Repairs** (`services/modelRepairService.ts`) fetch a model's lost files again through the provider's own import
  (`sourcedImport`'s `downloadModel`, or the link import) and replace only the files. A provider with a `grabQueue` has
  the model wait for Grab instead, so its `customImport.addToExisting` has to put the files back when `kit.filesMissing`
  says they're gone (`kit.replaceFiles`), as MakerOnline's and OwlCAD's do.

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
- **Category ids** are numbers for most sites. Thangs has no ids, so its are paths (`categoryIds: "path"`), and so are
  CGTrader's: the `<category>/<subcategory>` a model's address names; GrabCAD's, its categories' slugs; and OwlCAD's,
  the label a model carries (`Printer Parts`). A GrabCAD model is in several, which it lists alphabetically, so the
  broad ones are put last. Pinshape's model pages don't say their category at all (`categoryIds: "none"`): its imports
  come uncategorized, its `categories.json` is empty, and the category mapping shows no row for it.
- **A list with no address of its own.** Snapmaker's likes and bookmarks share one page, whose own address
  (`?tab=interactions`) doesn't say which of the two is shown, so Thingport adds `&list=likes` or `&list=bookmarks`
  to tell them apart. Makerables' saved projects are a tab of a profile that the site keeps in React state rather
  than in the URL at all, so Thingport adds `?tab=saved`. Each provider's `examples.list` shows the form it keeps,
  which is what a sync holds the list by.
- **Categories a model's page doesn't say.** Toymakr3D's pages name no category either, but its category listings do,
  so its provider reads those once and keeps the model-to-category index for a few hours. Its "All Products",
  "Free Download" and "Premium" menu entries are price buckets rather than subjects, and are left out.

### Errors and limits

`errorCodes` names the codes clients act on:

- `session`: the sign-in is missing or was turned down;
- `downloadLimit`: the account's downloads are used up for now (MakerWorld's and Thangs' daily ones, CGTrader's free
  ones);
- `needsGrab`: only Grab can fetch the files (MakerOnline, OwlCAD).

`authStopText` and `stopTexts` explain why a batch stopped.

### Choosing for a new site

1. Find what the site's own pages call, and which calls need a sign-in. Record real responses for the contract test.
2. Keep everything server-side if the site allows it, with the sign-in Grab hands over.
3. If Cloudflare blocks Node, try `browserFetch` first and FlareSolverr second.
4. Fall back to Grab doing the work on the site's pages (MakerOnline, OwlCAD) only when nothing server-side works.
5. Prefer the generic shape. When a site doesn't fit, declare the exception rather than bending the shared code:
   `customImport`, `providers/routes.ts`, `PROVIDER_UI`, or a content or session module of its own.

## Adding a provider

Open an issue first, then:

1. **`providers/<id>/manifest.ts`**. The id is stored in the database and sent by clients, so it never changes. Its
   Grab site is `"optional"`: new built-in host access would switch Grab off for every user until they approve it.
2. **`providers/<id>/urls.ts`**, with cases in `urls.fixtures.json`, and **`providers/<id>/docs.ts`**: the providers
   page's list line and table cells, the website description, and `about` -- two or three sentences on the site itself
   (who runs it, where it came from, what it's known for, not what Thingport does with it), which Thingport Grab's
   popup shows for the site you're on. Its `highlight` is what sets the provider apart once it's in Thingport: a title
   and a sentence or two for its page on the website, with a link to the docs page that says more.
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
