# Normalized MakerWorld 3MFs

Models on MakerWorld are Bambu Studio projects. Bambu Studio and OrcaSlicer open them fine, but other slicers often
lose the painted colours, the filament colours, the plates or the designer's print settings, or don't import some
parts at all.

For a MakerWorld 3MF, Thingport offers **Open normalized in &lt;slicer&gt;** next to the regular **Open** button when
your slicer is one of:

- PrusaSlicer
- Cura
- Creality Print
- Anycubic Slicer Next
- Elegoo Slicer
- Snapmaker Orca
- eufyMake Studio

It prepares a converted copy that keeps painted colours, filament colours, plates and the designer's print settings in
a form that slicer understands, then opens it. Your stored file is never changed. If a file can't be converted, use the
regular **Open** instead.

Snapmaker Orca is a fork of Bambu's own slicer family and reads its 3MF layout, so it gets a different copy: parts,
plates and painting stay as they are, and only the designer's printer profile and any G-code are taken out. (The file
is also marked as a Bambu project, as Snapmaker Orca would otherwise split its parts apart.) Objects are moved from
the designer's bed to the middle of the same plate on a 270 mm bed (the Snapmaker U1), since they would otherwise
sit beside it, and the designer's nozzle setting is dropped so Orca doesn't show a dual-nozzle printer. The other
slicers above get the flat copy.

The [MakerWorld 3MF normalizer](../../tools/makerworld-3mf-normalizer) tool makes such a copy too, of a model's 3MF or
one on your disk, to download, save as a new model or add to the model it came from. An admin installs it from
**Administration → Tools**.

## Without Thingport

[Thingport Grab](../../extension/README.md), the browser extension, does the same on MakerWorld itself: its
**Download normalized** button converts a model in your browser, with no Thingport instance needed.
