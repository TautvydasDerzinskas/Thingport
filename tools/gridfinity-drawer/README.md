# Gridfinity drawer builder

Fits a [Gridfinity](https://gridfinity.xyz) organizer to a drawer: enter the drawer's inside size and your printer's
bed, and it lays out the 42 mm grid, fills what's left with a border (or stretches the cells to fill the drawer), and
cuts the baseplate into tiles the bed takes. Draw bins on the grid, with compartments and a height of your choosing, and
it lists every part to print and how many.

**Save to Thingport** keeps the whole drawer as one model: an STL for each kind of tile and bin, named with how many of
it to print, a picture of the layout, and a description with the parts table, the totals and where each tile goes.

The parts are drawn by the tool itself, to the Gridfinity sizes (42 mm cells, 7 mm height units, the standard foot and
baseplate profile), as light open-bottom baseplates and plain bins with box dividers. Inspired by
[FitForge's drawer builder](https://fitforge-c5058.web.app/drawer); none of its code is used.

## What it reaches

Nothing outside Thingport: it declares no hosts. It keeps the drawer you were working on in its own settings, and
creates a model, or adds one to a collection you pick, only when you ask it to.

## Changing it

Edit `source/` and build:

```bash
node source/build.mjs         # tool.js and tool.json, from geometry.js, plan.js, render.js, ui.js, icon.svg and tool.base.json
node source/test_geometry.mjs # every kind of part is a closed solid
```

`geometry.js` makes the meshes, `plan.js` the grid, tiles and parts list and the model's description, `render.js` the
previews, and `ui.js` the window; `tool.html` is its markup and styles.
