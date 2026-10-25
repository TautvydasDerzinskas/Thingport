# Connect an AI assistant with MCP

Thingport speaks the [Model Context Protocol](https://modelcontextprotocol.io), so an AI assistant such as Claude Code
can search and read your library for you: "which of my models are articulated dragons?", "what's in my Printer
upgrades collection?", "what did I import from Printables this month?". If you let it, it can also import, upload, edit
and delete models and file them into collections: "import this Printables link into my Benchies collection".

It's built into the backend, so there's nothing extra to install or run. The endpoint is `/api/mcp` on the same address
you open Thingport at, and the assistant signs in with your [API token](api-token.md).

## 1. Generate a token and choose its tools

1. Open the user menu (your avatar, top right) and choose **Profile**.
2. Next to **API token**, click **Generate**, and copy the token straight away: it's shown only once.
3. Click the cog next to the token to open **Token permissions**, and under **MCP permissions** set each tool to **Allow** or
   **Deny**. Changes apply at once, to the token you already have.

A new token gets every tool that only reads, plus `save_widget` and `upload_icon`, so an assistant can make you a
dashboard widget straight away. The other tools that change your library are marked **Changes your library**, stay off
until you turn them on, and ask you to confirm when you do. The token still can't change anything over the REST API,
and an MCP tool is only reachable if it's allowed here. Regenerating the token sets its tools back to these defaults.

## 2. Add Thingport to your assistant

Right after you generate the token, the profile shows the command with your address and token already filled in. For
[Claude Code](https://claude.com/claude-code) it looks like this:

```bash
claude mcp add --transport http thingport https://thingport.example.com/api/mcp \
  --header "Authorization: Bearer tp_your_token_here"
```

Any other MCP client works the same way, as long as it supports the Streamable HTTP transport and lets you set a
header: point it at `https://thingport.example.com/api/mcp` and send `Authorization: Bearer tp_...`.

The token works only in that header. Putting it in the address as `?token=...` is refused.

## The tools

These read your library, and are on for a new token:

| Tool                | What it does                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `search_models`     | Finds models by words in their title, tags, creator or description, plus matching collections and tags. |
| `list_models`       | Lists models by tag, category, collection or author, newest, most viewed or most printed first.         |
| `get_model`         | One model's description, files, tags, category, author, collections and where it was imported from.     |
| `list_collections`  | Your collections and how many models each holds, plus Favourites and Browsing History.                  |
| `get_collection`    | The models in one collection.                                                                           |
| `list_tags`         | Your tags, most used first, narrowed by a word if you like.                                             |
| `list_categories`   | Your category and folder tree.                                                                          |
| `get_author`        | A designer, where to find them, and their models in your library.                                       |
| `library_stats`     | Your totals, and your most viewed, most printed and newest models.                                      |
| `get_import_status` | How an import that `import_model` left running is getting on.                                           |
| `list_model_files`  | A model's files (plates, supporting files and sliced print), each with the id `get_model_file` takes.   |
| `get_model_file`    | One of a model's files, base64-encoded up to 10 MB, e.g. for the assistant to slice or convert it.      |
| `list_model_images` | A model's pictures, cover first, with the id `edit_model_images` takes, and the pictures if asked.      |
| `widget_guide`      | How to write a [custom dashboard widget](custom-widgets.md), read before saving one.                    |
| `list_widgets`      | Your custom dashboard widgets, optionally with their code.                                              |
| `list_icons`        | Thingport's own icons and the ones you uploaded, searched by name, e.g. for a widget's icon.            |

These change your library. `save_widget` and `upload_icon` are on for a new token; the rest are off until you turn them on:

| Tool                     | What it does                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `import_model`           | Imports a model from its page on a supported site, as **+ Add > Import** does, optionally into a collection. |
| `upload_model`           | Adds a model made from your own files, as **+ Add > Upload files** does, with pictures and a collection.     |
| `edit_model`             | Changes a model's title, description, creator, tags, category and whether it's a favourite.                  |
| `edit_model_images`      | Adds pictures to a model, removes some, or reorders them; the first is its cover.                            |
| `add_model_files`        | Adds plates, supporting files or a sliced print to one of your models.                                       |
| `remove_model_file`      | Deletes one of a model's files: a plate (not its only one), a supporting file or its sliced print.           |
| `rename_model_file`      | Renames one of a model's plates.                                                                             |
| `delete_model`           | Deletes a model with its files and pictures, as its page's **Delete** does.                                  |
| `create_category`        | Creates a category or folder, e.g. to file a model under with `edit_model`.                                  |
| `create_collection`      | Creates a new, empty collection.                                                                             |
| `add_to_collection`      | Adds models from your library to one of your collections.                                                    |
| `remove_from_collection` | Takes models out of one of your collections; they stay in your library.                                      |
| `save_widget`            | Creates one of your own [dashboard widgets](custom-widgets.md), or replaces one it or you saved earlier.     |
| `upload_icon`            | Adds an image (an SVG, or a PNG, JPEG or WebP) to your icons, as the icon browser's **Upload** does.         |

Only `import_model`, `upload_model`, `create_category`, `create_collection`, `add_to_collection` and `upload_icon` just
add. The rest change or take away what's there, so they're marked as destructive and an assistant's app may ask you
before calling them: `delete_model`, `edit_model_images` and `remove_model_file` delete models, pictures and files for
good, `add_model_files` replaces a model's sliced print, `edit_model` and `rename_model_file` overwrite what they change,
`remove_from_collection` takes models out of a collection (not your library) and `save_widget` replaces a widget with the
same name.

An import runs the same checks as **+ Add > Import** (a provider an admin turned off stays off, and a model already in
your library isn't imported twice) and shows up in your notifications and the admin logs the same way. It doesn't ask for a captcha, even when imports do in the app: like Thingport Grab, an
assistant has nowhere to show one. Most imports finish within the call; a long one carries on in the background, and the
assistant follows it with `get_import_status`.

`upload_model` takes the files and pictures as base64 in the call, up to 24 MB in all, and makes one model of them: the
3D files (STL, 3MF, STEP, OBJ) become its plates and anything else a supporting file; if none is a 3D file, every file
becomes a plate. It shows up in your notifications
and the admin logs as an upload from the app does.

`edit_model` changes only what the call gives, and checks a new title and category before changing anything. Tags are
free text, so a new tag is made just by giving it. Its changes show up in the admin logs as edits from the app do.
`add_model_files` and `edit_model_images` take base64 like `upload_model`, up to 24 MB a call. `add_model_files` sorts
files the same way, except that a file that isn't 3D becomes a supporting file, and a sliced print (G-code, a sliced 3MF)
replaces the model's own; if one file can't be stored, none of the call's files are kept (bar a sliced print already
replaced).

`get_model_file` hands a file over in the call up to 10 MB. `list_model_files` and `get_model_file` give each file an
`api_path` on Thingport's own address and, with a public address set (below), a full `download_url`; either opens with
the same token in the `Authorization: Bearer` header if the token may read **Model files** (see
[API token](api-token.md)). A bigger file comes that way. `list_model_images` gives each picture the same, which opens
if the token may read **Images**. With `include_pictures`, it also hands the assistant the first 8 pictures, scaled down
to 512 px, so it can look at them, e.g. to pick a cover.

Every tool sees only your own library, exactly as you do in Thingport. Looking a model up through MCP doesn't count as a
view, so it doesn't change your Browsing History or your most viewed models.

If your instance has a public address set under **Administration → Auth → Public URL**, models come back with a link to
their page in Thingport, so the assistant can hand you one. The setting starts out as `PUBLIC_URL`; once an admin
changes it, that change is kept.

## What an admin decides

On the admin **Auth** page, **MCP tools** sets what every API token on the instance may do over MCP:

- **Read and change** (the default): each user picks their token's tools, including the ones that change the library.
- **Read only**: only the tools that read are offered or answered. A tool someone already allowed stays allowed, and works
  again if the admin goes back to **Read and change**.
- **Off**: `/api/mcp` turns every token away.

Since an MCP import doesn't ask for a captcha, an admin who requires one for imports may want **Read only**.

## A word on what the assistant reads

Model descriptions come from the sites they were imported from, and the assistant reads them. A description written to
look like instructions could talk it into calling another tool you gave it. `delete_model`, `edit_model_images` and
`remove_model_file` delete models, pictures and files for good, and `edit_model` overwrites a model's title, description
and tags; they're off for a new token, so turn them on only while you have the assistant edit your library. `save_widget`
writes code that runs in your dashboard with your session, so a widget it saves can do in Thingport whatever you can, and
it can replace a widget of yours with the same name. It's on for a new token: deny it in **Token permissions** if you
don't have your assistant write widgets, and keep the other tools that change the library off unless you use them.

## Turn it off

- **Deny tools** in **Token permissions** to take them away from the assistant without replacing the token.
- **Revoke** the token to cut the assistant off altogether. Anything else using the same token loses access too.
