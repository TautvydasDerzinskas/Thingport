# Notes

Install **Notes** from **Administration → Tools**. On a model's preview, select the note icon and pick a spot.
Personal notes are yours. Public notes are shared with everyone who can use the tool on this instance.
Open **Tools → Notes** to search the notes you wrote by model title or note text.

The tool uses `thingport.storage` for personal notes and `thingport.shared` for public notes. Both use the tool's
existing storage namespace. Each note keeps fractional coordinates and its model and preview identity in the key.
Uninstalling the tool removes its saved notes along with its other tool data.

The `modelImage` export uses the normal corner slot for its button. On a static preview it also receives
`thingport.preview`, with a `key` for the current image and a themed `root` fitted to the visible image. The runner
recreates that surface when the image changes. Pins and the placement target are drawn inside it.
