# Adapted 3MFs

A 3MF is usually a project of the slicer it was made in: a MakerWorld model is a Bambu Studio project, a Printables
one often a PrusaSlicer one. Another slicer can open such a file without its painted colours, its parts or plates, or
the designer's print settings, or ask about the file's version or settings it names differently.

When your slicer would open a file better as a copy made for it, Thingport offers **Open adapted in &lt;slicer&gt;**
next to the regular **Open**. The copy is made on your Thingport instance, so it works offline too, and the stored
file isn't changed.

Thingport reads what kind of 3MF each file is when it's stored. Copies are made of Bambu Studio projects, the kind
Bambu Studio, OrcaSlicer and the slicers built on them save, whichever site the model is from, of PrusaSlicer
projects for those slicers (see [below](#prusaslicer-projects)), and of 3MFs in several colours for the slicers that
read no 3MF colours (see [colours](#colours-in-other-3mfs)). Any other 3MF opens as it is.

| Slicer                                                                                     | The adapted copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PrusaSlicer, eufyMake Studio                                                               | Joins your own printer, filament and print settings. The designer's layer height, walls, infill and supports are set on each object, and a part's own walls, top and bottom layers and infill on that part. Multi-part objects keep their parts, modifiers and negative and support volumes too, and the painted colours land on your extruders.                                                                                                                                                                                                                                                            |
| Cura                                                                                       | A Cura project for any printer (a UCP, Cura 5.7 and later). Opened as UCP, the designer's layer height, adhesion and kind of supports go onto your printer's settings, and every object keeps its extruder. Multi-part objects keep their parts, each on its own extruder, and the designer's walls, top and bottom layers, infill and whether to print supports are set on each object. Modifiers, negative parts and support volumes become Cura's matching mesh types. Imported as models, it's the same without the print settings, and only parts keep their extruders. Cura reads no painted colours. |
| Bambu Studio, QIDI Studio, OrcaSlicer, Snapmaker Orca, Elegoo Slicer, Anycubic Slicer Next | Opens as the slicer's own project, parts, plates, painting and the designer's settings, without its questions about the file's version. A setting it names differently is renamed, to the nearest of its choices where it has fewer.                                                                                                                                                                                                                                                                                                                                                                        |
| Creality Print                                                                             | Keeps the parts, plates, painting and the designer's settings, under the names Creality Print gives them. It still asks which of your printers to use, as it does for any project from another slicer.                                                                                                                                                                                                                                                                                                                                                                                                      |

Cura older than 5.7 doesn't know a UCP and offers to open its copy as a project with a printer of its own: choose
**Import models** there.

A slicer that already opens a file as well as it can, such as Bambu Studio with a Bambu Studio project, gets the file
itself. Prints, 3MFs with G-code in them, are never adapted.

If a copy can't be made, Thingport says so; use the regular **Open** instead.

Each slicer's copies can be switched off: right-click the slicer under **Configuration → Slicer** and switch off
**Open adapted**. Its files then open as they are.

## PrusaSlicer projects

Bambu Studio, OrcaSlicer and the slicers built on them open a PrusaSlicer or eufyMake Studio project with its parts
and painting, but without the designer's settings, filament colours or beds, and won't open one painted with a 17th
filament or later, which PrusaSlicer 2.9.6 writes in a newer way. Their copy is a project of their own instead:

- Parts, modifiers and negative and support volumes stay what they are, and the painting is kept, seams and supports
  too.
- Each of PrusaSlicer's beds is a plate, its objects where they were.
- The designer's layer height, walls, top and bottom layers, infill, and the supports, brim, raft, ironing and fuzzy
  skin they switched on are set on each object, in the slicer's own names. What the designer set on an object or a
  part is kept on it. The rest of a PrusaSlicer project is its printer's profile, so your own presets stay as they are.

Made for your printer (below), the copy names your slicer's presets for it instead, with the designer's settings as
changes to its process, the filament colours, and each bed a plate on your printer's bed. A PrusaSlicer project names
no build plate, so the copy names Textured PEI Plate, the one Bambu Lab's printers start with; pick yours in the slicer
if it's another.

## Colours in other 3MFs

A 3MF from a CAD app or a generator, Thingport's own tools among them, can give its objects, parts and triangles
colours. Bambu Studio, OrcaSlicer and the slicers built on them read those; PrusaSlicer, eufyMake Studio and Cura read
none, and open such a file in one colour. When a file has several colours, their copy gives each colour an extruder:

- PrusaSlicer and eufyMake Studio get each object and part on its colour's extruder, and a triangle of another
  colour painted with its own. A file whose every triangle is painted the way PrusaSlicer reads opens as it is.
- Cura gets each object and part on its colour's extruder, opened as UCP. It reads no painting, so a mesh whose
  triangles have colours of their own prints in one. Imported as models, only the parts of an object made of several
  keep their extruders: Cura puts a whole object on the extruder you have selected as it adds it.

Colours are numbered as they're first met, from the first object to the last, unless the file numbers them itself
(Thingport's keyring and QR code tools do). A file in another unit than millimetres, such as metres, is converted.
The copy joins your own printer, filament and print settings: load the filaments in the order of the extruders.

## Made for your printer

A project names the printer it was made for: a MakerWorld model is often made for an A1 mini or an H2D, not for the
printer you print on. Bambu Studio, QIDI Studio, OrcaSlicer, Snapmaker Orca, Elegoo Slicer and Anycubic Slicer Next then open it on
the designer's printer, or on one they build from the file if they don't have it.

Add your printers under **Configuration → Printers**, and their copies are made for your printer instead:

- The copy names the printer, process and filament presets your slicer has for it. The printer is exactly as your
  slicer has it. The process is the one at the height and quality the designer's started from ("0.20mm Strength"),
  and each filament the same product for your printer, or a generic one of its type; one your slicer has none of
  that type for keeps the designer's. The changes the designer made to
  their process and filaments are kept on top, as the slicer itself keeps them.
- Each plate's objects move onto your printer's bed, and so does its wipe tower.
- Parts and painting stay as they are.

Which printer is set per slicer: right-click it under **Configuration → Slicer**, then **Printer**. With none set,
opening a model adapted in one of the slicers above asks **Which printer is this for?** when the slicer has a preset
for one of your printers, and remembers your answer for that slicer unless you untick **Remember**; otherwise the copy
isn't made for a printer. A project made for the very preset you'd pick needs no copy for it.

**Configuration → Printers** shows your printers as tiles: double-click one to add or remove it, and right-click it for
its nozzle and the slicers it's used with. **Add** lists every printer the slicers know, with their pictures. Printers
your library points at are suggested beside yours: those your prints were sliced for, and those several of your
projects are made for. Turn one down with **Not mine** and it stays there, dimmed. Signed in to MakerWorld, which is
your Bambu Lab account, you're asked whether to find your printers there; Thingport reads the account's printer list
only when you say yes, takes only each printer's model and nozzle, and keeps nothing else of it.

Creality Print asks which printer to use itself, and PrusaSlicer, eufyMake Studio and Cura put a copy on the printer
you have selected in them, so their copies don't change with your printer. The printer's own settings, its start
G-code among them, are your slicer's, so a slicer that doesn't have your printer's preset installed builds one from
the file and says so; install the printer in your slicer. A printer whose slicer preset uses absolute extrusion can't
print a project's prime tower: the slicer tells you when it slices.

The [MakerWorld 3MF normalizer](../../tools/makerworld-3mf-normalizer) tool makes a converted copy too, of a model's
3MF or one on your disk, to download, save as a new model or add to the model it came from. An admin installs it from
**Administration → Tools**.

## Without Thingport

[Thingport Grab](../../extension/README.md), the browser extension, makes the same copy of a MakerWorld model in your
browser with its **Download adapted** button: for the slicer your Thingport instance opens files in, or without an
instance, the one PrusaSlicer and the slicers like it read. It offers none for a slicer whose **Open adapted** is off,
and doesn't make copies for your printer yet.
