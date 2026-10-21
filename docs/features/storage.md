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

## How much space it takes

**Administration → Overview** shows the disk space Thingport uses, split into model files, pictures and previews, and
other generated files. [System Health](../guides/system-health.md) warns when the storage folder runs low on space or
can't be written to.

The storage folder is the `thingport_storage` volume, mounted at `/app/storage` in the backend container.
