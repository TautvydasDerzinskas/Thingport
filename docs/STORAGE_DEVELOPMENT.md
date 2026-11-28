# Model files and storage: development

How Thingport keeps a model's files: its plates, its supporting files and prepared print, its licence file and its
pictures, and how they get there through uploads, imports, the consume folder, copies and repairs. This page is for
working on that code. What people see is in [features/supporting-files.md](features/supporting-files.md).

This code is being rebuilt in small pull requests (the supporting-files rebuild). The page says what the code follows
**now**, not what's planned: each pull request that puts a rule in force adds it below, in the same pull request.

## Rules in force

- **One rule for names.** Every name that comes in goes through `normalizeFileName` (`files/names.ts`) before anything
  reads it: an upload, a file added to a model, an import, a zip entry, the consume folder, a partner's copy, a tool or
  Studio. A second file of a name is numbered by `numberedName`, which keeps a compound extension:
  `job (2).gcode.3mf`. A path segment keeps its 120-character cap and fits 240 bytes, cut before its extension
  (`cutName`). Pinned by `tests/files/names.test.ts` and `tests/files/namesAtUpload.test.ts`.
- **One table of file kinds.** What a file is comes from the kind table (`files/kinds.ts`, data in `kinds.json`):
  `kindOf` reads a normalised name, and `extensionsOf` gives a kind's extensions. The extension sets from before it
  are its `LEGACY` views, pinned to what each held. Outside it, a new `Set` or array literal opening with an extension, or
  a `.endsWith(".…")` test, fails `tests/files/kinds.test.ts` unless that file is listed there with its reason. `npm run kinds:sync` writes
  [features/file-kinds.md](features/file-kinds.md) from it, and Format checks the page.
- **What a file can do comes with it.** `capsOf` (`files/kinds.ts`) works out from a file's kind, name and role what
  the web app may offer of it: the 3D viewer, Open in slicer (only what Bridge's `isModelFile` opens, as an installed
  Bridge never updates), Studio, Customize, and how it shows in place (`view`: PDFs, raster pictures, Markdown, text
  and scripts, and tables; never an SVG or a web page). Every plate and file in the REST API carries it as `caps`, with its kind
  as `content_kind`: named apart from MCP's `kind` and Send to's `file_kind`, which say what a file is to its model. A
  partner's files carry the same, worked out by this instance from each name and the role the partner gave (the wire
  is unchanged), and the SDK's `relatedFiles` carry `contentKind` and `folder`. The
  web app reads `caps`; `legacyCaps` (`frontend/src/utils/fileCaps.ts`) stands in, frozen, for an older backend.
  Pinned by `tests/files/kinds.test.ts`, `tests/fileKindsPayload.test.ts`, `tests/mcpDescriptions.test.ts`,
  `tests/federationExplore.test.ts`, `frontend/src/utils/fileCaps.test.ts` and `frontend/src/sdk/userLibrary.test.ts`.
- **No list shows a save under way.** A `PrintFile` row still at `"pending"` is in no list of a model's files: the
  detail and its counts and size, `GET /print/:id/files`, MCP, the Generative filter and what partners are published.
  Pinned by `tests/fileKindsPayload.test.ts`, `tests/mcp.test.ts`, `tests/generativeFilter.test.ts` and
  `tests/federationCopy.test.ts`.
- **One rule for junk.** `isJunk` (`files/names.ts`) decides what a computer left among files. `/upload`, the zip
  listing, `/import/zip` (before its empty check and its job's total) and the consume folder drop it. Customize and the
  Generative filter go by it too, so a script named with a leading dot isn't one. Pinned by the cases table (A14, C14
  and Z14), `tests/upgradeCompat.test.ts`'s older Grab and `tests/generativeFilter.test.ts`.
- **Fs 1: only a missing file counts as missing.** Whether a plate's or a `PrintFile`'s file is there is asked through
  the file door (`modelFiles/storageFs.ts`): `fileState` answers file, missing or not-a-file, `openStored` opens one.
  Only ENOENT and ENOTDIR mean missing, and a folder isn't a file. Any other error (EIO, EACCES, ELOOP) stops the
  operation before it removes or records anything, save in the repair's sweep, which runs once the plates are in: there
  the row whose look failed stays, and the rest go on. It holds for downloads and the zip, copies, Send to, MCP's
  `get_model_file`, partners' downloads, Migrate's export, free paths, moves, a rename's look at the files it will move, the
  storage browser, the missing-files scan and the repair. A plate with a `sourcePath` is read there only. It doesn't hold yet for pictures and the files made
  from a model's files, an upload's temporary files, the prune, a profile plate's size before it's matched and a new
  plate's recorded size: `tests/modelFiles/door.test.ts` lists every `existsSync` left with the step that removes it, and
  fails on a new one, and on a door call site no test fails. Pinned by `tests/modelFiles/door.*.test.ts`,
  `tests/repairKeeps.test.ts` and the rename cases in `tests/api.test.ts`.
- **Fs 2: a download serves the file it opened.** A model's file is opened first; its row is read again by id, and the
  open handle is served only while the row still names that path (`utils/sendStored.ts`), else the answer is 404. Not its
  size: a file may be edited in place, and its row keeps the size it was saved with. It covers plates, supporting files,
  the prepared print, the zip, Send to's link and upload, MCP's `get_model_file` and partners' downloads; copies still
  read by path. A system that can't reopen a handle by a path (no `/proc/self/fd` or `/dev/fd`: a backend run natively
  on Windows) reads the file by its path just after the row check instead. Pinned by `tests/modelFiles/serveByHandle.test.ts` and `tests/modelFiles/door.zip.test.ts`.
- **One delete.** Every way a model goes runs `removeModel` (`modelFiles/removeModel.ts`): the owner's delete, an
  admin's, the discard of a model that couldn't be made, and an account's tool models. It looks at the model's files
  first, and again under the model's row lock at any added since, so a disk error stops it with nothing removed; takes
  its rows down in one transaction under that lock, so a failure leaves the model whole; then removes every file and
  picture they named, in its folder and the old shared ones. A file it can't remove is logged and left; a picture is
  still removed quietly, as pictures aren't under these rules yet. Pinned by `tests/modelFiles/removeModel.test.ts`.
- **A tool's plate owns no file.** A plate with a `sourcePath` reads the tool's file there and only there; nothing places,
  moves or removes a file at its `storagePath`. Pinned by the tool cases in `tests/modelFiles/door.services.test.ts` and
  `removeModel.test.ts`.

A rule goes here only in the pull request whose code follows it everywhere it applies, with the test that pins it.
Reviewers, CodeRabbit included, judge a change's rule conformance against this list only: a rule that isn't here isn't
in force yet, so code that doesn't follow it isn't a finding for that rule. Anything else wrong with the change, a
regression or a bug in what it does, is a finding as usual.

## How it works today

- **Where files live.** Everything is under `FILE_STORAGE`, in folders rendered from the admin's storage template
  (`storageTemplateRules.ts`), so the library stays browsable on disk. A model's rows:
  - `Plate`: its model files;
  - `PrintFile`: supporting files, the prepared print and `LICENSE.txt` (roles `SUPPORTING`, `PREPARED`, `LICENSE`);
  - `PreviewImage`: its pictures, in the model's pictures folder. A model from before those folders keeps its pictures
    in the shared `previews` folder until the storage move reaches it, and `assetPath` (`modelAssets.ts`) reads a
    picture from there while it hasn't moved.

  `Plate` and `PrintFile` rows each keep a `storagePath`, unique within its table. A picture has none: its file is
  named after its row's id, and its row is unique by model and position.

- **One process.** One backend process writes storage. Its worker threads (previews, adapting, Studio) never touch the
  database. Migrate's `pg_restore` writes only its staging database, and its `pg_dump` (the export another instance
  pulls) only reads the live one. In-process coordination is therefore enough.
- **The storage lock.** `utils/storageLock.ts` is one process-wide promise chain, and it isn't reentrant: code holding
  it must not take it again.
  - It guards checks followed by renames, at 19 call sites in 11 files: placing files, moving a model's files when its
    folder changes (`printService.moveAllStored`), merges, the licence file, and GLB, slicer and build-plate previews.
    A move whose save failed with its outcome unread is settled under it before that file's next move picks a place
    (`printService.settleMove`): the file goes back unless its row names the new place.
  - Some call sites also do database work inside it, such as merge's transaction and the licence sync.
  - The per-model locks are `withPrintLock` (repair, `importService.ts`), `perModel` (copies, `modelCopyService.ts`)
    and `withPlateRenameLock` (`printCreation.ts`). That last one is in-process and lasts beyond a transaction: a
    rename holds it from its name commit through its file moves, and a plate's removal, a reorder and an upload's
    older-server lookup take it, so none of them reads or moves a file while a rename moves it. A caller queuing for
    it reaches the checkpoint `lock:plate.rename`.
  - Two Postgres advisory locks last only to their transaction's commit: `lockPlateList` (`printCreation.ts`), taken
    by a plate's append, removal and reorder and by a rename's name commit, and `lockPreviewGallery`
    (`previewImageService.ts`) for the gallery's positions, cover recovery and the thumbnails written in a
    transaction. Repair's swap (`replaceModelPlates`, `modelFilesReplace.ts`) replaces a model's plates without
    `lockPlateList`, inside the model's `withPrintLock`, so nothing above holds off an append or a reorder meanwhile.
- **Writers outside the lock.** Thumbnails, gallery photos, renders and description images are written into the
  pictures folder without the lock, while a folder move may be moving that folder.
- **Claim order.**
  - A plate's file is placed first, as a hard link or else a copy, and its row is created after (`printCreation.ts`).
  - A `PrintFile`'s row is created first, at the placeholder `storagePath` `"pending"`, then given its final path, and
    its file is placed after (`printFileService.ts`). The placeholder is the same for every model and the column is
    unique, so two saves at once collide. A crash before the final path leaves a `"pending"` row that blocks later
    saves; one after it, before the file is placed, leaves a row whose file is missing.
- **Temporary files** go to `os.tmpdir()`: multer's uploads and about 16 other places. In Docker that's another
  filesystem than storage, so placing a file there falls back to a full copy, inside the lock.
- **Repair** (`modelFilesReplace.ts`) replaces the model's plates. It looks at every file of the model first, in one
  storage-lock turn, so a disk error stops it with nothing removed. After the swap it drops only the rows whose files
  are gone, in a second turn where a row whose look fails stays and is logged. The prepared print stays when its file is
  there, and `LICENSE.txt` is written again.
- **Prepared print.** Saving a `PREPARED` file replaces the model's prepared print, so of two sliced files saved
  together only the last is kept.
- **A tool's plates.** A plate with a `sourcePath` reads a tool's file, under `storage/tools/<tool>/<version>/`
  (`toolsService.ts`): one file for every user's copy of the tool's model.
- **Stops and crashes.** The backend has no `SIGTERM` handler, and node runs as PID 1, so a container stop ends in
  `SIGKILL`. Nothing at start-up settles work that a stop cut short.

## How to write a storage test

The harness is in `backend/tests/harness/`; `harness.test.ts` and `kit.test.ts` show it at work.

1. Make users and models with `useStorageKit(app)`, so they're in the test's scope and their bytes are distinct.
2. Make disk errors with `faults.at("<fileState|open|opened>:<site>", nth, code)`. Never spy on `node:fs` for a call
   the door makes. A new call site gets its name in `STORAGE_SITES` and a test that fails it: `door.test.ts` checks.
3. Reach a moment in between with `pauseAt`, `kit.start` and `reachedBy`, change the disk or the rows, then `release`.
   No timers or polls.
4. Check the scenario happened (`reached`, `hits`), then the end state with `checkLibraryInvariants(kit.scope())`. A
   fault, pause or `reached` never met fails the test when it ends.
5. Previews stay off in storage suites (the kit turns them off), as nothing yet waits for them.
6. Don't park inside `withStorageLock` and then wait on anything that takes it: `path.taken` runs inside it during
   licence syncs and moves, and so do the repair's look and sweep.
7. Rows written by hand aren't for the invariants.

## The cases table

`backend/tests/intake/cases.ts` holds what every way in makes of the same files today: uploads, MCP, the consume
folder, files added to a model, a site's page, links, zip links, repairs and copies, each fed the same shapes of files
(model files, documents, a script, CAD sources, sliced files, pictures, zips, a glTF scene, a licence, system files).
`cases.test.ts` runs each cell through its real way in and checks all of what it made: every model, each file's role
and folder, the photos, and what was refused or left out. The browser's own planning of folder uploads, picks and zips
is in `frontend/src/utils/uploadTree.test.ts`.

- **A pull request that changes how files become models** writes its cells' new `today` in the same pull request and
  takes its step off their `changes`. `INTAKE_RECORD=<file>` writes what every cell makes, to look over before it goes
  in. Any other cell that fails is a change the pull request didn't mean.
- **A cell pins what the code does, faults included.** A wrong `today` is fixed in the code, by the step its `changes`
  names, never in the table alone.
- **A finding about a case no cell covers** becomes a new cell first, pinning today's outcome. What it should become is
  the maintainer's call.

## Reviews

Each review round goes in this order, with one push for the whole round:

1. Push every fix.
2. Reply on every thread, declined ones too, naming the commit or the reason, then resolve it. Past 100 threads, page
   through them. CodeRabbit doesn't answer thread replies (`chat.auto_reply` is off), so none of this starts a review.
3. Post one pull-request comment answering the findings that are only in the review's body.
4. Comment `@coderabbitai review`. Pushes aren't reviewed on their own (`auto_incremental_review` is off), and rounds are
   at least 30 minutes apart, since CodeRabbit allows 2 reviews an hour.

The review checks each fix in the new diff, so a case a fix missed comes back as an ordinary finding of that round.
Mention `@coderabbitai` only to ask it something.

- **Nitpicks only** means the latest review raises no comment labelled Critical, Major or Minor. Trivial and nitpick
  items never block: fix them if it's cheap, otherwise answer them.
- **Merging:**
  - Once an incremental review is nitpicks only, ask for `@coderabbitai full review` once. Fix its findings in
    incremental rounds; there's never a second full review.
  - Before merging, list every thread. Answer each one whose last comment is CodeRabbit's and newer than ours.
  - Merge when a later review is nitpicks only and every check is green.
- **A Minor class that's declined** goes into the list below, with the test that pins it, so it doesn't come back from
  the next review's body.

### Standard replies

- "Pre-existing and out of scope: fixed in the step that `<does it>` / tracked in #n."
- "Moved verbatim, with no change in behaviour."
- "Outside the cases table: added as a row for the owner to decide."
- "Not in force yet: `docs/STORAGE_DEVELOPMENT.md` lists the rules this code follows."

### Declined, don't raise

| Finding class | Why it's declined | The test that pins it |
| ------------- | ----------------- | --------------------- |
| _None yet._   |                   |                       |
