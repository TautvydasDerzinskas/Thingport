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
  page's preview finds them the same way in its worker.
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
- **`shapes2d.ts`** and **`vec.ts`** — outlines (rounded corners, insets that keep their shape) and vector maths.

The page applies a document command locally at once (`useStudioDesign`), then sends it; the server applies it again on
the stored design, one command at a time per design, and keeps a revision, which undo and redo move between. An open
page polls the design's version, so what an assistant does shows up while you watch.

A tool that takes more than a click (fillet, hole, shell, an extrude's options and so on) is an `Operation` in
`StudioPage/operations.ts`: what it has been given so far, what the view should let the user pick next (`pickOf`), and
the one command it makes (`commandOf`). Its panel (`OperationPanel.tsx`) edits it, the page previews that command with
`applyCommand` on a copy of the document, and OK runs it. Nothing about the tool is stored but the command.

An assistant reads `studio_guide` (`backend/src/services/studioGuide.ts`) first: the world, how faces and edges are
named, and recipes. Keep it in step when a command's behaviour changes.

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
