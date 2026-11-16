# Filament shelf

The household's filament spools on one shelf. Everyone adds the spools they have, and every model's page shows which
filaments it needs and who has them, so a multicolour print starts with the right spools in hand.

- **The shelf** is the tool's window: a card per spool with its colour, brand, owner and how much is left. Filter it by
  person, material, brand and colour. Your own cards have a ⋮ menu (or right-click): **Edit**, **Used up** and
  **Remove**; everyone else's are read only. **Everyone sees yours** picks whom your spools and your edits reach:
  everyone who can use tools, or only the people you choose.
- **The Filaments tab** on a model's page lists what the picked print profile needs, with a column per person naming
  their spool that matches: **Has it**, **≈ Close**, or nothing. The picker switches between the model's profiles.
  **Edit** changes the picked profile's list in place, on every copy of the model, for everyone who sees what you
  share; the model's other profiles keep theirs. A sync or a metadata refresh never touches an edit; **Reset to
  profile** goes back to the profile's filaments.
- **The badge** in the corner of the model's picture is a ring filled by how many of the filaments the household has.
  Click it to see who has each one, and **Details** for the tab.
- Opened from a model, the shelf also shows what the model needs and offers **Add what this model needs**, one spool
  after another, filled in from the profile.

The filaments come from the print profile Thingport already keeps for the file, so nothing is typed in per model.

## How matching works

- **Material**, by family: PLA, PLA Basic, PLA Matte, PLA+ and Silk PLA are all PLA; PETG HF and PETG-CF are PETG; the
  same goes for ABS, ASA, TPU, PC, PA (nylon), PVA and HIPS. Any other name matches only itself. A filament with no
  material matches any.
- **Colour**, by how different the two look (CIEDE2000): up to 6 is the same, up to 15 is close, anything more doesn't
  match. A filament with no colour matches any colour of its material.
- Each person's best spool wins: the same before close, then the nearer colour. A close spool counts towards a person's
  "2 of 3".

## What it keeps

Everything stays in Thingport, through `thingport.shared`: it reaches no outside service and lists no hosts. Each entry
is its writer's, and every entry read is checked, so a malformed one is skipped. An entry reaches whom its writer
picked under **Everyone sees yours**, spools and edits alike: someone who limits theirs limits their edits too, and the
others see the profile's filaments, or an edit they can see.

- `spool:<id>`, one per spool: `{ brand, line, material, colorName, color, left, grams, note }`, with `color` as
  `#RRGGBB`, `left` as `full`, `half`, `low` or null, and `grams` when the spool was weighed.
- `needs:<model id>:<hash>`, one profile's filaments as someone edited them, tied to the model so its copies find it:
  `{ profile, filaments: [{ type, color, grams }] }`, or `{ profile, filaments: null }` once someone resets it.
  `profile` is `profile:<provider's id>`, the same in every copy, or `file:<file name>` for a 3MF that isn't a
  provider's profile. The newest entry for the profile, whoever wrote it, is the one in force.

## For tool authors

The tool shows a window, a tab and a mark on the picture (`modelPage` in its metadata) working together through
`thingport.shared` and `onChange`:

- `source/colour.js`: hex colours, CIEDE2000 and a plain name for a colour.
- `source/shelf.js`: spools, material families, a model's filaments and the matching (tested in
  `source/test_shelf.mjs`).
- `source/parts.js`: the styles, icons, avatars and sentences the window and the parts share.
- `source/tab.js` (`modelTab`), `source/badge.js` (`modelImage`) and `source/window.js` (the default export).

Build after changing `source/`: `node source/build.mjs`, then `node source/test_shelf.mjs`.
