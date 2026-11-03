# Studio

Studio is a small CAD page for designing printable parts from shapes and sketches. Everything you do there, an AI
assistant connected over [MCP](mcp.md) can do too, step by step, and you see its changes on the page as it makes them.

Studio is new, so it's off unless an admin turns it on.

## Turning it on

Set `STUDIO_ENABLED=true` on the backend and restart it. In `docker-compose.yml` or `docker-compose.deploy.yml` the line
is already there:

```yaml
- STUDIO_ENABLED=${STUDIO_ENABLED:-false}
```

so `STUDIO_ENABLED=true` in your `.env` is enough. **Studio** then appears in the sidebar, under **Tools**, for everyone
on the instance. Turned off again, the page, its API and its MCP tools are gone, but the designs stay in the database
for when it's back.

## Designing

A design is a list of features, built in order:

- **Shapes**: box, cylinder, cone, sphere and torus, from the toolbar. Each starts at the middle of the bed, standing on
  it.
- **Sketches**: pick **Sketch** and a plane (top, front or right), then draw rectangles, circles and polygons on it.
  **Extrude** pulls the sketch up into a solid. A shape marked as a **hole** is cut out of the others.
- **Library models**: **Open…** in the design's menu has a **Library** tab with your models' STL, 3MF, STEP, OBJ and
  GLB files. **Open** makes a new design from one; **Insert** brings it into the design that's open. It comes in at its
  own size, centred on the bed, and the design keeps its own copy, so changing the model later doesn't change the
  design. A 3MF brings its first plate. A mesh with gaps can be moved, scaled and exported, but not combined.
- **Combining**: select two bodies or more and pick **Union**, **Subtract** or **Intersect**. The first one you selected
  is the one the others are joined to, cut from or overlapped with.

Designs stay editable: change a box's width, or a sketch's circle, and everything built from it follows. The bodies a
boolean was made from are folded under it in the feature list, and deleting the boolean gives them back.

The mouse works as in most CAD:

- **Left button** selects. Click a body, or drag a box over empty space: from left to right it takes what's wholly
  inside, from right to left also what it touches. <kbd>Shift</kbd> adds to the selection. Right-click a body for its
  menu.
- **Right button** turns the view, the **middle button** (or <kbd>Shift</kbd> with the right) moves it, and the
  **wheel** zooms.
- The **cube** in the corner turns with the view: click a face, an edge or a corner to look from there, or drag it. The
  house below it goes back to the starting view.

**Select** only picks; **Move**, **Rotate** and **Scale** put a gizmo on the body selected. You can also type exact
values in the panel on the right. The panel button in the toolbar hides the feature list or the properties, or both,
to give the view more room. Units are millimetres, and Z is up, as on a printer's bed.

| Key                                                             | Does                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd>             | Select, move, rotate, scale                                                        |
| <kbd>⌘</kbd><kbd>Z</kbd> / <kbd>⇧</kbd><kbd>⌘</kbd><kbd>Z</kbd> | Undo / redo (Ctrl on Windows)                                                      |
| <kbd>Delete</kbd>                                               | Delete what's selected                                                             |
| <kbd>F</kbd>                                                    | Fit the view to the design                                                         |
| <kbd>Esc</kbd>                                                  | Drop a shape half drawn or a selection box, finish the sketch, clear the selection |

**Export STL** in the design's menu saves the visible bodies as one STL for your slicer.

## Working with an AI assistant

Connect an assistant as [the MCP guide](mcp.md) describes, then turn on **Studio designs** in your API token's MCP
permissions (**Profile → API token**). The assistant can then list, read, make and change your designs, and look at
them from any side. Ask it, say, to "make a 60 × 40 × 20 mm box with a 4 mm wall and open top in Studio" and watch the
design build up on the page.

Every change, yours or the assistant's, can be undone, and the assistant can see what you changed meanwhile.

The **Ask AI** box at the bottom of the page will do the same from inside Thingport, with an AI an admin added in
**Administration → AI**. You can already pick which one; sending to it comes in a later update.
