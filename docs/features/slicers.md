# Open in your slicer

**Open in Slicer** on a model page hands a file straight to the slicer on your computer, without saving it somewhere
first. When a model has several files, pick one in the **Files** box above the button; opening and downloading both
use it.

The button opens the slicer you used last. Its arrow lists your other slicers, downloads the chosen file, and, for a
model with several files, downloads them all as a zip. On a model that came with the script it was generated from,
**Customize** takes the button's place and your slicers move under the arrow.

Supported slicers:

- Bambu Studio
- QIDI Studio
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

Bambu Studio, QIDI Studio, PrusaSlicer, Cura and Anycubic Slicer Next won't open a link from a self-hosted server on their own.
[Thingport Bridge](../../bridge/README.md) is a small helper app for Windows, macOS and Linux that takes the link from
Thingport and opens the file in the slicer. Download it from Thingport's **Downloads** page. To
[update it](../../bridge/README.md#update), install the new version over the old one; a notification tells you when
there's a newer one.

OrcaSlicer, Creality Print, Elegoo Slicer, Snapmaker Orca and eufyMake Studio download the link themselves. When one
can't, for instance because it doesn't trust your instance's certificate, send it through the Bridge too: right-click
it under **Configuration → Slicer** and switch on **Through Thingport Bridge**. Every way of opening a model in that
slicer then goes through the Bridge, which downloads the file and hands it over. Slicers that open through the Bridge
show its cable on their tile.

## Models generated in colour

A model generated in colour from its script, in the [customizer](supporting-files.md#models-you-can-generate-again)
or the Script customizer tool, is saved as a 3MF that names its colours twice over: as a colour group, which Bambu
Studio and OrcaSlicer offer to put on filaments when they open it, and as per-face painting, which Bambu Studio,
OrcaSlicer and PrusaSlicer put on filament slots straight away. A model with more than 16 colours, more than a slicer
has filament slots for, keeps only the colour group. Downloaded as an STL, it keeps only its shape.

## Files from other slicers

A 3MF made in one slicer, such as a MakerWorld model made in Bambu Studio, can open in another without its colours,
parts or print settings. When yours would, Thingport offers **Open adapted**, which opens a copy made for your slicer
instead, and for your printer where the slicer takes one. Right-click a slicer under **Configuration → Slicer** to
switch its **Open adapted** off or on, and to pick its **Printer**. See [adapted 3MFs](adapted-3mf.md).

Opening a model in a slicer counts towards its prints on the [dashboard](dashboard.md) and shows up in your
[activity](profile-and-activity.md).
