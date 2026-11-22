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
- **One rule for junk.** `isJunk` (`files/names.ts`) decides what a computer left among files. `/upload`, the zip
  listing, `/import/zip` (before its empty check and its job's total) and the consume folder drop it. Pinned by the
  cases table (A14, C14 and Z14) and `tests/upgradeCompat.test.ts`'s older Grab.

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
  - It guards checks followed by renames, at 15 call sites in 10 files: placing files, moving a model's files when its
    folder changes (`printService.moveAllStored`), merges, the licence file, and GLB, slicer and build-plate previews.
  - Some call sites also do database work inside it, such as merge's transaction and the licence sync.
  - The only per-model locks are `withPrintLock` (repair, `importService.ts`) and `perModel` (copies,
    `modelCopyService.ts`).
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
- **Repair** (`modelFilesReplace.ts`) deletes every `PrintFile` of the model, including supporting files, the prepared
  print and `LICENSE.txt`, then keeps only the scripts it downloaded again. It doesn't write the licence file again.
- **Prepared print.** Saving a `PREPARED` file replaces the model's prepared print, so of two sliced files saved
  together only the last is kept.
- **Model delete** is written three times, and none of them is one transaction: `printEditService.deletePrint`,
  `adminService` and `printCreation.discardPrintOrThrow`.
- **Plates left where they were found.** A plate with a `sourcePath` points at a file outside storage
  (`storedContent.ts`). It isn't Thingport's file to move, share or delete.
- **Stops and crashes.** The backend has no `SIGTERM` handler, and node runs as PID 1, so a container stop ends in
  `SIGKILL`. Nothing at start-up settles work that a stop cut short.

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
