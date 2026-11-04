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

Studio opens on the design and the **Ask AI** box alone. The **Edit** button (the pencil) at the top brings in the
toolbar and the side panels, and turns them off again. Out of edit mode you can still turn the view, select bodies for
Ask AI, and undo or redo. The **Features** and **Properties** panels each fold away to their side with the arrow in
their header, leaving a tab with their name there that opens them again; the panel button in the toolbar does the same.

A design is a list of features, built in order:

- **Shapes**: box, cylinder, cone, sphere, torus and thread, from the toolbar. Each starts at the middle of the bed,
  standing on it. A thread is ISO metric (an M8 has a 1.25 mm pitch unless you change it): **External** is a threaded
  rod, **Internal** the solid to subtract for a nut's thread, a little larger by its clearance so a printed rod fits.
- **Sketches**: pick **Sketch** and a plane (top, front or right) or **On a face** of a body, then draw rectangles,
  circles and polygons on it; a rectangle or polygon can have rounded corners. A shape marked as a **hole** is cut out
  of the others. **Extrude** pulls the sketch into a solid: a distance, both ways or from an offset, with sides that
  taper and ends rounded or bevelled. **Revolve** turns it round one of the sketch's axes, all the way or part of it.
  Either can make a new body, or join, cut or intersect one you click. **Add path** puts an SVG path among a sketch's
  shapes, pasted from a drawing program or typed, in the sketch's millimetres with y up.
- **Loft** and **Sweep**: select two sketches or more and **Loft** makes the solid that passes through their outlines in
  the order you selected them, as a bottle from a square base to a round neck. **Sweep** pulls a sketch's outline along
  a path of points (a pipe, a handle, a rail). As in other CAD, the profile stays where you drew it: the path starts on
  the sketch's plane, square to it, and a new sweep's path starts out of the middle of the profile for you to edit.
- **Text**: the **Text** tool writes words as a solid in one step: raised letters on a plane, or on a body's flat face
  embossed (raised from it) or engraved (cut into it). Letter height is a capital's height; 6 mm or more prints well.
  The fonts are the 21 bold faces Thingport carries for tools, each shown in its own face in the list. The words, font
  and size stay editable on the text's sketch, and **Add text** in a sketch puts text among its other shapes. A font
  without a letter you typed (some lack Lithuanian or Polish letters) says so, and names the fonts that have it.
- **Trace picture**: turns a picture's shapes into an outline to make solid: a logo, a silhouette, lettering, a
  drawing. Drop, paste or choose a picture and see what it traces to beside it: dark shapes on a light ground, or
  light on dark with **Invert**; see-through counts as light. The threshold is found for you, or set it yourself; less
  detail smooths away specks and jags. Holes stay holes, and what's inside them stays solid. Make it a solid of a
  height straight away, or only the sketch, to extrude, revolve or cut with. Its size, threshold and detail can be
  changed later in the properties panel, which traces it again.
- **Library models**: **Open…** in the design's menu has a **Library** tab with your models' STL, 3MF, STEP, OBJ and
  GLB files. **Open** makes a new design from one; **Insert** brings it into the design that's open. **Open in
  Thingport Studio**, on a model's page and on its right-click menu in any grid of models, does the same from there,
  asking which file when it has several. It comes in at its
  own size, centred on the bed, and the design keeps its own copy, so changing the model later doesn't change the
  design. A 3MF brings its first plate. A mesh with gaps can be moved, scaled and exported, but not combined. A model
  of several loose pieces comes in as one body, and Studio says how many: **Separate** makes each its own.
- **Combining**: select two bodies or more and pick **Union**, **Subtract** or **Intersect**. The first one you selected
  is the one the others are joined to, cut from or overlapped with. **Hull** wraps one body or more in the tightest
  convex body around them, as a rounded slot from two cylinders.

Designs stay editable: change a box's width, or a sketch's circle, and everything built from it follows. The bodies a
boolean was made from are folded under it in the feature list, and deleting the boolean gives them back.

**Parameters** in the design's menu names the numbers a design hangs on, each with its unit as in other CAD: a length
(mm, cm or in, such as `wall = 2 mm`), an angle (°), or none, for a count. Type `=` and a formula in any size field
(`=wall * 2 + 10`) and the field follows it, marked **ƒx**; change the parameter and every field that follows it
changes too. A formula takes `+ - * / % ^`, brackets, `pi`, functions such as `min`, `max`, `round` and `sqrt`, and
numbers with units (`2 in + 5 mm`, `45°`). A length field takes only a length and a count only a plain number, so
`wall * wall` in a width is refused. A bare number added to a length is in the design's units, and is kept with that
unit written in (`wall + 1` in an inch design is kept as `wall + 1 in`), so switching units never changes a size.
Typing a plain number into the field lets its formula go.

## Units

As in other CAD, each design has its own units, **mm**, **cm** or **in**, switched in the status bar along the bottom
or in **Studio settings** (the gear at the top right), and undone like any change. Every size field shows and takes
them: a bare number is in the design's units, and one typed with its own (`2 in`, `5 mm`, `3"`) is converted. The
status bar, Measure and the print check read out in them, sketches snap to whole millimetres or sixteenths of an inch,
and the bed's grid is in centimetres or half inches. Switching units changes no size: a design is kept in millimetres,
and so are its commands and what an assistant reads, which then talks to you in your units. **Studio settings** also
sets the units new designs start in, kept on your account.

## Changing a body

**Hole** and the **Modify** menu work on a body you have. Each opens a small panel over the view: click what it works
on, set its numbers, watch the preview, then **OK** (or <kbd>Esc</kbd> to cancel). If it can't be done, the panel says
why, and OK waits until it can.

- **Press/pull**: click a flat face and move it out or in, the body growing or shrinking with it.
- **Fillet** and **Chamfer**: click straight edges to round or bevel; click one again to let it go. Two edges meeting at
  a corner meet in a mitre, three at a square corner (as on a box) in a ball. A rounding too big for its faces, or a
  corner it can't blend, is refused rather than made wrong. A cylinder's or an extrude's own rim has its own setting in
  the properties panel.
- **Hole**: click where to drill, into the surface: a depth or right through, plain, counterbored or countersunk.
- **Shell**: hollows the body with walls of a thickness, and clicked flat faces are left open, as a tray's top. Flat
  walls come out exactly that thick. Bodies over 20,000 triangles are refused, so shell parts before combining them.
- **Split**: cuts a body in two by a plane, a flat face or another body; both parts stay editable.
- **Separate parts**: makes each loose piece of a body its own body, shown in its own colour before you press OK. A
  hollow inside a piece stays with it, and pieces that overlap without being joined come apart too: union them
  afterwards to join them properly. Each part moves, turns and scales about the middle of its base. Deleting all the
  parts gives the body back. Also on a body's right-click menu, and on an imported model's properties.
- **Scale**: makes a body bigger or smaller about its own middle.
- **Pattern**: repeats a body in a row, a grid, or round an axis, evenly or over an angle, as one body: subtract a
  pattern of cylinders for a ring of bolt holes. Change the body and every copy follows.
- **Mirror**: reflects a body across a plane, keeping the original as well (half a part made whole) or not.
- **Align**: lines a body up with another, or with the bed: before, at the start, centre or end of, or after it, on
  each axis, with a gap. On top of another body, centred on it, is two clicks.
- **Lay flat**: click a flat face and the body turns so that face is on the bed, as you'd turn a part for printing.
- **Hole** can be **tapped**: threaded for an ISO bolt of that diameter to screw into.

The mouse works as in most CAD:

- **Left button** selects. Click a body, or drag a box over empty space: from left to right it takes what's wholly
  inside, from right to left also what it touches. <kbd>Shift</kbd> adds to the selection. Right-click a body for its
  menu.
- **Right button** turns the view, the **middle button** (or <kbd>Shift</kbd> with the right) moves it, and the
  **wheel** zooms.
- The **cube** in the corner turns with the view: click a face, an edge or a corner to look from there, or drag it. The
  house below it goes back to the starting view.

**Select** only picks; **Move**, **Rotate** and **Scale** put a gizmo on the body selected. You can also type exact
values in the panel on the right. Units are millimetres, and Z is up, as on a printer's bed.

| Key                                                             | Does                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd>             | Select, move, rotate, scale                                                        |
| <kbd>⌘</kbd><kbd>Z</kbd> / <kbd>⇧</kbd><kbd>⌘</kbd><kbd>Z</kbd> | Undo / redo (Ctrl on Windows)                                                      |
| <kbd>Delete</kbd>                                               | Delete what's selected                                                             |
| <kbd>F</kbd>                                                    | Fit the view to the design                                                         |
| <kbd>I</kbd>                                                    | Measure                                                                            |
| <kbd>Esc</kbd>                                                  | Drop a shape half drawn or a selection box, finish the sketch, clear the selection |

While editing, the **status bar** along the bottom gives how many bodies there are, how big they are together and how
much they hold: the selected bodies, or the whole design when nothing is selected. Its **mm / cm / in** switch sets
the design's [units](#units).

**Measure** (the ruler in the toolbar, or <kbd>I</kbd>) works as in other CAD: choose what to pick (points, edges,
faces or bodies) and click. One pick shows its own size: a point's position, an edge's length, a face's area, a body's
size and volume. A second shows the shortest distance between them, drawn as a dashed line, how far apart that is
along X, Y and Z, and the angle between edges or faces; between two bodies, the gap or how much they overlap. A third
click starts again. Measuring changes nothing in the design.

**Check for printing** (the checklist at the right of the toolbar) checks each visible body where it is placed: on the
bed and within it, in one piece, not overlapping another, no overhang that needs support and no wall too thin to print,
for the bed size, overhang angle and thinnest wall you set. A floating body has **Onto bed** to put it down. Below it,
**Measure** gives the gap or the overlap between two bodies, to check a fit or a clearance. Ask AI and an assistant over
MCP run the same check on their own work. As in other CAD, a thread is judged as the plain cylinder it's cut on, so its
ridges don't count as overhang or thin walls.

**Download STL** in the design's menu saves the visible bodies as one STL for your slicer. **Save to Thingport** makes a
model of them in your library instead: the STL, a picture of the view as you see it, and what you asked Ask AI about
the design as its description. Each save is a new model, a copy of the design as it was; an AI connected over MCP, or
Ask AI, can save it too when you ask.

## Working with an AI assistant

Connect an assistant as [the MCP guide](mcp.md) describes, then turn on **Studio designs** in your API token's MCP
permissions (**Profile → API token**). The assistant can then list, read, make and change your designs, and look at
them from any side. Ask it, say, to "make a 60 × 40 × 20 mm box with a 4 mm wall and open top in Studio" and watch the
design build up on the page.

Every change, yours or the assistant's, can be undone, and the assistant can see what you changed meanwhile.

### Ask AI

The **Ask AI** box at the bottom of the page does the same from inside Thingport, once an admin turns on the **Studio
assistant** and picks the AIs it offers (see [AI](ai.md#studio-assistant)). Describe a part, or a change to the design
that's open, and press <kbd>Enter</kbd> (<kbd>Shift</kbd>+<kbd>Enter</kbd> starts a new line).

- The assistant works through the same steps as the toolbar, and each one shows in the view as it lands, listed under
  your request while it works. **Stop** ends the run after the step it's on, and <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>
  takes its steps back one at a time.
- What's selected in the view goes along with your request, so "round the top edges of this" knows what "this" is.
- Each design keeps its own conversation, so "make it taller" follows on from "make a box". Clear it from the box's
  header; the design stays as it is.
- **Pictures**: with an AI that sees pictures (an admin says which, in [AI](ai.md#seeing-pictures)), the box takes up
  to four: the picture button, paste, or drop them on it. A photo or a drawing with sizes on it is something to build
  from; a logo or a silhouette the AI traces into an outline exactly, as **Trace picture** does. The pictures stay
  with the design's conversation.
- A run takes up to 30 steps and 10 minutes. Not every model can use tools: small local models often can't, and the
  box says so when one doesn't. An admin can give a small local model the compact tool set, which covers shapes, text,
  tracing, moving, combining and holes.

The box stays small so you can watch the design change: while the AI works, one line says the step it's on, and then
its answer; the conversation opens from the box's header. The view keeps the design above the box. If you'd rather
read the conversation as it goes, pick **Side panel** under **Ask AI** in **Studio settings** (the gear at the top
right of Studio): it then shows beside the view, and the box keeps only the prompt.
