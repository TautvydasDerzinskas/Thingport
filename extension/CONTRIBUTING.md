# Developing Thingport Grab

How to work on the Thingport Grab browser extension: running it locally, how the code is laid out,
building and packaging it for each browser's store, and how releases are signed. What the extension
does and how to install it is in the **[README](README.md)**; the branch, commit and pull request
workflow shared by the whole repo is in the root **[CONTRIBUTING.md](../CONTRIBUTING.md)**.

## Getting started

The extension is TypeScript, bundled with [esbuild](https://esbuild.github.io/), with styles in
SCSS. You need Node.js 24 or newer. Everything below runs from this `extension/` folder:

```bash
npm install
npm run dev         # build dist/chrome and rebuild on every change
npm run dev:firefox # same for dist/firefox
```

Load the build output as an unpacked extension, and reload it (the circular arrow on its card in
`chrome://extensions`, or **Reload** in `about:debugging`) after a rebuild:

- **Chrome / Edge**: `chrome://extensions` -> **Developer mode** -> **Load unpacked** -> `dist/chrome`
  (or `dist/edge`).
- **Firefox**: `about:debugging#/runtime/this-firefox` -> **Load Temporary Add-on** ->
  `dist/firefox/manifest.json`.

### Layout

```
src/
  shared/       code used by more than one script: storage keys, provider URL matching,
                the typed message protocol (messages.ts), API types, the inline icon
  background/   background script -- config/auth, every request to the Thingport instance,
                imports, the guided MakerWorld collection job, recent imports, toolbar icon
  content/      content script -- the floating icon, its panel flows (panels/), the setup dialog,
                overlays, MakerWorld page-data and download-URL resolution, and the injected
                Download normalized button (makerworld/)
    styles/     its SCSS, compiled into the bundle and injected into its shadow root
  normalizer/   the Bambu 3MF normalizer and the worker that runs it
  popup/        toolbar popup (popup.html, its script and styles/)
  styles/       SCSS design tokens and mixins shared by the popup and the content UI
  assets/       the Thingport icon SVG (inlined into the bundles)
public/         copied into every build as-is (the toolbar icon PNGs)
scripts/        build.ts, manifest.ts (per-browser manifest), zip.ts, screenshots.ts
```

The content script and the popup never call the Thingport instance themselves: they send a
message to the background script, which owns the credentials and the instance's host permission.
Every message and its reply is typed in `src/shared/messages.ts`.

`src/normalizer/threeMfNormalizer.ts` is a copy of the backend's
`backend/src/services/threeMfNormalizer.ts` (the Mozilla source zip can only hold this folder), and
`src/shared/slicers.ts` mirrors the web app's list of slicers that need it. Change them together.
The normalizer runs in a worker, bundled into the content script as a string through the build's
`?worker` imports; where a page's CSP blocks that worker, it runs on the page's main thread instead.

Colors, spacing and type live in `src/styles/_tokens.scss`. Colors are CSS custom properties with a
light and a dark palette: the popup follows the browser's color scheme, while the in-page UI always
uses the light one.

### Adding a provider site

Don't add a new site to `PROVIDER_MATCHES` in `scripts/manifest.ts`: new host access in an update makes Chrome and
Edge switch the extension off for every user until they approve it. Add it to `OPTIONAL_SITES` in
`src/shared/optionalSites.ts` instead, with its logo in `LOGOS` in `src/popup/sites.ts`. The popup lists it under
**Providers** with an **Enable** button that asks for access to that site; once granted, the background registers the
content script there. Users who had granted all-sites access earlier get it straight away.

Don't add the provider to `scripts/edge-certification-notes.txt`: it covers optional sites as a group, and Edge
rejects notes of 2,000 characters or more (`npm run check:edge-notes`).

### Before opening a pull request

- `npm run verify` passes (typecheck, lint, all three builds).
- The commit type says what the change means for users -- `feat:`, `fix:`, or `!` for breaking --
  since it decides the next version (see [Versioning](#versioning-how-the-next-version-is-picked)).
- The change works in Chrome **and** Firefox: load `dist/chrome` and `dist/firefox` and try it on
  the provider pages it touches. The background runs as a service worker in Chrome/Edge but as an
  event page in Firefox, so keep top-level background code free of anything only one supports.
- If it changes anything visible, run `npm run screenshots` and commit the updated images.
- If it adds a runtime message, add it to `src/shared/messages.ts` so both ends stay typed.
- Provider URL patterns in `src/shared/urls.ts` are duplicated from the web app and backend (see
  the comment there) -- change them in all three places.

### Scripts

| Command                                                 | What it does                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run dev` / `dev:firefox`                           | Watch build of `dist/chrome` / `dist/firefox`                             |
| `npm run build`                                         | Builds `dist/chrome`, `dist/firefox` and `dist/edge`                      |
| `npm run build:chrome` / `build:firefox` / `build:edge` | Builds one browser                                                        |
| `npm run zip`                                           | Builds everything and packages the store zips (below)                     |
| `npm run zip:chrome` / `zip:firefox` / `zip:edge`       | Same for one store                                                        |
| `npm run typecheck`                                     | `tsc --noEmit`                                                            |
| `npm run lint`                                          | oxlint (also run on commit by the repo's pre-commit hook)                 |
| `npm run lint:firefox`                                  | Builds for Firefox and runs `web-ext lint` on the result                  |
| `npm run screenshots`                                   | Regenerates the README screenshots (see below)                            |
| `npm run store-assets`                                  | Renders the store logo, promotional tiles and PNG screenshots (see below) |
| `npm run verify`                                        | Typecheck + lint + build                                                  |
| `npm run release:dry-run`                               | Shows the next version semantic-release would release, and why            |

The only difference between the browser builds is `manifest.json` (see `scripts/manifest.ts`):
Chrome and Edge run the background as a service worker, Firefox as an event page
(`background.scripts`) with its `browser_specific_settings.gecko` block. The version comes from
`package.json`.

## Store submission

`npm run zip` writes one upload-ready zip per store to `dist/zips/`, each with `manifest.json` at
its root:

| File                         | Where it goes                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `thingport-grab-chrome.zip`  | [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole)                   |
| `thingport-grab-edge.zip`    | [Microsoft Edge Add-ons Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview) |
| `thingport-grab-firefox.zip` | [addons.mozilla.org Developer Hub](https://addons.mozilla.org/developers/)                              |
| `thingport-grab-sources.zip` | AMO too -- it asks for the source whenever the submitted code comes out of a build step                 |

The bundles aren't minified, so reviewers can read them as-is; the sources zip lets them rebuild
them byte-for-byte with `npm ci && npm run build:firefox`. Upload the zips from a
[versioned release](#releases-ci) (`thingport-grab-v*` on the releases page), never a hand-bumped
build -- every store rejects a version it has already seen, and versions come from semantic-release.

### Store listings

None of these IDs are secret. The ones a workflow needs are also repo **variables** (Settings >
Secrets and variables > Actions > Variables), so they don't have to be hard-coded in a workflow.

**Microsoft Edge Add-ons** (live; new versions are published by CI, see
[Publishing to Edge automatically](#publishing-to-edge-automatically)):

|                    | Value                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Listing            | https://microsoftedge.microsoft.com/addons/detail/kahfidpmojfocohinlmglnfoaimocbol                 |
| Extension (CRX) ID | `kahfidpmojfocohinlmglnfoaimocbol` -- repo variable `EDGE_EXTENSION_ID`                            |
| Product ID         | `8c5f106c-5a45-438f-8e0b-2d0c0584d253` -- repo variable `EDGE_PRODUCT_ID`, used by the publish API |
| Store ID           | `0RDCKH3TMN7G`                                                                                     |

**Firefox Add-ons** (live; new versions are published by CI, see
[Publishing to Firefox Add-ons automatically](#publishing-to-firefox-add-ons-automatically)):

|           | Value                                                       |
| --------- | ----------------------------------------------------------- |
| Listing   | https://addons.mozilla.org/firefox/addon/thingport-grab/    |
| Add-on ID | `grab@thingport.app` -- `gecko.id` in `scripts/manifest.ts` |

**Chrome Web Store** (live; new versions are published by CI, see
[Publishing to the Chrome Web Store automatically](#publishing-to-the-chrome-web-store-automatically)):

|              | Value                                                                     |
| ------------ | ------------------------------------------------------------------------- |
| Listing      | https://chromewebstore.google.com/detail/nmblahmglpbplmfcggghdgohohlaeiee |
| Extension ID | `nmblahmglpbplmfcggghdgohohlaeiee` -- repo variable `CHROME_EXTENSION_ID` |
| Publisher ID | repo secret `CWS_PUBLISHER_ID`, used by the publish API                   |

Edge also issued a public key for the listing. Don't add it to the manifest (`key`) of the store
builds -- the stores set that themselves. It's only useful for giving an unpacked development build
the same extension ID as the store version.

### Store listing images

`npm run store-assets` renders everything a listing asks for into `docs/store/`, from the HTML
templates in `store-assets/` (styled like the website's social card):

| File                | Size     | Use                                                                                                  |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `logo.png`          | 300x300  | Store logo                                                                                           |
| `store-icon.png`    | 128x128  | Chrome Web Store icon -- transparent, 96x96 artwork with 16px padding                                |
| `tile-small.png`    | 440x280  | Small promotional tile                                                                               |
| `tile-large.png`    | 1400x560 | Large promotional tile -- the extension's real panel (its compiled stylesheet) on a placeholder page |
| `screenshots/*.png` | 1280x800 | The README's page screenshots as PNG, which is all the stores accept                                 |

Run `npm run screenshots` first when the screenshots need refreshing. They show live provider
pages, so check them before uploading: a front-page model can be someone else's trademarked
character, and Printables pages carry its own ads. Pick neutral models with
`npm run screenshots -- --makerworld=<url> --printables=<url> --thingiverse=<url>`. MyMiniFactory uses a fixed free
model and collection (its front page is mostly paid miniatures, some not safe for work); `--myminifactory=<url>` and
`--myminifactory-collection=<url>` change them. The screenshot build has all-sites access already granted, since
Playwright can't click the browser's permission prompt.

### Regenerating the screenshots

```bash
npx playwright install chromium # once
npm run screenshots
```

This builds the Chrome version, opens a Chromium window with it loaded (visible, not headless:
Printables' Cloudflare check turns headless browsers away), and serves a small mock Thingport
instance locally so the popup and panels show realistic data without a real account. The provider
pages are the live sites -- by default the first models linked from each site's front page; pass
`-- --makerworld=<url> --thingiverse=<url> --printables=<url>` to pick specific ones.

## Releases (CI)

Two workflows, for two different jobs.

**Every merge -- `.github/workflows/extension-release.yml`.** Runs on every push and pull request
touching this folder: typecheck, lint, the Chrome/Edge build, and `web-ext lint` on the Firefox
build. It publishes nothing.

**Versioned releases -- `.github/workflows/extension-store-release.yml`.** Every **Friday at 13:00
Polish time**, or whenever you start it (**Actions > Extension store release > Run workflow**, or
`gh workflow run extension-store-release.yml`), it releases whatever changed in the extension since
the last release, with [semantic-release](https://semantic-release.gitbook.io/) (see below): bumps
the version, writes `CHANGELOG.md`, commits both to `main`, tags it, creates a GitHub release with
the store zips, and publishes to the Chrome Web Store, Edge Add-ons and Firefox Add-ons. It also
moves the `extension-latest` release to the same build -- `thingport-grab-chrome.zip`,
`thingport-grab-edge.zip` and a `thingport-grab-firefox.xpi` signed through AMO's unlisted channel --
for installing by hand (the in-app Download page links the store listings instead). AMO rejects a
version number it has already seen, and the listed submission takes the real one, so the `.xpi`
carries the run number as an extra segment (e.g. `1.1.2.456`). If nothing releasable changed, the
run just ends.

### Versioning: how the next version is picked

Nobody edits `version` in `package.json` by hand -- semantic-release derives it from the
[Conventional Commit](https://www.conventionalcommits.org/) messages since the last release tag
(`thingport-grab-v<version>`). Only commits that changed files under `extension/` count
(`semantic-release-monorepo`, configured in `.releaserc.json`), so backend, frontend and web
commits never move the extension's version. Of those:

| Commit                                                             | Release                |
| ------------------------------------------------------------------ | ---------------------- |
| `feat: ...`                                                        | minor -- 1.2.0 → 1.3.0 |
| `fix: ...`, `perf: ...`                                            | patch -- 1.2.0 → 1.2.1 |
| `feat!: ...`, or a `BREAKING CHANGE:` footer                       | major -- 1.2.0 → 2.0.0 |
| `docs:`, `refactor:`, `chore:`, `ci:`, `test:`, `style:`, `build:` | none on its own        |

The highest one wins, so a week of three fixes and one feature is one minor release. Two things
follow from this:

- **Pick the type for extension users, not for the code.** A "refactor" that changes what users
  see or fixes something for them is a `fix:` or `feat:` -- otherwise it's never released.
- **Mark breaking changes**, e.g. when the extension starts needing a newer Thingport server:
  `feat!: require Thingport 2.x for ...`. Without the `!` (or footer) it's only a minor bump.

The commit messages also become the changelog and the GitHub release notes, so write them for a
reader.

To see what the next release would be, without releasing anything:

```bash
npm run release:dry-run
```

### Publishing to the Chrome Web Store automatically

The store release's `publish-chrome` job publishes each new version to the Chrome Web Store,
through the [Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/using-api)
(`scripts/publish-chrome.ts`): it signs in as the publisher's service account, uploads the exact
`thingport-grab-chrome.zip` the release built, waits for Google to process it, and submits it for
review. The update reaches users once Google's review passes, usually within a few days.

Like the other publish jobs it can be retried on its own with **Re-run failed jobs**, and it skips
itself (with a notice in the run) until the credentials below exist. To test the script by hand:

```bash
npm run zip:chrome
CHROME_EXTENSION_ID=nmblahmglpbplmfcggghdgohohlaeiee CWS_PUBLISHER_ID=... \
  CWS_SERVICE_ACCOUNT_KEY="$(cat path/to/key.json)" \
  npx tsx scripts/publish-chrome.ts dist/zips/thingport-grab-chrome.zip
```

### Publishing to Edge automatically

The store release's `publish-edge` job publishes each new version to Microsoft Edge Add-ons,
through the [Edge Add-ons Update API](https://learn.microsoft.com/microsoft-edge/extensions/update/api/using-addons-api)
(`scripts/publish-edge.ts`): it uploads the exact `thingport-grab-edge.zip` the release built,
waits for Microsoft to process it, and submits it for certification. Microsoft's review then takes
anywhere from hours to a few days before the update reaches users.

It's a job of its own so it can be retried on its own. Edge takes one submission at a time: if the
previous version is still in certification, the job fails with `InProgressSubmission` -- once
Microsoft has finished, open the failed run and use **Re-run failed jobs**. (The release itself,
tag and changelog included, is already done at that point and isn't repeated.)

Edge wants complete certification notes (under 2,000 characters) with every submission, and may fail
one that only points at an earlier one. The job sends
[scripts/edge-certification-notes.txt](scripts/edge-certification-notes.txt) with the version and
the release link filled in; edit that file when testing steps or permissions change. The script
refuses to upload if the filled-in notes are too long.

Reviewers need a Thingport server to test against. If the optional repo secret
`EDGE_REVIEW_TEST_SERVER` is set, its text goes into the notes (e.g. "Use the test server
https://… with email … and password …."). Without it, the notes tell the reviewer how to start a
server of their own with `install.sh`. Keep reviewer login details in that secret only: this repo
is public.

To test the script against Edge by hand, with the credentials below in your environment:

```bash
npm run zip:edge
EDGE_PRODUCT_ID=... EDGE_CLIENT_ID=... EDGE_API_KEY=... \
  npx tsx scripts/publish-edge.ts dist/zips/thingport-grab-edge.zip
```

### Publishing to Firefox Add-ons automatically

The store release's `publish-firefox` job submits each new version to the public listing on
addons.mozilla.org with `web-ext sign --channel listed`: it unpacks the exact
`thingport-grab-firefox.zip` the release built, and attaches `thingport-grab-sources.zip` and a
note for reviewers on how to rebuild from it. It doesn't wait for approval -- Mozilla can hold a
version for manual review before the update reaches users.

It uses the same `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` secrets as the per-merge signing (see
[AMO signing credentials](#one-time-setup-amo-signing-credentials)), and like `publish-edge` it's
a job of its own, so a failed submission can be retried with **Re-run failed jobs**. The two
channels never clash over version numbers: per-merge unlisted builds carry the run number as a
fourth segment, listed releases are the plain `package.json` version.

### Signing a Firefox build by hand

You need a Mozilla Add-on Developer account's API credentials (see below), and a version in the
built manifest that AMO hasn't signed before:

```bash
npm run build:firefox
npx web-ext sign --source-dir dist/firefox --channel unlisted \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
```

### One-time setup: Chrome Web Store publishing credentials

The job signs in as a Google Cloud service account that's linked to the store's publisher account:

1. In the [Google Cloud Console](https://console.cloud.google.com/), pick (or create) a project and
   enable the **Chrome Web Store API** (search for it in the top bar).
2. **IAM & Admin > Service Accounts > Create service account.** It needs no roles or permissions.
3. Open the service account, go to **Keys > Add key > Create new key > JSON**. The browser
   downloads the key file; Google keeps no copy, so if it's lost, create a new key and delete the
   old one on the same page.
4. In the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole),
   open **Account** and add the service account's email (`...@<project>.iam.gserviceaccount.com`,
   also the key file's `client_email`). A publisher can only have one service account.
5. Add the key file and the publisher ID (shown in the dashboard's publisher settings) as repo
   secrets, then delete the local key file:

   ```bash
   gh secret set CWS_SERVICE_ACCOUNT_KEY < path/to/key.json
   gh secret set CWS_PUBLISHER_ID # paste the publisher ID when prompted
   ```

6. `CHROME_EXTENSION_ID` is already a repo **variable** (see [Store listings](#store-listings)).

Service account keys don't expire, but an organization policy can block creating them
(`iam.disableServiceAccountKeyCreation`) -- a personal Google account isn't affected.

### One-time setup: Edge publishing credentials

The job skips itself (with a notice in the run) until these exist:

1. Sign in to [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview) with
   the account that owns the listing.
2. Under **Microsoft Edge**, open **Publish API**. If it offers to **enable the new experience**,
   click **Enable** -- the workflow uses the API-key version (v1.1).
3. Click **Create API credentials** (it can take a minute). The page then shows a **Client ID** and
   an **API key**, with the key's expiry date. Copy the key now; it isn't shown again.
4. Add them as repo secrets -- **Settings > Secrets and variables > Actions > Secrets**, or from
   this repo's folder:

   ```bash
   gh secret set EDGE_CLIENT_ID # paste the Client ID when prompted
   gh secret set EDGE_API_KEY   # paste the API key when prompted
   ```

5. `EDGE_PRODUCT_ID` is already a repo **variable** (see [Store listings](#store-listings)).

**API keys expire.** Partner Center shows each key's expiry date; before then, create a new key on
the same page and replace `EDGE_API_KEY` (the Client ID stays the same). An expired key makes the
job fail with HTTP 401 and a message saying so.

### One-time setup: AMO signing credentials

Firefox requires every extension -- even self-distributed, unlisted ones -- to be signed by
Mozilla before it will install. The workflow needs two repo secrets to do this automatically:

1. Create a free account at [addons.mozilla.org](https://addons.mozilla.org) if you don't have one.
2. Go to [Manage API Keys](https://addons.mozilla.org/en-US/developers/addon/api/key/) and generate
   a new API key/secret pair.
3. In the GitHub repo, add them as **Settings > Secrets and variables > Actions** secrets named
   `AMO_JWT_ISSUER` (the API key) and `AMO_JWT_SECRET` (the API secret).

No manual submission through the AMO web UI is needed first -- `web-ext sign --channel unlisted`
creates the add-on listing (hidden, unlisted) on its first run.

The extension's Firefox identity (`browser_specific_settings.gecko.id` in `scripts/manifest.ts`,
currently `grab@thingport.app`) is what ties every signed version together as updates to the same
add-on -- changing it later creates an unrelated add-on from Mozilla's point of view, so avoid
changing it once builds have been signed and distributed.

`browser_specific_settings.gecko.data_collection_permissions` is declared as `["none"]` -- Mozilla
requires every add-on to disclose this (as of policy effective 2025-11-03) and rejects signing
without it. This only covers data sent _off-device to the extension's developer or a third party
it controls_ -- the credentials/cookies this extension sends to your own self-hosted Thingport
instance don't count, since that's a destination you configure and control, not the developer. If
that ever changes (e.g. adding telemetry to a Thingport-operated service), update this declaration
to match.

## Regenerating the icons

The toolbar icon PNGs (`public/icons/thingport-icon-{color,dark}-{16,32,48,128}.png`) and
`src/assets/thingport-icon-color.svg` (inlined into the popup header and the in-page UI) are
rendered once from `frontend/src/assets/logos/thingport-icon-{color,dark}.svg` and checked in
rather than built on the fly -- with a tighter `viewBox` than the source files use. The source
SVGs' own 80x80 canvas leaves a fairly generous margin around the glyph (fine at logo size, but at
a 16-19px toolbar icon it reads as "too small" -- most of the square is empty). This crops to the
glyph's actual bounding box (including its stroke width) plus a small ~6% padding: `4 4 72 72`
instead of `0 0 80 80`. Regenerate (e.g. after the source SVGs change) from the repo root -- if the
glyph's proportions change, recompute the crop rather than reusing `4 4 72 72` as-is:

```bash
node -e "
const sharp = require('./backend/node_modules/sharp');
const fs = require('fs');
const sizes = [16, 32, 48, 128];
const jobs = [
  ['frontend/src/assets/logos/thingport-icon-color.svg', 'extension/public/icons/thingport-icon-color', 'extension/src/assets/thingport-icon-color.svg'],
  ['frontend/src/assets/logos/thingport-icon-dark.svg', 'extension/public/icons/thingport-icon-dark', null],
];
(async () => {
  for (const [src, outBase, svgOut] of jobs) {
    const svg = fs.readFileSync(src, 'utf8').replace('viewBox=\"0 0 80 80\"', 'viewBox=\"4 4 72 72\"');
    if (svgOut) fs.writeFileSync(svgOut, svg);
    for (const size of sizes) {
      await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(\`\${outBase}-\${size}.png\`);
    }
  }
})();
"
```
