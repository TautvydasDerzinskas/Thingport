# Multiboard planner

Plans a [Multiboard](https://www.multiboard.io) wall: enter the wall's size, pick a tile size, a tile setup and a mounting
method, and it lays the tiles out and lists every tile and mount to print. The layout and counting rules are a port of
the official [Multiboard Planner](https://multiboard.itch.io/planner); its own calculator tests run against this copy
(`source/test_core.mjs`).

## Its models

The planner brings the 221 Multiboard parts it can list, as **Tool: Multiboard models** in every library that can use
tools. Each part opens from there, to view, download or send to a slicer, and **Collection** puts a wall's parts into a
collection of your own.

The parts aren't in this repository: Multiboard's licence lets people download and print its designs but not pass copies
on. Its `tool.json` lists each part's Thangs page instead, and when an admin installs the tool Thingport imports them, as
that admin, from Thangs: the admin needs Thangs connected (**Configuration → Providers → Thangs**). A free Thangs account
downloads a limited number of models a day; the parts that don't come in are listed under the tool in
**Administration → Tools**, to fetch again the next day, and open on Thangs until then.

## What it reaches

Nothing outside Thingport: it declares no hosts. It reads and writes only its own settings (the last wall planned), the
tool's models and, when you ask it to, a collection you pick.

## Changing it

Edit `source/` and build:

```bash
node source/build.mjs     # tool.js and tool.json, from core.js, data/, ui.js, icon.svg and tool.base.json
node source/test_core.mjs # the original planner's tests
```

`core.js` and `data/` are kept as the original planner has them, so its tests keep applying; `ui.js` is the window.
