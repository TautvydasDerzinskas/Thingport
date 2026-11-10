# Normalized MakerWorld 3MFs

Models on MakerWorld are Bambu Studio projects. Bambu Studio and OrcaSlicer open them fine, but other slicers often
lose the painted colours, the filament colours, the plates or the designer's print settings, or don't import some
parts at all.

For a MakerWorld 3MF, Thingport offers **Open normalized in &lt;slicer&gt;** in the **Open in** menu next to the regular **Open**
button, and in the **⋮** menu, when your slicer is one of:

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
plates and painting stay as they are, while the designer's printer profile and any G-code are replaced or taken out (see below). (The file
is also marked as a Bambu project, as Snapmaker Orca would otherwise split its parts apart.) Objects are moved from
the designer's bed to the middle of the same plate on a 270 mm bed (the Snapmaker U1), since they would otherwise
sit beside it, and the printer is set to the Snapmaker U1 with its bed, height and absolute extrusion, and the process
preset is the U1's counterpart of the one the designer started from. The U1 has 0.2, 0.4, 0.6 and 0.8 mm nozzles, so the designer's first nozzle maps to the nearest of those
(0.4 mm if the file names none), and the printer and process presets are the U1's for that size. The designer's other nozzles are removed, so Orca doesn't show a dual-nozzle printer. The wipe tower moves with the
objects and stays entirely on the bed, brim and ribs included. Layer-based pauses and colour changes the designer set (`custom_gcode_per_layer.xml`) are dropped, as their G-code is Bambu-specific. Each filament keeps the preset name the designer gave it, with its values unchanged in the file; no U1 preset replaces it, and an empty name becomes "Generic". The other slicers above get the flat copy.

The [MakerWorld 3MF normalizer](../../tools/makerworld-3mf-normalizer) tool makes such a copy too, of a model's 3MF or
one on your disk, to download, save as a new model or add to the model it came from. An admin installs it from
**Administration → Tools**.

## Without Thingport

[Thingport Grab](../../extension/README.md), the browser extension, does the same on MakerWorld itself: its
**Download normalized** button converts a model in your browser, with no Thingport instance needed.
