<!-- Written by scripts/sync-kinds.mjs from backend/src/files/kinds.json: change the table, then run npm run kinds:sync. -->

# File kinds

Thingport tells what a file is by its name: its extension, or for a few kinds the whole name. Case doesn't count, and
a name is read as Thingport keeps it, so `part.STL ` with a space at the end is an STL.

| Kind                    | Files                                                                                                                                 | What they are                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Model files             | `.stl`, `.3mf`, `.step`, `.stp`, `.obj`, `.glb`, `.gltf`                                                                              | 3D models Thingport shows and slicers open. A .gltf is packed into a .glb with the files it names. |
| Laser files             | `.lbrn`, `.lbrn2`                                                                                                                     | LightBurn projects.                                                                                |
| Sliced files            | `.gcode.3mf`, `.gcode`, `.gco`, `.bgcode`                                                                                             | Prints a slicer has prepared. A sliced 3MF is told apart from a model's 3MF by its name.           |
| CAD sources             | `.f3d`, `.f3z`, `.fcstd`, `.iges`, `.igs`, `.sldprt`, `.sldasm`, `.ipt`, `.iam`, `.x_t`, `.x_b`, `.3dm`, `.skp`                       | The design files a CAD program edits. STEP is read as a model file, since it shows.                |
| Scripts                 | `.scad`                                                                                                                               | OpenSCAD scripts a model is generated from.                                                        |
| Pictures                | `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.gif`, `.svg`                                                                              | Photos and drawings.                                                                               |
| Documents               | `.pdf`, `.txt`, `.md`, `.rtf`, `.doc`, `.docx`, `.odt`, `.csv`, `.tsv`, `.xls`, `.xlsx`, `.ods`, `.dxf`                               | Instructions, notes and data.                                                                      |
| Licences                | named `LICENSE`, `LICENSE.txt`, `LICENSE.md`                                                                                          | A creator's licence file, by its name.                                                             |
| Archives                | `.zip`, `.tar`, `.tar.gz`, `.tgz`, `.7z`, `.rar`, `.gz`                                                                               | Files packed together.                                                                             |
| Scene parts             | `.bin`                                                                                                                                | A glTF scene's geometry, which goes into the scene.                                                |
| Animation and CG scenes | `.fbx`, `.max`, `.c4d`, `.ma`, `.mb`, `.3ds`, `.dae`, `.lwo`, `.lxo`, `.abc`, `.usd`, `.usda`, `.usdc`, `.usdz`                       | Scenes from animation and rendering programs.                                                      |
| Programs                | `.exe`, `.msi`, `.dll`, `.bat`, `.cmd`, `.com`, `.scr`, `.ps1`, `.vbs`, `.jar`, `.apk`, `.app`, `.dmg`, `.pkg`, `.deb`, `.rpm`, `.sh` | Software to install or run.                                                                        |
| System files            | by their names                                                                                                                        | What a computer leaves among files: __MACOSX, hidden files, Thumbs.db and desktop.ini.             |
| Other files             | `.amf`, `.ply`                                                                                                                        | Anything else, a file without an extension too. AMF and PLY are among them.                        |
