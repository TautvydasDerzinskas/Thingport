# Open in your slicer

**Open in Slicer** on a model page hands a file straight to the slicer on your computer, without saving it somewhere
first. When a model has several files, you pick which one.

Supported slicers:

- Bambu Studio
- OrcaSlicer
- PrusaSlicer
- Cura
- Creality Print
- Anycubic Slicer Next
- Elegoo Slicer
- Snapmaker Orca

Choose yours under **Configuration → Slicer**, from the user menu: double-click a slicer, or right-click it and choose
**Activate**. **Other / Manual** hides the button, for when you'd rather download files and open them yourself.

## Thingport Bridge

Bambu Studio, PrusaSlicer, Cura and Anycubic Slicer Next won't open a link from a self-hosted server on their own.
[Thingport Bridge](../../bridge/README.md) is a small helper app for Windows, macOS and Linux that takes the link from
Thingport and opens the file in the slicer. Download it from Thingport's **Downloads** page.

## MakerWorld models in other slicers

MakerWorld files are Bambu Studio projects, which many other slicers open without their colours or print settings. For
those, Thingport offers **Open normalized**, which opens a converted copy instead. See
[normalized MakerWorld 3MFs](normalized-3mf.md).

Opening a model in a slicer counts towards its prints on the [dashboard](dashboard.md) and shows up in your
[activity](profile-and-activity.md).
