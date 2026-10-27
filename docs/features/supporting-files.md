# Everything to print it

A model is more than its STL. Thingport keeps everything you need to print it in one place.

- **Model files:** every printable file, with a 3D preview each, and a thumbnail per plate for multi-plate projects.
- **Photos:** a gallery of their own, separate from the files.
- **Supporting files:** assembly instructions, notes, manuals and other documentation, attached to the model.
- **Prepared print:** keep a sliced, ready-to-print file next to the source files, labelled with the printer it was
  prepared for. Clear it when you re-slice.
- **Notes and description:** edit the model's description, and search finds text in your notes.
- **The script it was generated from:** where a model was published with its OpenSCAD source, that comes in too,
  so the model can be generated again rather than only printed as its creator set it up.

Add supporting files or a prepared print from the model page. When you
[upload a folder](../guides/upload-folders.md) with one model per folder, its images become photos and its manuals
and notes are attached automatically.

## Models you can generate again

Some sites let a creator publish the script a model is built from rather than only the finished mesh —
MakerWorld's Parametric Model Maker is one, and Thingiverse's customizable models are another. Any `.scad`
that comes with a model is kept beside it, however it arrived: imported from any site, uploaded in the same
folder as the model, dropped in the consume folder with it, or attached to a model you already have. The
model is then marked **Generated from a script**.

A script on its own isn't a model — it describes one but holds no shape until something runs it — so it can't
be uploaded by itself. Upload it with the model it belongs to, or attach it to one from the model's page.

**Customize…**, in the model's ⋮ menu, opens it in the [Script customizer](../../tools/openscad-customizer)
tool: the same sliders, choices and text boxes the creator set up, read from the script by OpenSCAD itself. What
you generate is saved back into your library as a 3MF. Nothing is sent anywhere — the engine runs in your
browser, so the script, the values you choose and the result all stay on your instance.

**Generative**, above the model grid, narrows the library to the models that have one.

A creator can choose not to share the script, and many don't. That model still imports, and is marked **Script
not shared** so it's clear why there's nothing to customise rather than leaving it looking like a model that
never had one — only its creator can change that. The tool itself has to be installed first, from
**Administration → Tools**, like any other.
