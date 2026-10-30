# Open in your slicer

**Open in Slicer** on a model page hands a file straight to the slicer on your computer, without saving it somewhere
first. When a model has several files, pick one in the **Files** box above the button; opening and downloading both
use it.

The button opens the slicer you used last. Its arrow lists your other slicers, downloads the chosen file, and, for a
model with several files, downloads them all as a zip. On a model that came with the script it was generated from,
**Customize** takes the button's place and your slicers move under the arrow.

Supported slicers:

- Bambu Studio
- OrcaSlicer
- PrusaSlicer
- Cura
- Creality Print
- Anycubic Slicer Next
- Elegoo Slicer
- Snapmaker Orca
- eufyMake Studio

Switch on the ones you have installed under **Configuration → Slicer**, from the user menu: double-click a slicer, or
right-click it and choose **Activate** (or **Deactivate**). With none switched on, or only **Other / Manual**, the
button downloads the file instead, for when you'd rather open files yourself.

## Thingport Bridge

Bambu Studio, PrusaSlicer, Cura and Anycubic Slicer Next won't open a link from a self-hosted server on their own.
[Thingport Bridge](../../bridge/README.md) is a small helper app for Windows, macOS and Linux that takes the link from
Thingport and opens the file in the slicer. Download it from Thingport's **Downloads** page.

## Models generated in colour

A model generated in colour from its script, in the [customizer](supporting-files.md#models-you-can-generate-again)
or the Script customizer tool, is saved as a 3MF that names its colours twice over: as a colour group, which Bambu
Studio and OrcaSlicer offer to put on filaments when they open it, and as per-face painting, which Bambu Studio,
OrcaSlicer and PrusaSlicer put on filament slots straight away. A model with more than 16 colours, more than a slicer
has filament slots for, keeps only the colour group. Downloaded as an STL, it keeps only its shape.

## MakerWorld models in other slicers

MakerWorld files are Bambu Studio projects, which many other slicers open without their colours or print settings. For
those, Thingport offers **Open normalized**, which opens a converted copy instead. See
[normalized MakerWorld 3MFs](normalized-3mf.md).

Opening a model in a slicer counts towards its prints on the [dashboard](dashboard.md) and shows up in your
[activity](profile-and-activity.md).
