# 3D previews

Check what a file actually is before you slice it. Every model page has an interactive 3D viewer that runs in your
browser, so there's nothing to install.

- **Formats:** STL, 3MF, OBJ and STEP. LightBurn projects get a picture of their design.
- **Multi-plate 3MF projects** show a thumbnail for every plate, with how many objects each one holds.
- **Model colour:** pick the colour the preview is shown in.
- **Photos** sit in their own gallery, separate from the printable files.

## Card thumbnails

Model cards in the library show a small 3D thumbnail. A sliced 3MF's own thumbnail is used when it has one. For other
files, admins choose under **Administration → Rendering** how missing thumbnails are made:

- **Automatic:** rendered in the browser as a card scrolls into view, then saved for everyone.
- **On demand:** a card shows a **Generate preview** button instead.
- **Disabled:** cards show a placeholder. The full viewer still works when the model is opened.

## Very detailed models

Models with more than a million triangles can be slow to download and rotate, especially on phones and older
computers. With **Simplify previews** on, under **Administration → Rendering**, their preview is reduced to about a
million triangles, keeping the shape to within 1% of the model's size. Only the preview changes: model files, downloads
and anything sent to a slicer are never touched.

The first preview of a very large model can take a minute to prepare, and uses the most memory on the server. If
previews fail, check memory in [System Health](../guides/system-health.md).
