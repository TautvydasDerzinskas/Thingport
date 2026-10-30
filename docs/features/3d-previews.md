# 3D previews

Check what a file actually is before you slice it. Every model page has an interactive 3D viewer that runs in your
browser, so there's nothing to install.

- **Formats:** STL, 3MF, OBJ and STEP. LightBurn projects get a picture of their design.
- **Multi-plate 3MF projects** show a thumbnail for every plate, with how many objects each one holds.
- **Model colour:** pick the colour the preview is shown in. It's greyed out for a file that carries colours of its
  own.
- **Multicolour models** -- a painted 3MF project, one the
  [customizer](supporting-files.md#models-you-can-generate-again) coloured, or a STEP assembly whose parts carry
  colours -- are shown in their own colours instead. One that came without pictures gets a render in those colours as
  its first picture. Cards show it when [**Model cards**](appearance.md) is set to **Images**; set to **3D renders**,
  they stay in your render colour, so the library still reads as one set.
- **Photos** sit in their own gallery, separate from the printable files.
- **Print quality:** a tick or a warning next to **3D Preview** says whether the files have problems that could spoil
  a print. See [print quality checks](print-quality.md).

## Card thumbnails

Model cards in the library show a small 3D thumbnail, whatever the format: STL, 3MF, OBJ or STEP. A sliced 3MF's own
thumbnail is used when it has one. For other files, admins choose under **Administration → Rendering** how missing
thumbnails are made:

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
