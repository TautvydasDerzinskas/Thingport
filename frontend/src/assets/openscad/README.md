# The OpenSCAD engine models are generated with

OpenSCAD built for WebAssembly, offered to tools through the SDK's `library("openscad")`, so a model that came
with the script it was generated from can be generated again -- with other text, other sizes, other options --
without sending anything to the site it came from or to anywhere else.

It is here for the same reason the typefaces in `../toolFonts` are: Thingport carries what its tools need so they
keep working offline, and a solid modelling kernel is far past what a tool's own script could hold.

## What these files are

| File            | What it is                                          |
| --------------- | --------------------------------------------------- |
| `openscad.wasm` | The engine itself, unmodified, as published         |
| `openscad.js`   | The loader Emscripten generated with it, unmodified |

Both come from **OpenSCAD 2025.03.25** (build `wasm24456`), the WebAssembly build the OpenSCAD project publishes
for its own playground, taken from:

<https://files.openscad.org/playground/OpenSCAD-2025.03.25.wasm24456-WebAssembly-web.zip>

The matching source is the `openscad/openscad` repository at that build, under
<https://github.com/openscad/openscad>.

## Licence

OpenSCAD is free software under the **GNU General Public License, version 2 or (at your option) any later
version**, whose text is in `COPYING` beside this file. Its authors also grant a special exception for linking
with the CGAL library, which `COPYING` states first.

Because it is "or any later version", it may be taken under the GPL v3, and a GPL v3 work may be combined with
an AGPL v3 one -- which is what Thingport is. That is why it can be here at all.

Shipping a built engine carries the licence's obligation to offer its source. The exact build and the repository
it was built from are named above so that offer can be met; if this file is ever updated to a different build,
update those links with it.

The engine is **not** modified here, and nothing in Thingport patches it at runtime: it is loaded, given a script
and a set of parameters, and asked for the result.
