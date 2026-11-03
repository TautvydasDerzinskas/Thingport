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

- **`document.ts`** — a design is a parametric feature tree, plain JSON: primitives, imported meshes, sketches, extrudes
  and booleans, in mm with Z up. A boolean or extrude _consumes_ its inputs, which stay editable under it.
- **`commands.ts`** — `STUDIO_COMMANDS`: each has a title, a description written for an AI, zod `args` and a pure
  `apply(doc, args)`. Undo, redo and `rename_design` have no `apply`; the server carries them out. `import_model` is
  an `"import"` command: the server first reads the library file into the design's own copy, then adds it with
  `addMesh`, the shared change to the tree.
- **`meshAsset.ts`** — that copy's file format. Copies live in `STORAGE/studio/u-<user>/<design>/<asset>.tpsm`; the page
  fetches them from `GET /api/studio/designs/:id/assets/:assetId` and caches them, as an asset never changes.
- **`geometry.ts`** — the feature tree to solids with manifold, which the page loads from WebAssembly and the backend
  from its package (`services/studioWorker.ts`, in a worker thread with a timeout). `prepareMesh` turns an imported
  file's triangles into the design's copy: corners joined, centred on the bed, and marked `solid` only when manifold
  takes it as closed. An open one still shows and exports, but booleans refuse it.

The page applies a document command locally at once (`useStudioDesign`), then sends it; the server applies it again on
the stored design, one command at a time per design, and keeps a revision, which undo and redo move between. An open
page polls the design's version, so what an assistant does shows up while you watch.

## Adding something a person can do

1. **Add a command** in `frontend/src/studio/commands.ts`, with a description an AI can act on with nothing else to go
   on: units, axes, where the origin is, what ids it takes, what happens to what's already there. Mark it
   `destructive` if it changes or removes something rather than only adding.
2. **Run it from the UI** with `run("your_command", args)` from `useStudioDesign`. There is no other way to change the
   document on the page, on purpose: don't add one.
3. **Run `npm run studio:sync`** (the pre-commit hook does it too). The backend copy, the REST endpoint and the MCP tool
   `studio_your_command` follow from the command; nothing else needs writing.
4. **Test it** in `frontend/src/studio/commands.test.ts`, and in `backend/tests/studio.test.ts` if it touches the
   server's side (history, ownership, MCP).
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
