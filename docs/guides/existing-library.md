# Bring your existing model library

Most people arrive at Thingport with years of models already on disk: folders of STLs, downloaded ZIPs, 3MF projects
and photos. You don't have to add them one at a time. Thingport has three ways to bring in what you already have, and
all of them recreate your folders inside Thingport, so the structure you built still works.

## Which one should I use?

| Method                                   | Best for                                                       | How                                    |
| ---------------------------------------- | -------------------------------------------------------------- | -------------------------------------- |
| [Upload files and ZIPs](upload-files.md) | A handful of models, or a few ZIP archives                     | **Add → Upload files** in the browser  |
| [Upload a folder](upload-folders.md)     | A whole folder tree, up to a few thousand files                | **Add → Upload folder** in the browser |
| [Consume folder](consume-folder.md)      | Large libraries, NAS shares, or anything you add on a schedule | Copy files into a folder on the server |

The browser uploads ask you how to import things as you go. The consume folder asks nothing: you choose its rules once
in the admin settings, and it imports whatever lands in it, without a browser tab open.

## The one decision: what counts as a model?

Libraries tend to be organized one of two ways, and Thingport handles both.

- **One model per file.** A folder like `Miniatures/Dragons/` full of separate STLs, where each file is its own thing.
  Choose **Each model file is a separate model**. Every STL, 3MF, STEP or OBJ becomes a model, and every directory
  becomes a folder in Thingport.
- **One model per folder.** A folder like `Printer Upgrades/Fan Duct/` holding `duct.stl`, `clip.stl`, a photo and a
  readme, the way most downloads unpack. Choose **Each folder is one model**. The folder becomes a single model named
  after it: its model files are added as its files, its images become its preview photos, and anything else (PDFs,
  text, slicer settings) is attached. The folders above it become folders in Thingport.

Both choices are offered when you upload a folder, and the consume folder has the same two modes.

## Before you start

- **Tidy the folder names first.** Folder names become folder names in Thingport, and in "one model per folder" mode
  they become model names too. Renaming on disk beforehand is quicker than renaming afterwards.
- **Keep photos next to their models.** In "one model per folder" mode, images in a model's folder become its gallery,
  and the first one becomes its thumbnail when the model files don't carry one.
- **ZIPs are fine as they are.** You don't need to extract them first. You can keep an archive whole, or have it
  unpacked into models and folders.
- **Mind the size limit.** Each file can be up to 512 MB by default. The server admin can change this with
  `IMPORT_MAX_MB`.
- **Start small.** Import one folder, check that the result looks the way you want, then do the rest.

## What happens to my files?

Thingport copies each file into its own storage, in the folder layout chosen under **Administration → Storage**.
Uploads from the browser leave your originals untouched. The consume folder moves files out of the folder it watches,
so copy into it rather than moving your only copy there.

Uploading the same folder twice reuses the folders Thingport already made for it, but the models are added again, with
" (2)" after their names. Thingport doesn't spot duplicates among your own files, so import each folder once.

## Afterwards

Once your models are in, browse them from **Models**, switching the panel on the left to **Folders** to see the tree
you imported. From there you can tag models, group them into collections, and move them between folders.
