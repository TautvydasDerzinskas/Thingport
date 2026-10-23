# Provider URL corpus

`<id>/urls.fixtures.json` is an array of URL cases. `expect` describes the backend's current interpretation: `provider` and `kind` (`model`, `list`, or `null`), plus `externalId`, `requestedProfileId`, and `listKind` when relevant. `listKind` is `collection`, `likes`, or `bookmarks`.

`divergent.backend`, `divergent.frontend`, and `divergent.extension` override fields where an implementation differs from `expect`; `null` means it rejects the URL. Unspecified fields inherit from `expect`. These exceptions characterize current behavior; reconciling them is part of Phase 2 in [docs/rfc/provider-modules.md](../docs/rfc/provider-modules.md).
