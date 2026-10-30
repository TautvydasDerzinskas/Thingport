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
site alike. It still downloads the file first; only the space on disk is saved. Turning it off leaves existing clones
as the ordinary, independent files they are.

### Files stored before

Turning the switch on also goes over the files already stored, in the background, with its progress under **Existing
files** in the same card. It first records a hash for every stored file, then replaces files with the same content by
clones of the oldest one; each keeps its own name, place and owner, only the bytes on disk are shared. **Check
again** (the refresh button) goes over them once more, for files stored while the switch was off or ones that couldn't
be checked before: files a run already made share are recognised and left alone, so checking again costs little. The
saving it reports is an upper bound, on a re-run too: a file that was moved or had its permissions changed since is
cloned again and counted again, though it may already have shared its space. Where the filesystem can't clone, only the hashes are recorded. Turning the switch
off stops a run. If a run hits an error it ends early and the card says so; the server log has the details and **Check
again** carries on. It waits for a move of files to finish, and a move can't be started while it runs.

Each replacement is made beside the original, read back and compared byte for byte, and only put in place after
checking again that the original is still the same file and still where its model keeps it; otherwise it's left as it
is. Until the replacement is in place and the original is known to be unchanged, the original keeps a second name
beside it, which takes no space: if something wrote to it in that instant, it's renamed back over the replacement (a
rename needs no free space), and if Thingport stops in the middle, the next start settles it from what's on disk,
keeping the original's bytes whenever it can't tell. Only files in Thingport's storage folder are touched, and never
a file with another hard link, on another filesystem, in a folder that links out of storage, or that a model left where
it was found. The legacy shared folders (`bundles/`, from before the storage layout was added) are neither cloned,
replaced nor offered as copies to share.

Things to know:

- Don't edit or move files in the storage folder from outside Thingport while it runs. A program that holds a file
  open and writes to it in the instant it's replaced can lose that write, as the operating system offers no way to
  swap two files in one step from here.
- Deleting a model at the very moment its file is replaced can, rarely, leave a clone behind that no model owns. It takes
  space only. Browse files doesn't list it: model and supporting files are listed from their records, and only the
  pictures folders are read from disk, so a clone left in one of those folders shows there. (A run notices most
  deletes of that kind and removes the clone again.)
- The lock that keeps a move of files and a replacement apart works inside one Thingport process, which is how it
  runs; two instances on the same storage aren't supported.
- Extended attributes and access control lists aren't copied to a replacement (permissions and owner are, and times
  to the microsecond, as Node sets nothing finer).
- Snapshots of the storage keep the old copies, so the space freed is an upper bound. A file is recognised as already
  shared by its inode and change time; moving it to another folder or changing its permissions changes the latter, and
  the next check then replaces it by a clone once more, which saves nothing but is counted.
- Rarely, if a crash and a write to the same file both happen in the instant of a replacement, and the file and its
  original both differ from what was checked, both are kept and the log names them; the original sits beside the file
  as a hidden `.reuse.tmp` file until you've looked at it.
- A newer Thingport that re-encodes gallery images differently only means fewer of them match.

Each copy-on-write copy is an independent file, so editing one on disk never changes another user's. Before a stored
file is reused, the copy is read back and checked against the new import, and a stored file that changed since it was
recorded isn't reused.

Copying or backing up the storage folder with a tool that doesn't keep reflinks, such as plain `rsync` or `cp`, writes
every copy out in full at the destination. Reflink-aware tools, such as `cp --reflink` or `btrfs send`, keep the
saving.

## When the files are gone

Thingport keeps the files in the storage folder and only the models' details in the database. The two have to travel
together: moving an instance without its storage volume, restoring a database backup against an empty folder, or
deleting the folder by accident leaves a library listing models with nothing behind them -- no pictures, nothing to
open, print or download.

Thingport notices. When a look at your library finds that a fair share of your models have lost every one of their
files, it offers a repair:

- **Fetch the missing files.** The files of each model are downloaded again from the site it came from. The models
  themselves stay as they are: names, tags, collections, favourites, view counts and collection order are untouched,
  and a model whose site can't be reached is left exactly as it was rather than lost. Models from MakerOnline and
  OwlCAD wait until [Thingport Grab](../../extension/README.md) next visits that site -- MakerOnline's files and
  OwlCAD's CAD projects come only through it -- and the files it brings then replace theirs.
- **Delete these models.** The models with no files are removed for good, with their details, tags and collection
  entries. Models whose files are there aren't touched.

Uploads, and models from a site an admin has turned off, have nowhere to be fetched from, so a fetch leaves them as
they are. A model that had several print profiles comes back with the files a fresh import of its link would bring;
import the other profiles' links again to add them.

Either way the work runs in the background with a bar at the bottom of the app, which can be stopped at any time, and
a notification says how it went. A library's worth of re-imports asks a lot of the sites, so Thingport fetches one
model at a time, and stops when a site asks it to wait, has no downloads left for the day, turns the sign-in down or
blocks it -- start it again later for the rest.

The repair is also in **Models**, behind the cog on the panel on the left, under **Repair**, which checks on demand
and says so when every model has its files.

## How much space it takes

**Administration → Overview** shows the disk space Thingport uses, split into model files, pictures and previews, and
other generated files. [System Health](../guides/system-health.md) warns when the storage folder runs low on space or
can't be written to.

The storage folder is the `thingport_storage` volume, mounted at `/app/storage` in the backend container.
