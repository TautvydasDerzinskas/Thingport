# Past releases' What's new

One file per release, exactly as it shipped in
[`../latest-release-notes.json`](../latest-release-notes.json), so a release's notes aren't lost the next time that
file is overwritten — 1.2.0's were only recoverable from git history. What's new reads them too: its history button
lists every release here older than the instance, and an instance still on one of them is shown its file. An
instance that skipped a release still gets the ones in between from `CHANGELOG.md`.

Before writing a new release's notes, copy the current file here under the version it names. A file named for a
version other than the one inside it is never shown:

```bash
cp release-notes/latest-release-notes.json "release-notes/archive/$(node -p 'require("./release-notes/latest-release-notes.json").version').json"
```

An archived file's `images` are relative to `release-notes/`, not to this folder, since that is where they were
read from. The pictures themselves stay in [`../screenshots/`](../screenshots), named after their version, so an
archived file's paths still point at real files.

Spent system notifications go to [`../../system-notifications-archive.json`](../../system-notifications-archive.json)
instead — see [DEVELOPMENT.md](../../docs/DEVELOPMENT.md#system-notifications) for when an entry is spent.
