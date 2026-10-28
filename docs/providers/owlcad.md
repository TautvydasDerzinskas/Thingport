# <img src="../assets/providers/owlcad.svg" alt="" width="36" height="36" align="absmiddle"> OwlCAD

A parametric CAD app that runs in the browser, at [owlcad.com](https://owlcad.com). Its
[gallery](https://owlcad.com/gallery) holds two quite different things: a large library of CC0 and CC-BY **parts**,
and the **CAD projects** its users share. Nothing there needs an account, and Thingport keeps no credentials for it
at all.

| At a glance    |                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------- |
| Sign-in        | None -- nothing to connect                                                                  |
| Thingport Grab | Recommended -- a CAD project's file is built by OwlCAD's editor, so only Grab can bring one |
| FlareSolverr   | Not used                                                                                    |
| Imports        | Models, filed by OwlCAD's category. No collections or likes: its gallery is one list        |

## How it works

OwlCAD is a Firebase app. Its gallery is a public database collection, its library parts are files in its storage,
and the one call Thingport makes to it answers without a sign-in -- so imports need nothing set up.

What differs is where a model's geometry comes from, and it decides how it imports.

- **Library parts** are a stored mesh. Thingport downloads it and converts it to an STL, placed exactly as OwlCAD
  places one: turned Z-up and scaled so its longest side is 40 mm, which is the size the gallery states. These import
  on their own, with no Grab and no sign-in.
- **CAD projects** have no file anywhere. A project is a script -- primitives, booleans, fillets, generators like
  gears and Gridfinity bins -- and OwlCAD's own kernel is what turns it into geometry, in the page, when you use
  **File → Export**. There is nothing for Thingport to download, so [Thingport Grab](../../extension/README.md)
  opens the model in OwlCAD's editor, exports it there as a 3MF and hands the file back. The few projects that are
  nothing but an imported mesh are the exception: those Thingport converts itself, like a part.

Paste a model link (`https://owlcad.com/gallery/<id>`, with or without the name after it) in Thingport, or import it
from its page with Grab. A link to the model open in the editor, `https://owlcad.com/app?shared=<id>`, works too --
that is what OwlCAD's **Share** button hands out.

### Importing a CAD project

With Grab allowed on OwlCAD, importing one from its page just works: Grab opens it in the editor in a tab of its own,
exports it and closes the tab again. It takes a few seconds while OwlCAD loads its kernel and builds the geometry.

A project imported anywhere else -- pasted in the app, or started from the import queue -- has nothing to download,
so it **waits** instead. Thingport notifies you, and Grab brings it in the next time you open owlcad.com. A model
that fails three times is dropped with a notification saying why.

Two things OwlCAD's editor won't do:

- A model over **250,000 triangles** is refused by the bridge Grab exports through. Open it in OwlCAD and use
  **File → Export** by hand instead.
- A project that is no longer shared can't be opened, so it can't be exported.

## Categories, authors and licences

- **Categories.** OwlCAD has 23 of them and no ids for them: a model carries its category's name, such as
  `Printer Parts`. Map them to yours in **Configuration → Categories**, as for any other site.
- **Authors.** A library part credits the pack's original creator -- Kenney, Quaternius, Adafruit and others -- and
  links to their own page on their own site, since OwlCAD has no creator pages. A CAD project has no author at all:
  OwlCAD shows none either, so one imports without one.
- **Licences.** Library parts are CC0, CC-BY or MIT, and their attribution comes with them. OwlCAD states no licence
  for a CAD project.

## Setup

None. OwlCAD needs no account, no API key and nothing in **Configuration → Providers** -- it is connected from the
start. For CAD projects, allow [Thingport Grab](../../extension/README.md) on owlcad.com: open Grab's popup, find
**OwlCAD** under **Providers** and choose **Enable**.
