# Providers

One folder per provider site Thingport imports from. The plan is in
[docs/rfc/provider-modules.md](../docs/rfc/provider-modules.md).

- `<id>/manifest.ts`: what the provider is: id (stored in the database, never change it), name, hosts, logo and chip
  colours, sign-in, helpers, capabilities and how Grab reaches its site. Pure data, typed by `_lib/types.ts`.
- `_lib/`: the types and the small helpers every package shares.
- `<id>/urls.fixtures.json`: the URL corpus, see below.

The backend, frontend and extension build on their own, so `npm run providers:sync` (`scripts/sync-providers.mjs`)
copies this folder into each of them, under `providers/_generated/` (`src/shared/providers/_generated/` in the
extension), with an index listing every provider. The copies are committed; the pre-commit hook refreshes them and CI
fails when they're out of date (`npm run providers:check`). Never edit them by hand.

## URL corpus

`<id>/urls.fixtures.json` is an array of URL cases. `expect` describes the backend's current interpretation:
`provider` and `kind` (`model`, `list`, or `null`), plus `externalId`, `requestedProfileId`, and `listKind` when
relevant. `listKind` is `collection`, `likes`, or `bookmarks`.

`divergent.backend`, `divergent.frontend`, and `divergent.extension` override fields where an implementation differs
from `expect`; `null` means it rejects the URL. Unspecified fields inherit from `expect`. These exceptions characterize
current behavior; reconciling them is part of Phase 2.
