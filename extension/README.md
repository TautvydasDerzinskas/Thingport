# Thingport Grab

A Chrome extension that imports MakerWorld, Thingiverse, and Printables models into your
self-hosted Thingport instance without leaving the provider's site. Visiting a model, collection,
or Thingiverse Likes page shows a floating Thingport icon; clicking it opens a small panel to pick
what to import (and, for a single model, an optional destination collection), then imports it the
same way Thingport's own "+ Add > Import" does.

It talks directly to your Thingport instance's API from the extension's background service worker
-- no separate server, no data sent anywhere else.

## Install (no extension store listing)

This isn't published to either browser's extension store, so it installs the same way the
[Thingport releases](https://github.com/TautvydasDerzinskas/Thingport/releases) page's other
downloads do.

### Chrome / Edge / other Chromium browsers

As a developer-mode "unpacked" extension:

1. Download `thingport-grab-chrome.zip` from the in-app Download page (or the
   [`extension-latest` release](https://github.com/TautvydasDerzinskas/Thingport/releases/tag/extension-latest))
   and unzip it somewhere permanent (don't delete the folder afterwards -- Chrome loads the
   extension from it every time it starts).
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.
4. Click the new Thingport icon in your toolbar, enter your instance's URL and your Thingport
   login, and save.

### Firefox

Firefox refuses to install *any* unsigned extension outside of Developer Edition/Nightly, even for
local/unpacked use -- so unlike Chrome, this needs an actual Mozilla-signed build, not just a zip.
CI signs one on every push to `main` (see [Build / package](#build--package) below):

1. Download `thingport-grab-firefox.xpi` from the in-app Download page (or the
   [`extension-latest` release](https://github.com/TautvydasDerzinskas/Thingport/releases/tag/extension-latest)).
2. Open it directly (double-click, or `File > Open File` in Firefox) -- or drag it onto a Firefox
   window -- and confirm the install prompt.
3. Click the new Thingport icon in your toolbar, enter your instance's URL and your Thingport
   login, and save.

It's signed for **self-distribution** (the "unlisted" channel), not listed on
addons.mozilla.org -- signing is still required for Firefox to allow the install at all, and it's
what lets Firefox treat later versions as updates to the same install instead of a fresh add-on.

## Setup

The popup asks for your instance URL (e.g. `https://thingport.example.com`) and your Thingport
email/password once. Saving it requests permission to reach that one origin and validates the
login before storing anything. After that, the toolbar icon turns from the dark/inactive icon to
the color/active one, and the floating icon starts appearing on importable pages. Reopen the popup
any time to **Change URL** or check **Disable extension** (unchecked by default) to pause it
without losing the saved setup.

The extension re-authenticates automatically as its session token nears expiry -- there's nothing
to keep re-entering day to day. If your password changes or a session gets revoked server-side, the
next import attempt will silently re-login with the stored credentials, or surface a clear error if
those no longer work.

### MakerWorld: no separate cookie setup needed

Importing from MakerWorld normally requires pasting a session cookie into Thingport's Profile
settings by hand (MakerWorld's own site sets it `HttpOnly`, which blocks a normal web page from
reading it -- that's the whole reason for the manual copy/paste). This extension reads that same
cookie directly from your browser instead, using the `chrome.cookies` API -- a privileged,
extension-only capability explicitly allowed to read `HttpOnly` cookies, unlike a regular page's
own JavaScript. It's sent only to your own Thingport instance, as part of the same import request
that needs it, exactly like the cookie you'd otherwise paste in by hand -- never anywhere else. If
your Thingport account doesn't already have a MakerWorld cookie saved, the extension also pushes
this one to Profile > MakerWorld for you, so the plain web app's own imports benefit too, not just
ones started from the extension.

## What counts as "importable"

- A single model page (MakerWorld, a Thingiverse Thing, a Printables Model) -- hidden automatically
  once you've already imported that exact page.
- A MakerWorld collection, a Thingiverse Collection, or a Thingiverse Likes page -- lets you pick
  which of the listed designs to import in one batch.

Picking a destination collection is only offered for a single-model import; a batch import instead
lands in Thingport's own auto-named collection for that batch (e.g. "Thingiverse Likes"), matching
how the web app's own batch imports already work.

A batch import keeps running on the server even if you close the panel or the tab -- closing it
just stops showing progress, it doesn't cancel anything.

## Build / package

There's no build step -- `extension/` is loaded directly by Chrome and Firefox alike. CI packages
both browsers' distributables on every push to `main` that touches this folder (see
`.github/workflows/extension-release.yml`) and attaches them to the `extension-latest` release.

To produce the Chrome zip by hand:

```bash
cd extension
zip -r ../thingport-grab-chrome.zip . -x '*.DS_Store'
```

To produce a signed Firefox build by hand, you need a Mozilla Add-on Developer account's API
credentials (see below):

```bash
npx web-ext sign --source-dir extension --channel unlisted \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
```

Signing rejects re-uploading a version number it's already seen for this add-on ID (even on the
unlisted channel), so CI signs a copy of the manifest with the GitHub Actions run number appended
to the version (e.g. `1.0.1.456`) rather than requiring a manifest version bump on every commit --
see the workflow for details. Doing this by hand, bump `version` in `manifest.json` first instead.

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

The extension's Firefox identity (`browser_specific_settings.gecko.id` in `manifest.json`, currently
`grab@thingport.app`) is what ties every signed version together as updates to the same add-on --
changing it later creates an unrelated add-on from Mozilla's point of view, so avoid changing it
once builds have been signed and distributed.

`browser_specific_settings.gecko.data_collection_permissions` is declared as `["none"]` -- Mozilla
requires every add-on to disclose this (as of policy effective 2025-11-03) and rejects signing
without it. This only covers data sent *off-device to the extension's developer or a third party
it controls* -- the credentials/cookies this extension sends to your own self-hosted Thingport
instance don't count, since that's a destination you configure and control, not the developer. If
that ever changes (e.g. adding telemetry to a Thingport-operated service), update this declaration
to match.

## Regenerating the icons

The toolbar icon PNGs (`icons/thingport-icon-{color,dark}-{16,32,48,128}.png`) and the inline
`icons/thingport-icon-color.svg` (used by the popup header and the in-page floating button) are
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
  ['frontend/src/assets/logos/thingport-icon-color.svg', 'extension/icons/thingport-icon-color'],
  ['frontend/src/assets/logos/thingport-icon-dark.svg', 'extension/icons/thingport-icon-dark'],
];
(async () => {
  for (const [src, outBase] of jobs) {
    let svg = fs.readFileSync(src, 'utf8').replace('viewBox=\"0 0 80 80\"', 'viewBox=\"4 4 72 72\"');
    const buf = Buffer.from(svg);
    if (outBase.endsWith('color')) fs.writeFileSync(outBase + '.svg', svg);
    for (const size of sizes) {
      await sharp(buf, { density: 384 }).resize(size, size).png().toFile(\`\${outBase}-\${size}.png\`);
    }
  }
})();
"
```
