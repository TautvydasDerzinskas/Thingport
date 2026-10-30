# Build with an AI assistant

Instead of writing a widget or a tool yourself, you can describe it to an AI assistant connected to Thingport, such as
Claude, ChatGPT, Codex or Cursor. It reads Thingport's guide to the format and the SDK, writes the metadata, the
script, the HTML and the labels, and saves the result to your account. You then try it, read it and change it in the
same editor as one you wrote by hand.

It works over the [Model Context Protocol](https://modelcontextprotocol.io) (MCP): Thingport offers the assistant a
set of tools, and the assistant calls them as it works.

## Connect your assistant

[Connect an AI assistant with MCP](../guides/mcp.md) covers it: generate an API token on your profile, then add
Thingport to your assistant with the command or settings **How to connect** shows, which have your address and token
filled in. The editors have a shortcut to the same place: **Build & share → Connect an AI** in the custom widgets
dialog, and **Use AI → Connect an AI** in the tool editor.

## What it needs to be allowed

The token's **MCP permissions** (the cog beside it on your profile) decide what the assistant may call. A new token
already allows everything below, so normally there's nothing to change:

| To                     | It calls                     | Permission it needs                             |
| ---------------------- | ---------------------------- | ----------------------------------------------- |
| Learn the format       | `widget_guide`, `tool_guide` | Reads only: on for a new token                  |
| Read back what's there | `list_widgets`, `list_tools` | Reads only: on for a new token                  |
| Find an icon           | `list_icons`                 | Reads only: on for a new token                  |
| Save a widget          | `save_widget`                | **Save a dashboard widget**: on for a new token |
| Save a tool            | `save_tool`                  | **Save a tool**: on for a new token             |
| Add an icon of its own | `upload_icon`                | **Upload an icon**: on for a new token          |

Saving also depends on what an admin allows:

- **MCP tools**, under **Administration → Auth**, must be **Read and change**. On **Read only**, the assistant can read
  the guides but not save.
- A widget needs **Users' own widgets** on, under **Administration → Dashboard**. It's on unless an admin turned it
  off.
- A tool needs tools turned on for you and **Users' own tools** switched on, under **Administration → Tools**. A new
  instance leaves **Users' own tools** off; `list_tools` tells the assistant so, and it can tell you what to ask for.

`save_widget` and `save_tool` write code that runs in your browser with your access, and replace a widget or a tool
with the same folder name. If you don't have your assistant write them, deny both in **Token permissions**.

## How it works

1. **It reads the guide.** `widget_guide` and `tool_guide` hand the assistant the format: the metadata and its
   limits, the script's lifecycle, the labels, the rules a reviewer holds a script to, and the whole SDK. The SDK part
   is generated from the same source as this site's [SDK reference](sdk-reference.md), so the assistant and you read
   the same thing.
2. **It finds an icon.** `list_icons` searches Thingport's own icons and the ones you uploaded. When nothing fits, it
   can draw an SVG and keep it with `upload_icon`.
3. **It saves.** `save_widget` or `save_tool` takes a slug (the folder name), the metadata as an object or as JSON or
   YAML, the script, the HTML and the labels by language. Thingport checks them as the editor does, so a mistake in
   the metadata comes back as an error the assistant can fix and save again. What's saved is one of your own: only
   you see it.
4. **It tells you where it is.** The answer says where to find it: **Add panel** for a widget, the Tools page for a
   tool.

To change one, the assistant calls `list_widgets` or `list_tools` with `include_code`, which gives back the script, the
HTML and the labels as they are now, edits them and saves under the same slug.

## Asking for one

Say what it's for, what it should show or make, and anything it has to reach. The more specific the request, the less
it guesses:

- _"Make me a Thingport widget showing my OctoPrint printer's progress. It's at http://octopi.local and the API key
  is a setting."_
- _"Make a dashboard widget listing my five most recent models tagged 'to-print', each opening its page when
  clicked."_
- _"Make me a Thingport tool that makes a hook for a pegboard, with the hook's length and the board's hole spacing as
  settings, and saves it to a collection I pick."_
- _"Make a tool that lists my models with no tags and lets me tag several at once."_
- _"Add a Lithuanian translation to my Newest models widget."_

Ask for the languages you want: the labels are part of what it saves. The guide tells it to write them in the
language you ask in, or to ask you when it can't tell.

## Check what it made

The assistant can't see your dashboard or run the code, so trying it is your part:

1. **Open it.** For a widget, add it from **Add panel** while editing the dashboard; for a tool, double-click it on
   the Tools page.
2. **Read it.** Open it in the editor (**Edit** in its menu under **Mine**, or in the tool's right-click menu): the
   **Script** shows what it does, and the details list the hosts it may reach. Check that it reaches only what you
   expected and changes your library only where you asked.
3. **Try it.** The editor's preview runs it beside the code. If the script fails as it starts, the panel or window
   shows the error, which you can paste back to the assistant. An error later on, in a click handler for instance, is
   in the browser's developer console.

## Change it

Ask again, in the same conversation or a new one: _"The Newest models widget should show the model's name under its
picture"_. It reads back what's there and saves over it. You can also change it yourself in the editor and ask the
assistant to carry on from there; ask it to read the widget again first, because saving replaces the whole widget
with what it has.

## What it can't do

- **See it working.** It writes from the guide and what you tell it. Describe what you see, or paste an error.
- **Reach your network.** It doesn't call your printer or your other services while it writes; `thingport.fetch` does,
  later, from your Thingport server, to the hosts the metadata lists.
- **Share it.** What it saves is yours alone. Screenshots belong to a widget or a tool shared through the repository,
  so it leaves them out, and a tool it saves can't bring models of its own. [Publishing](publishing.md) is a pull
  request you open.
- **Vouch for it.** Its code runs with your access to Thingport. Read what it wrote, and keep the tools that delete or
  overwrite models switched off unless you're using them: [what the assistant reads](../guides/mcp.md#a-word-on-what-the-assistant-reads)
  explains why.
