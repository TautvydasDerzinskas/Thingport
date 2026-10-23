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

When several users import the same model, each gets a copy of its files in their own folder. Admins can have
Thingport save the space of those copies with the **Clone identical files (copy-on-write)** switch under
**Administration → Storage → Identical files**. It's off by default, and every file is then stored on its own. Turned
on, a file that's already stored is cloned copy-on-write on btrfs, XFS and ZFS 2.2 or later: the copy takes no extra
space until one of them changes, and each user's file stays their own. On other filesystems the file is stored as
usual.

This covers a model's own files, its supporting files and prepared print files, its gallery images and the images in
its description, and a file is matched against all of those: the same bytes may be one user's model file and another's
supporting file. Plate thumbnails, 3D preview files, profile pictures and files a model keeps in a folder outside its
own (models from before the storage layout was added, or plates left where they were found) aren't shared. Gallery
images are compared as Thingport stores them, after resizing and re-encoding, not as downloaded.

The disk space under **Administration → Overview** counts a copy-on-write clone in full, as the filesystem doesn't
say which parts are shared.

Thingport recognises a file by its content, so this applies to uploads, consume-folder imports and imports from any
site alike. It still downloads the file first; only the space on disk is saved. Only files stored while the switch is
on are recorded and can be reused: files stored while it was off aren't matched, and turning it on doesn't go back
over the files already there. Turning it off leaves existing clones as the ordinary, independent files they are.

Each copy-on-write copy is an independent file, so editing one on disk never changes another user's. Before a stored
file is reused, the copy is read back and checked against the new import, and a stored file that changed since it was
recorded isn't reused.

Copying or backing up the storage folder with a tool that doesn't keep reflinks, such as plain `rsync` or `cp`, writes
every copy out in full at the destination. Reflink-aware tools, such as `cp --reflink` or `btrfs send`, keep the
saving.

## How much space it takes

**Administration → Overview** shows the disk space Thingport uses, split into model files, pictures and previews, and
other generated files. [System Health](../guides/system-health.md) warns when the storage folder runs low on space or
can't be written to.

The storage folder is the `thingport_storage` volume, mounted at `/app/storage` in the backend container.
