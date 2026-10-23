# Plain files on your disk

Thingport stores models as ordinary files in its storage folder, not locked inside a database. Back them up with any
tool you already use, and browse them like any other folder.

## Choose the folder layout

Under **Administration → Storage**, admins build the folder structure from blocks:

- Category or folder, with parent ones as parent folders
- Collection
- Tags
- Creator
- Model name and model ID
- File name, optionally with the plate number first
- A folder with a fixed name of your own, such as `Library`

Every user's files sit in a folder of their own first, so a file ends up at, for example,
`<user>/Props/Workshop/Cable clip/Cable clip.3mf`. The layout can also be typed as text, such as
`{category-or-folder}/{model}/{filename}`.

Everything else that belongs to a model sits beside its files: supporting files and prepared prints next to the model
files, and its pictures (gallery and description images, thumbnails and renders) in an `Images` folder next to them:

```
<user>/Props/Workshop/Cable clip/
  Cable clip.3mf
  Assembly.pdf
  Images/
    <image>.jpg
    Description/
    Thumbnails/
    Renders/
```

With a layout that keeps several models in one folder, such as `{category-or-folder}/{model} - {filename}`, the
pictures folder takes the model's name too: `Cable clip - Images`. Installations from before this layout have their
pictures and supporting files moved in beside the model files in the background the first time they start.

Change the layout later and existing files are moved to match in the background, with progress shown as they go.
Renaming a model renames its files too, so the folders stay readable. **Browse files** shows where each model's files
are now.

## The same model for several users

When several users import the same model, each gets a copy of its files in their own folder. Under **Administration →
Storage → Identical files**, admins choose how a file that's already stored is saved again:

- **Separately** (the default) stores every file on its own.
- **Copy-on-write** clones the stored file on btrfs, XFS and ZFS 2.2 or later. The copy takes no extra space until
  one of them changes, and each user's file stays their own. On other filesystems the file is stored as usual.
- **Hard link** shares the stored file on any filesystem with hard links, such as ext4. Thingport never rewrites a
  model file in place, so this is safe inside Thingport, but:
  - the whole storage folder has to be on one filesystem;
  - editing such a file directly on disk changes it for every user who has it;
  - backups need to keep hard links, or they store each copy in full (`rsync -H`, for example).

The disk space under **Administration → Overview** counts a hard-linked file once, but a copy-on-write clone in full,
as the filesystem doesn't say which parts are shared.

Thingport recognises a file by its content, so this applies to uploads, consume-folder imports and imports from any
site alike. It still downloads the file first; only the space on disk is saved. Files stored before this version are
only matched once Thingport has read their content, so the saving applies mostly to files added from now on.

Files edited on disk outside Thingport are handled too: before a copy is kept, Thingport reads it back and checks it
is exactly the file that was just imported. A stored file that changed since it was recorded isn't shared, and isn't
offered again.

## How much space it takes

**Administration → Overview** shows the disk space Thingport uses, split into model files, pictures and previews, and
other generated files. [System Health](../guides/system-health.md) warns when the storage folder runs low on space or
can't be written to.

The storage folder is the `thingport_storage` volume, mounted at `/app/storage` in the backend container.
