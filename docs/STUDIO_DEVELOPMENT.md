# Developing Studio

Studio is Thingport's CAD page (`/studio`, behind `STUDIO_ENABLED`). Its one rule: **anything a person can do to a design
on the page, an AI can do the same way.** That holds because there is only one way to change a design, a _command_, and
each command is a toolbar action, an MCP tool and, later, a tool for Studio's own AI at once.

## How it fits together

```
frontend/src/studio/            the core: document, commands, geometry (browser and Node)
  └─ npm run studio:sync ──────▶ backend/src/studio/*.generated.ts (committed; CI checks it)

page (StudioPage/) ──run(command)──▶ POST /api/studio/designs/:id/commands ──▶ studioService ──▶ revision
MCP client ──studio_<command>────▶ /api/mcp (mcp/studioTools.ts) ───────────▶ studioService ──▶ revision
```

- **`document.ts`** — a design is a parametric feature tree, plain JSON: primitives, imported meshes, sketches, extrudes,
  revolves, booleans and the changes to a body (press/pull, fillet, chamfer, hole, shell, split, separated parts), in
  mm with Z up. A feature made from others _consumes_ them, and they stay editable under it.
- **`commands.ts`** — `STUDIO_COMMANDS`: each has a title, a description written for an AI, zod `args` and a pure
  `apply(doc, args)`. Undo, redo and `rename_design` have no `apply`; the server carries them out. `import_model` is
  an `"import"` command: the server first reads the library file into the design's own copy, then adds it with
  `addMesh`, the shared change to the tree. `separate_parts` is a `"measure"` command: how many parts it makes depends
  on the geometry, which `apply` can't see, so the server finds the body's parts first (`measureParts`, in the worker
  thread, outside the design's lock and again if the design changed meanwhile) and adds them with `addParts`. The
  page's preview finds them the same way in its worker. `trace_picture` is an `"import"` command too: the server
  traces the design's picture in the worker thread (`tracePicture`) and adds the outline with `addTrace`. `align` and
  `lay_flat` are `"measure"` commands too: where a body ends up depends on its extent, so the server measures the
  bodies first (`measureBounds`) and the command places them by it. A design's `parameters` are named numbers, and a
  feature's `expressions` map a field (`width`, `position.x`, `shapes.0.radius`) to a formula over them
  (`expressions.ts`); `set_parameter` works every formula out again in tree order, and a command that sets a number by
  hand drops its formula. Formulas are unit-aware, as CAD's are: each parameter has a unit, a field takes a length or
  a plain number (`fieldKind`), and `set_expression` keeps a formula with the design's unit written after each bare
  number that's a length (`withUnits`), so it evaluates the same in mm whatever the design is shown in. A design's
  `units` are only how it's shown and typed (`set_units`; the page's fields convert through `StudioUnitsContext`):
  every size in the document and in every command stays in mm.
- **`meshAsset.ts`** — that copy's file format. Copies live in `STORAGE/studio/u-<user>/<design>/<asset>.tpsm`; the page
  fetches them from `GET /api/studio/designs/:id/assets/:assetId` and caches them, as an asset never changes.
- **`geometry.ts`** — the feature tree to solids with manifold, which the page loads from WebAssembly in a web worker
  (`StudioPage/geometry.worker.ts`) and the backend from its package (`services/studioWorker.ts`, in a worker thread
  with a timeout). Each body is made once per evaluation, failures included. `prepareMesh` turns an imported file's
  triangles into the design's copy: corners joined, centred on the bed, and marked `solid` only when manifold takes it
  as closed. An open one still shows and exports, but booleans refuse it. `describeBody` lists a body's faces and edges
  for `studio_inspect_body`.
- **`topology.ts`** — Studio keeps no faces or edges, only meshes, so they're read off the triangles: flat faces
  (coplanar triangles that touch) and straight sharp edges (20° or more). A feature names a face by a point on it and
  its outward normal, an edge by its two ends, stored in the target body's own frame so they follow it when it moves;
  commands take them in world coordinates. If the body changes so the face or edge is gone, the feature says so.
- **`solids.ts`** — the solids beyond manifold's own: lofted extrudes (taper, rounded or bevelled ends), rounded
  cylinder rims, hole cutters, the cutters a fillet or chamfer takes from (or adds to) the edges, and a shell's walls.
  A shell is built exactly, not by rolling a ball round the body: a slab under each kept face, a wedge along each
  inside edge and a ball where an inside corner needs one, so flat walls come out exactly as thick as asked.
- **`parts.ts`** — a body's loose parts. Manifold gives each closed surface apart, a hollow's inside one with negative
  volume, which goes back with the smallest part around it (a ray-crossing test); a mesh with gaps falls apart by the
  corners its triangles share. A part feature keeps its box in the source's own frame and is found again by it each
  time the source is made, matched with its siblings so each piece is taken once; if an edit takes it away, the part
  says so. Its own origin is its base's middle as it was separated.
- **`text.ts`** — a text shape's letters, laid out in one of the fonts tools use (`frontend/src/assets/toolFonts`, all
  static, so a letter's holes keep their winding). The core never reads a font: each side parses the ones a design or
  a command uses and hands them to `addFont` first. The page fetches them (`StudioPage/studioFonts.ts`, in its worker
  too); the server reads the copies `studio:sync` puts in `backend/assets/studio-fonts/` (`services/studioFonts.ts`,
  before a command runs and in the worker). A font without one of the characters is refused, naming the fonts that
  have it, rather than drawn with a gap.
- **`trace.ts`** — a picture's shapes as outlines, followed along the pixels' edges so a hole winds against its outside
  and an island in it against the hole; straightened to a budget of points, and packed as one string in the sketch's
  trace shape, which `studio_get_design` shows as a line. The picture itself is kept beside the design as
  `<id>.png` (`POST /api/studio/designs/:id/pictures`), for the prompt and for tracing again. The page's trace dialog
  previews with the same code on a smaller copy.
- **`svgPath.ts`** — a path shape's SVG path data as outlines, arcs and curves flattened to a tolerance; even-odd by
  default, so a subpath inside another is a hole whichever way it winds.
- **`threads.ts`** — ISO metric threads: the pitch for a diameter and the helical solid, a rod or a cutter (larger by
  its clearance) that a threaded hole subtracts.
- **`sweep.ts`** — lofts (outlines matched point to point, resampled when their counts differ) and sweeps (the profile
  carried along the path by a rotation-minimizing frame, mitred at corners, or along a Catmull-Rom curve when smooth).
  A sweep's profile stays where its sketch is, as CAD sweeps one: the sketch has to be on a plane through the path's
  first point, square to it, and the profile is read into the path's frame from there.
  Both build the mesh themselves and refuse one that folds or runs into itself rather than make a broken solid.
- **`printCheck.ts`** — the print check behind `studio_check_print` and the page's check dialog: bed, pieces,
  overlaps, overhangs (downward faces steeper than the limit, not on the bed) and thin walls (rays cast inward from a
  sample of triangles). A threaded body's overhangs and walls are judged on a copy with its threads as plain cylinders
  (`plainThreads` in `geometry.ts`), as CAD analyses cosmetic threads. `measureBetween` in `geometry.ts` is
  `studio_measure`.
- **`shapes2d.ts`** and **`vec.ts`** — outlines (rounded corners, insets that keep their shape) and vector maths.

The page applies a document command locally at once (`useStudioDesign`), then sends it; the server applies it again on
the stored design, one command at a time per design, and keeps a revision, which undo and redo move between. An open
page polls the design's version, so what an assistant does shows up while you watch.

The grid (`StudioPage/grid.ts`) is a shader on a plane, the bed's and a sketch's, spaced again before every frame from
how many millimetres a pixel is where the view looks (`gridLevels`): three levels at once, the finest fading, so a step
never jumps. What a point snaps to is the finest that shows. Its settings are the person's (`/api/studio/settings`),
not the design's, as the Ask AI layout and the units new designs start in are.

A tool that takes more than a click (fillet, hole, shell, an extrude's options and so on) is an `Operation` in
`StudioPage/operations.ts`: what it has been given so far, what the view should let the user pick next (`pickOf`), and
the one command it makes (`commandOf`). Its panel (`OperationPanel.tsx`) edits it, the page previews that command with
`applyCommand` on a copy of the document, and OK runs it. Nothing about the tool is stored but the command.

An assistant reads `studio_guide` (`backend/src/services/studioGuide.ts`) first: the world, how faces and edges are
named, and recipes. Keep it in step when a command's behaviour changes.

## Studio's own assistant

The page's **Ask AI** box runs an assistant on the server (`backend/src/services/studioAssistant.ts`), behind the
**Studio assistant** feature in Administration → AI, which an admin turns on and gives the AIs it may use
(`StudioAssistantPrefs`; anything else is refused).

- **Its tools are the MCP tools.** It takes the `studio_*` tools from `MCP_TOOLS` (all but listing, creating and
  deleting designs, and the guide, which is its system prompt) plus `search_models` and `list_model_files` for imports,
  with the schemas MCP clients see and the design id filled in. Commands run as `studioActor: "assistant"`, so each
  step is a revision marked `assistant`. There is nothing to add for a new command.
- **Either kind of AI.** `aiToolChat.ts` keeps one conversation format and turns it into OpenAI-style function calling,
  or Claude's tool use (`claudeToolTurn` in `aiAnthropicClient.ts`, streamed, its answers replayed as they came so its
  thinking and its tool searches go back unchanged).
- **Three ways to send the tools** (`ToolMode`). Every schema is inlined and tightened (no `additionalProperties`, no
  ±10 m coordinate limits, a vector's item once): the server checks each call anyway.
  - `search`, for Claude: the `CORE` tools loaded, the rest `defer_loading` behind its BM25 tool search, with a line in
    the system prompt saying what can be found. Cached at the end of the instructions (`cache_control` on the system
    block, so another run reuses it) and at the conversation's end (the top-level marker). A model or proxy that turns
    tool search down gets every tool instead.
  - `compact`, for the AIs an admin marks so: the `COMPACT` tools, a line each, the arguments that matter, short
    instructions, a slimmer design state and less history. A new command isn't in it unless you add it there.
  - `full`, for any other AI: every tool. OpenAI-style providers cache the repeated start themselves.
- **A run** gets the design as `studio_get_design` reads it and what's selected, takes up to 30 tool calls in 10
  minutes, and is kept in memory, one per design; the page polls `GET /studio/designs/:id/assistant` for its steps and
  reloads the design as they land. Stop aborts the turn in flight.
- **The conversation** is kept per design in `StudioMessage`, as text: prompts, answers, the steps taken and how the
  run ended. A new prompt is sent with the last 20, not with earlier runs' tool payloads or thinking.
- **Pictures**: a prompt may carry up to four of the design's pictures, for an AI marked **Sees pictures**
  (`AiConnection.vision`); others are refused before the run. They go as JPEGs no bigger than 1568 px with the prompt,
  their ids in its text for `trace_picture`, and the newest ones again with a later prompt that has none.
- **The page** keeps the assistant's state in `useStudioAssistant`, shown by the bar (`PromptOverlay.tsx`, one line
  while it works) and, in the account's side panel layout, by `AssistantPanel`. The view offsets its camera by the
  bar's height (`bottomInset`), so what it looks at sits above the bar.

## Adding something a person can do

1. **Add a command** in `frontend/src/studio/commands.ts`, with a description an AI can act on with nothing else to go
   on: units, axes, where the origin is, what ids it takes, what happens to what's already there. Mark it
   `destructive` if it changes or removes something rather than only adding.
2. **Run it from the UI** with `run("your_command", args)` from `useStudioDesign`. There is no other way to change the
   document on the page, on purpose: don't add one.
3. **Run `npm run studio:sync`** (the pre-commit hook does it too). The backend copy, the REST endpoint and the MCP tool
   `studio_your_command` follow from the command; nothing else needs writing.
4. **Test it** in `frontend/src/studio/commands.test.ts`, its geometry in `operations.test.ts` against a formula or
   the same shape made another way, and in `backend/tests/studio.test.ts` if it touches the server's side (history,
   ownership, MCP). If it needs things picked in the view, add it to `StudioPage/operations.ts`.
5. **Add its strings** to every locale file, under `app.studio`.

What isn't a change to a design stays out of the commands: the camera, the selection, which panel is open, and exports
that only hand the user a file.

## Checks

```bash
npm run studio:check # the backend copies match frontend/src/studio
npm --prefix frontend exec vitest run src/studio
npm --prefix backend run lint
```

The backend tests need a test database: see [DEVELOPMENT.md](DEVELOPMENT.md#running-the-tests).
