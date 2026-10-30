# Build for Thingport

Thingport runs small pieces of other people's JavaScript in two places: **dashboard widgets**, panels on the
dashboard, and **tools**, apps that open in a window from the **Tools** page. Both are a short ES module with some
HTML and CSS and a little metadata, and both get the same `thingport` object to work with: the user's library, the
theme, their language, and a few libraries too big to ship in a script.

These pages are for writing them. How people install and use them is in the guides to
[custom widgets](../guides/custom-widgets.md) and [tools](../guides/tools.md).

| Page                                          | What's in it                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| [Your first widget](first-widget.md)          | A panel of the newest models in the library, from nothing to on the dashboard |
| [Your first tool](first-tool.md)              | A tray generator that saves STLs into the library, from nothing to on Tools   |
| [SDK reference](sdk-reference.md)             | Every member of `thingport`, for widgets and tools, generated from the SDK    |
| [Recipes](recipes.md)                         | Complete examples: Thingport's API, a printer on the LAN, editing, OpenSCAD   |
| [Build with an AI assistant](ai-assistant.md) | Describing a widget or a tool to Claude or another assistant, which saves it  |
| [Publishing](publishing.md)                   | Sharing one with every Thingport through the repository                       |

## Widget or tool?

|                       | Widget                                                  | Tool                                                       |
| --------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| Lives in              | A panel on the dashboard, beside the built-in ones      | A window of its own, opened from **Tools**                 |
| Good for              | Something to glance at: a count, a status, a short list | Something to work in: a generator, a planner, a calculator |
| Size                  | Grid cells, set in its metadata; the user resizes it    | Pixels, set in its metadata; the user can maximise it      |
| Options               | Settings in the panel's cog, declared in its metadata   | Its own controls, and `storage` to keep them               |
| Several at once       | Yes: each panel has its own settings                    | No: one tool window is open at a time                      |
| Keeps data            | Only its settings                                       | Up to 20 MB of JSON per user in `storage`                  |
| Asks "save where?"    | No: it saves into a collection its settings name        | Yes: `collections.pick()`                                  |
| Brings its own models | No                                                      | Only a tool in the repository                              |

If it should be on screen whenever the dashboard is, it's a widget. If someone opens it to make or change something,
it's a tool.

## How one runs

A widget or a tool has up to four parts:

1. **Metadata** (JSON or YAML): its name, icon and version, the size it starts at, the settings a widget offers, the
   shelf a tool goes on, and the `hosts` it may reach.
2. **A script**: an ES module whose `export default` function Thingport calls with `thingport`.
3. **HTML** (optional): markup and a `<style>` block, put into its element before the script runs.
4. **Labels** (optional): the words it shows, as one flat JSON file of key to sentence per language, which the
   script reads with `t("key")`.

When a panel appears or a window opens, Thingport puts the theme on the element as CSS variables (`--tp-accent`,
`--tp-paper`, `--tp-text` and the rest), puts the HTML in, and calls the default export with `thingport`. The
function may return a cleanup function, or a promise of one, which Thingport calls before the element goes away.

```js
export default function mount(thingport) {
  thingport.root.textContent = thingport.t("hello");
  const timer = setInterval(() => {}, 1000);
  return () => clearInterval(timer); // stop timers, observers and window listeners here
}
```

A widget runs again, after its cleanup, whenever its settings, the theme or the language change; a tool runs again
when the theme or the language does. So a script reads `thingport.settings`, `theme` and `language` once at the top
rather than watching them. If the default export throws, or its promise rejects, the panel or window shows the error
in place of the script.

There's no build step and nothing to install: the script is the file. It can `import()` a module from a CDN, but the
libraries Thingport carries (`thingport.library()`: Three.js, opentype.js, Manifold, fonts, OpenSCAD) are better:
your Thingport serves them, so they work without the internet, and every widget and tool shares one copy.

## What it can reach

> [!WARNING]
> A widget's or a tool's script isn't sandboxed. It runs in the Thingport page, signed in as the person using it,
> like code pasted into the browser console: it can do in Thingport whatever they can. That's why community widgets
> and repository tools are read before they're merged, and why the guides tell people to install only what they trust.

What the SDK gives it, and the rules a reviewer holds it to:

- **Its own element.** `thingport.root` is the panel or the window. A script draws only inside it and scopes its CSS
  to it (`thingport.selector`, or class names of its own), so nothing leaks into the rest of Thingport.
- **The user's library, as the user.** `models` and `collections` read and change it through Thingport's own API, as
  the app does, and `api()` reaches the rest of that API. A script changes the library only when the user asks, and
  says what it did with `ui.toast`.
- **Other hosts, through Thingport.** `thingport.fetch` asks the Thingport server to make the request, so CORS and
  the local network aren't in the way: a widget can read a printer at `http://octopi.local` that the browser couldn't.
  It reaches only the hosts the metadata's `hosts` lists (`host`, `host:port` or `*.domain`, up to 20), never a cloud
  metadata address, and gives up after 15 seconds. Installing a community widget shows those hosts, and a
  shared widget's or tool's README says why it needs each. `hosts` limits what `thingport.fetch` reaches; it isn't a sandbox.
- **Data of its own**, for a tool: `storage` keeps JSON for each user, up to 1 MB a value and 20 MB a tool.

The limits the server checks when one is saved: a script of up to 500,000 characters, HTML up to 200,000, labels up to
128 KB a language and 1 MB in all, and for a widget up to 20 settings.

## Who can make them

- **Widgets**: anyone, unless an admin has turned **Users' own widgets** off under **Administration → Dashboard**. A
  widget someone makes is theirs alone.
- **Tools**: an admin decides who sees tools under **Administration → Tools**, and making your own also needs
  **Users' own tools** switched on there, which it isn't on a new instance. A tool someone makes is theirs alone.
- **Shared ones**: community widgets and repository tools come from the Thingport repository, by pull request. See
  [Publishing](publishing.md).

## Two ways to build one

**By hand, with the SDK.** Thingport has an editor for each: **Edit → Add panel → Manage custom widgets → New widget**
on the dashboard, and **New tool** on the Tools page. Each has parts for the details, the script, the HTML and the
labels, and a preview that runs it. [Your first widget](first-widget.md) and
[your first tool](first-tool.md) walk through one each; the [SDK reference](sdk-reference.md) has the rest.

**With an AI assistant.** Connect Claude, ChatGPT or another assistant to Thingport over MCP, describe what you want,
and it reads Thingport's guide, writes the widget or tool, and saves it to your account. You then open it, try it and
read its code in the same editor. See [Build with an AI assistant](ai-assistant.md).

Either way the result is the same kind of widget or tool, edited in the same editor, so you can start one way and
finish the other.
