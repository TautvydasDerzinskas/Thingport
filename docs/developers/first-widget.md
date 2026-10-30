# Your first widget

A dashboard panel showing the models added to the library most recently, with their pictures, opening a model's page
when one is clicked. It reads the library, has two settings, follows the theme and keeps its words in a labels file:
most of what a widget does, in sixty lines. It takes about ten minutes.

You need a Thingport account, and **Users' own widgets** left on by your admin (it's on unless they turned it off).
What a widget is and how it runs is in the [overview](overview.md).

## 1. Open the editor

On the dashboard, choose **Edit**, then **Add panel → Manage custom widgets…**, and under **Mine** choose **New
widget**. The editor opens on a working example, which you'll replace. Its parts are along the top: **Details**,
**Settings**, **Script**, **HTML** and **Labels**, with the **Preview** beside them.

## 2. Fill in the details

Under **Details**:

- **Name**: `Newest models`. **Slug**: `newest-models`, the folder name it's saved as.
- **Icon**: pick Thingport's own logo, or anything else in the icon browser.
- **Size**: 4 wide and 4 high, at least 3 by 3. A cell is a twelfth of the dashboard's width, and a row is 64 px.
- **Hosts it may reach**: leave it empty. This widget only reads Thingport.

## 3. Add its settings

Under **Settings**, choose **Add setting** twice:

1. A **Choice** with the key `count`, the label `settings.count`, the options `3`, `6` and `12` (each with the same
   label and value), and `6` as its default.
2. A **Text** with the key `tag`, the label `settings.tag` and the placeholder `settings.tagHint`.

The labels are keys into the widget's own words, which you add in step 6, so the panel's cog shows them in the user's
language. A label written as a plain sentence is shown as it is.

## 4. The HTML

Replace the **HTML** with this. It's the panel's markup and its stylesheet, which takes every colour from the theme's
CSS variables, so the panel looks right in both themes without the script doing anything. The `data-t` attributes are
filled in from the labels; the English left in them is what shows if the labels never arrive.

<!-- sdk:example first-widget/widget.html -->

[`first-widget/widget.html`](examples/first-widget/widget.html)

```html
<style>
  .newest {
    display: grid;
    gap: 8px;
    padding: 12px;
    font-family: var(--tp-font);
    color: var(--tp-text);
  }
  .newest h3 {
    margin: 0;
    font-size: 14px;
  }
  .newest .status {
    margin: 0;
    font-size: 12px;
    color: var(--tp-text-muted);
  }
  .newest ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .newest button {
    width: 100%;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--tp-divider);
    border-radius: 8px;
    background: var(--tp-paper);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 150ms;
  }
  .newest button:hover,
  .newest button:focus-visible {
    border-color: var(--tp-accent);
  }
  .newest img {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    background: var(--tp-background);
  }
  .newest span {
    display: block;
    padding: 4px 6px;
    overflow: hidden;
    font-size: 12px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  @media (prefers-reduced-motion: reduce) {
    .newest button {
      transition: none;
    }
  }
</style>
<div class="newest">
  <h3 data-t="title">Newest models</h3>
  <p class="status" data-t="loading">Loading…</p>
  <ul></ul>
</div>
```

<!-- /sdk:example -->

## 5. The script

Replace the **Script** with this:

<!-- sdk:example first-widget/widget.js -->

[`first-widget/widget.js`](examples/first-widget/widget.js)

```js
// @ts-check

/** @param {import("../thingport").WidgetSdk} thingport */
export default function mount(thingport) {
  const { root, settings, models, ui, t, labels } = thingport;
  labels(); // every data-t in widget.html, in the user's language

  const status = root.querySelector(".status");
  const list = root.querySelector("ul");
  // The panel can be redrawn before the list arrives (a setting changed, the theme switched): then it's not ours.
  let stopped = false;

  /** @param {import("../thingport").SdkModel} model */
  function card(model) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = model.name;
    button.addEventListener("click", () => ui.openModel(model.id));
    if (model.thumbnail) {
      const picture = document.createElement("img");
      picture.src = model.thumbnail;
      picture.alt = "";
      button.append(picture);
    }
    const name = document.createElement("span");
    name.textContent = model.name;
    button.append(name);
    const item = document.createElement("li");
    item.append(button);
    return item;
  }

  async function show() {
    try {
      const page = await models.list({
        tags: settings.tag ? [settings.tag] : undefined,
        limit: Number(settings.count),
      });
      if (stopped) return;
      status.textContent = page.models.length ? "" : t("empty");
      list.replaceChildren(...page.models.map(card));
    } catch (error) {
      if (!stopped) status.textContent = t("failed", { reason: error.message });
    }
  }

  show();
  return () => {
    stopped = true;
  };
}
```

<!-- /sdk:example -->

What it does:

- `labels()` fills every `data-t` in the HTML with the words in the user's language, and `t("key")` gives one of them
  to the script. `{reason}` in a sentence is filled in from what `t` is given.
- `models.list()` reads a page of the library, newest first, narrowed to a tag when the setting has one. Settings
  arrive as strings, so `count` goes through `Number()`.
- `ui.openModel(id)` leaves the dashboard for the model's page.
- The function it returns is the cleanup. The panel is drawn again when a setting, the theme or the language changes,
  and `stopped` keeps a list that arrives after that from being written into a panel that's gone.

The first two lines are for an editor of your own, and Thingport ignores them. Put
[`thingport.d.ts`](examples/thingport.d.ts) beside the script, point the `import()` at it, and VS Code and other
editors complete `thingport.` and flag a misspelt member or a wrong argument.

## 6. The labels

Under **Labels**, choose **Start with English** and replace the file with this:

<!-- sdk:example first-widget/locales/en.json -->

[`first-widget/locales/en.json`](examples/first-widget/locales/en.json)

```json
{
  "title": "Newest models",
  "loading": "Loading…",
  "empty": "Nothing here yet. Import or upload a model and it shows up here.",
  "failed": "Couldn't load the models: {reason}",
  "settings.count": "Models shown",
  "settings.tag": "Only with the tag",
  "settings.tagHint": "e.g. gridfinity"
}
```

<!-- /sdk:example -->

English is the fallback, key by key: to add a language, add its file from the same tab and translate what you like,
and anything left out shows in English.

## 7. Try it and save it

The **Preview** runs the script as you type, with each setting at its default, at the widget's minimum size or the
size it's added at. When it shows your newest models, choose **Save**.

## 8. Put it on the dashboard

Under **Mine**, choose the **Add to dashboard** button beside it, or, while editing the dashboard, find it under **Add panel**.
Move and resize it like any other panel, and set **Models shown** and **Only with the tag** from its cog. Add it twice
for two tags: each panel has its own settings.

## What you made

The editor keeps the parts as one widget. **Download for publishing**, in the widget's ⋮ menu under **Mine**, gives
them back as the files a widget is shared as, and this is its metadata:

<!-- sdk:example first-widget/widget.json -->

[`first-widget/widget.json`](examples/first-widget/widget.json)

```json
{
  "name": "Newest models",
  "description": "The models added to your library most recently, with their pictures.",
  "iconUrl": "builtin:thingport/icon",
  "version": "1.0.0",
  "size": { "w": 4, "h": 4, "minW": 3, "minH": 3 },
  "settings": [
    {
      "key": "count",
      "type": "choice",
      "label": "settings.count",
      "default": "6",
      "options": [
        { "value": "3", "label": "3" },
        { "value": "6", "label": "6" },
        { "value": "12", "label": "12" }
      ]
    },
    { "key": "tag", "type": "text", "label": "settings.tag", "placeholder": "settings.tagHint" }
  ],
  "hosts": [],
  "locales": ["en"]
}
```

<!-- /sdk:example -->

`save_widget`, the MCP tool an AI assistant saves a widget with, takes the same metadata, script, HTML and labels.

## Next

- The [SDK reference](sdk-reference.md): everything `thingport` has, such as `fetch` for a service on your network and
  `onResize` for a panel that changes shape.
- [Recipes](recipes.md): a panel of the library's totals, and one following an OctoPrint printer.
- [Your first tool](first-tool.md), for something that opens in its own window.
- [Publishing](publishing.md), to offer it to every Thingport.
