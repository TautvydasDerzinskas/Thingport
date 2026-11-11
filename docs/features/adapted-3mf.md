# Adapted 3MFs

A 3MF is usually a project of the slicer it was made in: a MakerWorld model is a Bambu Studio project, a Printables
one often a PrusaSlicer one. Another slicer can open such a file without its painted colours, its parts or plates, or
the designer's print settings, or ask about the file's version or settings it names differently.

When your slicer would open a file better as a copy made for it, Thingport offers **Open adapted in &lt;slicer&gt;**
next to the regular **Open**. The copy is made on your Thingport instance, so it works offline too, and the stored
file isn't changed.

Thingport reads what kind of 3MF each file is when it's stored. Copies are made of Bambu Studio projects, the kind
Bambu Studio, OrcaSlicer and the slicers built on them save, whichever site the model is from. Any other 3MF, a
PrusaSlicer project included, opens as it is.

| Slicer                                                                        | The adapted copy                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PrusaSlicer, eufyMake Studio                                                  | Joins your own printer, filament and print settings. The designer's layer height, walls, infill and supports are set on each object, and a part's own walls, top and bottom layers and infill on that part. Multi-part objects keep their parts, modifiers and negative and support volumes too, and the painted colours land on your extruders. |
| Cura                                                                          | Multi-part objects keep their parts, each on its own extruder, and the designer's walls, top and bottom layers, infill and whether to print supports are set on each object. Modifiers, negative parts and support volumes become Cura's matching mesh types. Cura reads no painted colours.                                                     |
| Bambu Studio, OrcaSlicer, Snapmaker Orca, Elegoo Slicer, Anycubic Slicer Next | Opens as the slicer's own project, parts, plates, painting and the designer's settings, without its questions about the file's version. A setting it names differently is renamed, to the nearest of its choices where it has fewer.                                                                                                             |
| Creality Print                                                                | Keeps the parts, plates, painting and the designer's settings, under the names Creality Print gives them. It still asks which of your printers to use, as it does for any project from another slicer.                                                                                                                                           |

A slicer that already opens a file as well as it can, such as Bambu Studio with a Bambu Studio project, gets the file
itself. Prints, 3MFs with G-code in them, are never adapted.

If a copy can't be made, Thingport says so; use the regular **Open** instead.

The [MakerWorld 3MF normalizer](../../tools/makerworld-3mf-normalizer) tool makes a converted copy too, of a model's
3MF or one on your disk, to download, save as a new model or add to the model it came from. An admin installs it from
**Administration → Tools**.

## Without Thingport

[Thingport Grab](../../extension/README.md), the browser extension, converts a MakerWorld model in your browser with
its **Download normalized** button, with no Thingport instance needed.
