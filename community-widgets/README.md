# Community widgets

Dashboard widgets anyone can install from **Customize dashboard → Custom widgets → Community** in Thingport. Each
folder here is one widget; [`index.json`](index.json) lists the ones Thingport offers.

To write one, see [your first widget](../docs/developers/first-widget.md) and the
[SDK reference](../docs/developers/sdk-reference.md); to have an AI assistant write it for you, see
[build with an AI assistant](../docs/developers/ai-assistant.md). Installing and using them is in the
[custom widgets guide](../docs/guides/custom-widgets.md).

## Sharing yours

1. In Thingport, open your widget's ⋮ menu under **Mine** and choose **Download for publishing**.
2. Fork this repository and unzip the download here, so it becomes `community-widgets/<slug>/`:
   - `widget.json` or `widget.yml` -- its metadata
   - `widget.js` -- its script
   - `widget.html` -- optional markup and styles
   - `locales/<code>.json` -- the words it shows, one file per language, for each language its metadata's `locales`
     names. The download writes the ones you wrote in the editor.
   - `screenshots/<name>.png` (or .jpg, .webp) -- what it looks like on a dashboard, listed under `screenshots` in
     its metadata, each `{ "file", "caption" }`. These are what someone looks through before installing it, so a
     widget shared here wants a couple; only a widget in this folder has them, since only it carries files.
   - `README.md` -- what it does, and which services it calls
3. Add `<slug>` to `widgets` in `index.json`.
4. Open a pull request. A check validates the widget; a maintainer reads its code before merging.

## What reviewers look for

A widget's script runs in its users' dashboards with their access to Thingport, so it's read before it's merged:

- It draws only inside `thingport.root` and cleans up its timers and listeners.
- It reaches outside services only through `thingport.fetch`, to the `hosts` its metadata lists, and its README says
  why it needs each one.
- It doesn't send the user's data anywhere it doesn't need to go, and keeps tokens in `secret` settings.
- No minified or obfuscated code, and nothing loaded at run time that the review can't see.
- The words it shows are in `locales/`, asked for with `t("key")`, rather than written into the script. English is
  the fallback, key by key, so every other language may be half done; a language the metadata names without a file
  is an error. A setting's label written as a label key is translated too, so the panel's cog follows the user's
  language.

A change to a merged widget should raise its `version`. Users who installed it are offered the update and asked to
approve it again.
