# Providers

One folder per provider site Thingport imports from. The plan is in
[docs/rfc/provider-modules.md](../docs/rfc/provider-modules.md).

- `<id>/manifest.ts`: what the provider is: id (stored in the database, never change it), name, hosts, logo and chip
  colours, sign-in, helpers, capabilities and how Grab reaches its site. Pure data, typed by `_lib/types.ts`.
- `_lib/`: the types and the small helpers every package shares.
- `<id>/urls.ts`: how its links are read and written, the same in all three packages.
- `<id>/urls.fixtures.json`: the URL corpus, see below.

The backend, frontend and extension build on their own, so `npm run providers:sync` (`scripts/sync-providers.mjs`)
copies this folder into each of them, beside the package's own code for each provider, as `<file>.generated.ts`:
`src/providers/<id>/manifest.generated.ts` and `urls.generated.ts`, `src/providers/_lib/*.generated.ts`, and
`src/providers/index.generated.ts`, the index listing every provider. The copies are committed; the pre-commit hook
refreshes them and CI fails when they're out of date (`npm run providers:check`). Never edit them by hand.

## A provider's bundle

Everything a provider does of its own lives in its folders: this one, `backend/src/providers/<id>/`,
`frontend/src/providers/<id>/` and `extension/src/providers/<id>/`. Shared code reaches it only through the tables
that wire providers in: `backend/src/providers/registry.ts` and `routes.ts`, `frontend/src/providers/collectionTiles.ts`
and `overrides.ts`, and `extension/src/providers/{content,sessions,accounts,background}.ts`. Where shared code still
has to name a provider, it says why in a comment, and `backend/src/providers/<id>/index.ts` lists every such place,
in all three packages, at its top. Keep that list current when adding or removing one.

What it stores needs no column of its own: each user's sign-in and account are a `ProviderConnection` row per auth
slot (`backend/src/providers/connections.ts`), and its ids for the starter categories are
`backend/src/providers/<id>/categories.json`, by category path. A new provider's are added to existing users' starter
categories once, at startup (`backend/src/services/categorySiteIds.ts`).

## URL corpus

`<id>/urls.fixtures.json` is an array of URL cases. `expect` describes the backend's current interpretation:
`provider` and `kind` (`model`, `list`, or `null`), plus `externalId`, `requestedProfileId`, and `listKind` when
relevant. `listKind` is `collection`, `likes`, or `bookmarks`.

`divergent.backend`, `divergent.frontend`, and `divergent.extension` override fields where a package reads a link
differently from `expect`; `null` means it rejects the URL. Unspecified fields inherit from `expect`. The parsers are
one set, so the only ones left are on purpose: the web app leaves a Printables likes page alone (only Grab can read
it, as its owner), and Grab opens a Snapmaker interactions page without `list` on the likes, as the site does.
