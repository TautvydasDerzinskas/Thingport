# Providers

One folder per provider site Thingport imports from. How a provider is built, and how to add one, is in
[docs/PROVIDER_DEVELOPMENT.md](../docs/PROVIDER_DEVELOPMENT.md).

- `<id>/manifest.ts`: what the provider is: id (stored in the database, never change it), name, hosts, logo and chip
  colours, sign-in, helpers, capabilities and how Grab reaches its site. Pure data, typed by `_lib/types.ts`.
- `_lib/`: the types and the small helpers every package shares.
- `<id>/urls.ts`: how its links are read and written, the same in all three packages.
- `<id>/urls.fixtures.json`: the URL corpus, see below.
- `<id>/docs.ts`: what the docs say of it beyond the manifest, read only by the generator.

The backend, frontend and extension build on their own, so `npm run providers:sync` (`scripts/sync-providers.mjs`)
copies this folder into each of them, beside the package's own code for each provider, as `<file>.generated.ts`:
`src/providers/<id>/manifest.generated.ts` and `urls.generated.ts`, `src/providers/_lib/*.generated.ts`, and
`src/providers/index.generated.ts`, the index listing every provider. The copies are committed; the pre-commit hook
refreshes them and CI fails when they're out of date (`npm run providers:check`). Never edit them by hand.

## URL corpus

`<id>/urls.fixtures.json` is an array of URL cases. `expect` describes the backend's current interpretation:
`provider` and `kind` (`model`, `list`, or `null`), plus `externalId`, `requestedProfileId`, and `listKind` when
relevant. `listKind` is `collection`, `likes`, or `bookmarks`.

`divergent.backend`, `divergent.frontend`, and `divergent.extension` override fields where a package reads a link
differently from `expect`; `null` means it rejects the URL. Unspecified fields inherit from `expect`. The parsers are
one set, so the only ones left are on purpose: the web app leaves a Printables likes page alone (only Grab can read
it, as its owner), and Grab opens a Snapmaker interactions page without `list` on the likes, as the site does.
