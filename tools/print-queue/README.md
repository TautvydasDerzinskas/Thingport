# Print queue

A print queue the household shares. Add a model from its page, see who has what waiting or printing, drag each print
to **Printing**, **Printed** or **Failed**, and keep the history, so nobody prints the same thing twice by accident.

- **Add to print queue**, under Tools in the menu beside a model's Open button, adds it without opening anything. When
  someone already has the model waiting or printing, it asks first: printing it twice is fine, by accident isn't.
- On the board, **Add model** at the end of **Queued** opens the model picker: pick one or several and they go to the
  bottom of your queue. One already waiting or printing asks first, as above; with several, those are skipped.
- In a model grid, turn on edit mode, select one or more models and open the **Print queue** menu in the toolbar. **Add to print queue**
  adds them in grid order and skips models already waiting or printing. **Remove from print queue** removes your
  waiting jobs for those models and their copies after one confirmation. The result toast can open the board.
- The model's page shows a **Print queue** chip for each person: who has it queued, is printing it, or printed it and
  when. It shows on everyone's copy of the model, whether they copied it from one another or imported it from the same
  page. Clicking a chip opens the board with that model's prints outlined, and **+ Queue** beside them adds it.
- The board has a column per status. Each print is its own, so the same model can be queued and printed any number of
  times, by anyone. New jobs go to the bottom of **Queued**, with the oldest at the top. Drag your own queued cards
  into the order you want, or use **Move up** and **Move down** in a card's menu. You can also drag your cards between
  columns. The menu holds status actions, a note (settings, filament, how it went), and Remove. Filter the board by person.
- **Shared with everyone** is whom your prints reach: everyone who can use tools, or only the people you pick. You
  always see everyone's who shares with you.

It keeps everything in Thingport, through `thingport.shared`: no outside service, nothing about the model's files.
Thumbnails are read as whoever looks at the board, so a model they can't open shows its initial instead.

## For tool authors

The tool is small on purpose, to show `commands`, a part of the model page (`modelPage.info`) and `thingport.shared`
working together:

- `source/queue.js`: the jobs, their statuses, the board's columns and what a model's page shows (tested in
  `source/test_queue.mjs`).
- `source/ui.js`: the board, `run()` for adding or removing jobs, and `modelInfo()`, which draws the chips into the info box.

Each job is a shared entry `job:<id>`, saved with the model it's about, so `shared.list({ model })` finds it from that
model and every copy of it. The chips are worked out from those as the page shows them: for each person, a printing
job first, then a waiting one, then the latest finished. They're drawn again when a job changes on the page.

Build after changing `source/`: `node source/build.mjs`, then `node source/test_queue.mjs`.
