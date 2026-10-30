# Tools

Tools an admin can install from **Administration → Tools** in Thingport. Each folder here is one tool; [`index.json`](index.json)
lists the ones Thingport offers. An installed tool opens from the **Tools** page, for the users the admin allows.

To write one, see [tool development](../docs/TOOL_DEVELOPMENT.md) for the format and the steps, and the
[SDK reference](../docs/developers/sdk-reference.md) for what a tool's script gets.

## A tool's folder

- `tool.json` or `tool.yml`: its metadata (name, icon, version, author, window size, hosts, and the models it brings)
- `tool.js`: its script, an ES module whose default export Thingport calls with `thingport`
- `tool.html`: optional markup and styles
- `README.md`: what it does, what it reaches, and where its models come from
- `screenshots/`: optional pictures of it at work, listed under `screenshots` in its metadata, which admins look
  through before installing it

A tool may bring models it needs, kept in a collection, **Tool: &lt;name&gt;**, in every library that can use tools: they
can be opened, searched and printed but not changed, and go when the tool is uninstalled. A model is either files in the
tool's folder (`files`), for designs whose licence lets this repository carry them, or a model page Thingport imports
from (`source`), fetched when an admin installs the tool, for designs that may be downloaded but not passed on.

## What reviewers look for

A tool's script runs in its users' pages with their access to Thingport, so it's read before it's merged:

- It draws only inside `thingport.root`, scopes its styles to its own class, and cleans up its timers and listeners.
- It reaches outside services only through `thingport.fetch`, to the `hosts` its metadata lists, and its README says why.
- It changes the user's library only when they ask it to, and says what it did.
- No minified or obfuscated code, and nothing loaded at run time that the review can't see. A built `tool.js` comes with
  the source it's built from.
- The models it brings are ones it may: their licence allows what `files` or `source` does with them.

A change to a merged tool should raise its `version`, so admins are offered the update. A change to its models replaces
everyone's copies, so give a changed file a new name or key rather than changing it in place.
