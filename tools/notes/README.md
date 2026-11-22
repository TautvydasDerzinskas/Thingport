# Notes

Install **Notes** from **Administration → Tools**. A sticky note then sits in the corner of every model's picture, with
the number of notes on it. Its menu adds a note, opens the Notes window, and hides or shows the notes on pictures.

A new note starts in the middle of the picture, ready to type in. Drag it by its grip, or move it with the arrow keys
from the grip, and pick in the toolbar under it whether it shows as a bubble or a sticky note, a sticky's colour, and
who sees it. Personal notes are yours. Public notes are shared with everyone who can use the tool on this instance.
Who sees a note can't be changed once it's saved, since the two kinds are kept in different stores.
Selecting a note opens it in place; your own have a ⋮ menu to edit or delete them, and can be dragged while edited.
The window lists the notes you wrote, to search by model title or note text.

The tool uses `thingport.storage` for personal notes and the viewer's settings (whether notes are hidden, and the
look and colour a new note starts with) and `thingport.shared` for public notes. Both use the tool's existing storage
namespace. Each note keeps fractional coordinates, its look and colour, and its model and preview identity in the key.
A note saved before looks existed shows as a bubble. Uninstalling the tool removes its saved notes along with its
other tool data.

The `modelImage` export uses the normal corner slot for its button. On a static preview it also receives
`thingport.preview`, with a `key` for the current image and a themed `root` fitted to the visible image. The runner
recreates that surface when the image changes. Notes, a note opened in place and the editor are drawn inside it.

`tool.js` and `tool.json` are built from `source/`: change those, then run `node source/build.mjs` and
`node source/test_notes.mjs` from this folder.
