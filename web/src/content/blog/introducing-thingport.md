---
title: "Introducing Thingport: a self-hosted home for your 3D models"
description: "Why Thingport exists, what it does today, and how to get it running on your own server in a few minutes."
pubDate: 2026-09-23
tags: ["announcement", "self-hosting"]
---

If you do 3D printing, you probably find models all over the place: MakerWorld, Printables, Thingiverse and a few
others. Over time the bookmarks, downloaded ZIPs and random folders become a mess, and the model you want never seems to
be where you left it.

**Thingport is a personal, self-hosted library for those models.** It keeps a real copy of every model you care about,
with its files, photos, description, author and a link back to where it came from, all on a server you control.

## What it does today

- **Imports from the sites you use.** Paste a MakerWorld, Printables or Thingiverse link, or import whole collections and
  your likes at once.
- **Previews models in 3D.** STL, 3MF, STEP and OBJ files open in an interactive viewer right in the browser.
- **Keeps things organized.** Nested categories, collections, tags, favourites and full-text search.
- **Gets you to the printer.** Attach instructions and sliced prints to a model, and open files straight in Bambu
  Studio, PrusaSlicer or Cura.
- **Stores plain files.** Your models are ordinary files on your disk, in a folder layout you choose.

There's a longer tour on the [features page](/features/).

## Two companion apps

[Thingport Grab](/docs/grab/) is a browser extension that adds an import button to MakerWorld, Printables and
Thingiverse model pages, so you can save a model without leaving the page you found it on.

[Thingport Bridge](/docs/bridge/) is a small desktop helper that makes “Open in slicer” work for slicers that won't
accept a link from a self-hosted server.

## Try it

Thingport runs from pre-built Docker images, so it works on almost anything, from a spare laptop to a NAS. The
[install guide](/docs/install/) takes you from nothing to a running instance with `docker compose up -d`. There are also
guides for [Unraid](/docs/install/unraid/), [TrueNAS SCALE](/docs/install/truenas/) and [CasaOS](/docs/install/casaos/).

Thingport is free and open source under the MIT license. If you run into a problem or have an idea,
[open an issue on GitHub](https://github.com/TautvydasDerzinskas/Thingport/issues). Pull requests are welcome too.
