# Community widgets

Dashboard widgets anyone can install from **Customize dashboard → Custom widgets → Community** in Thingport. Each
folder here is one widget; [`index.json`](index.json) lists the ones Thingport offers.

To write one, and to use an AI assistant to write it for you, see the
[custom widgets guide](../docs/guides/custom-widgets.md).

## Sharing yours

1. In Thingport, open your widget's ⋮ menu under **Mine** and choose **Download for publishing**.
2. Fork this repository and unzip the download here, so it becomes `community-widgets/<slug>/`:
   - `widget.json` or `widget.yml` -- its metadata
   - `widget.js` -- its script
   - `widget.html` -- optional markup and styles
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

A change to a merged widget should raise its `version`. Users who installed it are offered the update and asked to
approve it again.
