# Connect an AI assistant with MCP

Thingport speaks the [Model Context Protocol](https://modelcontextprotocol.io), so an AI assistant such as Claude Code
can search and read your library for you: "which of my models are articulated dragons?", "what's in my Printer
upgrades collection?", "what did I import from Printables this month?". If you let it, it can also import models and
file them into collections: "import this Printables link into my Benchies collection".

It's built into the backend, so there's nothing extra to install or run. The endpoint is `/api/mcp` on the same address
you open Thingport at, and the assistant signs in with your [API token](api-token.md).

## 1. Generate a token and choose its tools

1. Open the user menu (your avatar, top right) and choose **Profile**.
2. Next to **API token**, click **Generate**, and copy the token straight away: it's shown only once.
3. Click the cog next to the token to open **Token permissions**, and under **MCP** set each tool to **Allow** or
   **Deny**. Changes apply at once, to the token you already have.

A new token gets every tool that only reads. The tools that change your library are marked **Changes your library**,
stay off until you turn them on, and ask you to confirm when you do. The token still can't change anything over the
REST API, and an MCP tool is only reachable if it's allowed here. Regenerating the token sets its tools back to the ones
that only read.

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

These change your library, and are off until you turn them on:

| Tool                | What it does                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `import_model`      | Imports a model from its page on a supported site, as **+ Add > Import** does, optionally into a collection. |
| `create_collection` | Creates a new, empty collection.                                                                             |
| `add_to_collection` | Adds models from your library to one of your collections.                                                    |

None of them deletes or overwrites anything. An import runs the same checks as **+ Add > Import** (a provider an admin
turned off stays off, and a model already in your library isn't imported twice) and shows up in your notifications and
the admin logs the same way. It doesn't ask for a captcha, even when imports do in the app: like Thingport Grab, an
assistant has nowhere to show one. Most imports finish within the call; a long one carries on in the background, and the
assistant follows it with `get_import_status`.

Every tool sees only your own library, exactly as you do in Thingport. Looking a model up through MCP doesn't count as a
view, so it doesn't change your Browsing History or your most viewed models.

If your instance has a public address set under **Administration → Auth → Public URL**, models come back with a link to
their page in Thingport, so the assistant can hand you one. The setting starts out as `PUBLIC_URL`; once an admin
changes it, that change is kept.

## What an admin decides

On the admin **Auth** page, **AI assistants (MCP)** sets what every API token on the instance may do over MCP:

- **Read and change** (the default): each user picks their token's tools, including the ones that change the library.
- **Read only**: only the tools that read are offered or answered. A tool someone already allowed stays allowed, and works
  again if the admin goes back to **Read and change**.
- **Off**: `/api/mcp` turns every token away.

Since an MCP import doesn't ask for a captcha, an admin who requires one for imports may want **Read only**.

## A word on what the assistant reads

Model descriptions come from the sites they were imported from, and the assistant reads them. A description written to
look like instructions could talk it into calling another tool you gave it. The worst it can do is import models or
file them into collections, since no tool deletes anything, but keep the tools that change the library off unless you
use them.

## Turn it off

- **Deny tools** in **Token permissions** to take them away from the assistant without replacing the token.
- **Revoke** the token to cut the assistant off altogether. Anything else using the same token loses access too.
