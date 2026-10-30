# MakerWorld 3MF normalizer

Makes 3MF projects from Bambu Studio, Orca Slicer and MakerWorld open in Cura, PrusaSlicer, Anycubic and other slicers.
Drop one or more on its window, choose them, or pick a model's 3MF from your library; each comes back as a plain 3MF
to download, save as a new model, or add to the model it came from.

Bambu Studio keeps a project's parts in separate files inside the 3MF (the 3MF Production Extension), which most other
slicers can't read. The normalizer joins them into one model file and keeps what the designer set up:

- painted faces and every filament's colour, as 3MF materials and as PrusaSlicer's colour painting
- multi-part objects as one object, each part on its own filament
- the plates and what's on each
- the designer's print settings (layer height, walls, infill, supports, line widths, temperatures), written for both
  Bambu/Orca and PrusaSlicer

It leaves out what only Bambu printers use: sliced G-code, the printer and machine profile, and slicing caches.

The conversion is the 3MF Sanitizer's, kept as it is in `source/sanitizer.js` with its own tests; the window, the
before-and-after 3D view and the ZIP reading and writing around it are this tool's.

## What it reaches

Nothing outside Thingport: it declares no hosts, and files are converted in the browser. It reads a model's file only
when you pick it from your library, and creates a model or adds a file to one only when you ask it to.

## Changing it

Edit `source/` and build:

```bash
node source/build.mjs          # tool.js and tool.json, from zip.js, sanitizer.js, preview.js, ui.js, icon.svg and tool.base.json
node source/test_sanitizer.mjs # the 3MF Sanitizer's tests, against the built tool.js
```

`sanitizer.js` is kept as the original has it, so its tests keep applying; `zip.js` stands in for JSZip with the
browser's own deflate, `preview.js` draws the 3D views with WebGL, and `ui.js` is the window.
