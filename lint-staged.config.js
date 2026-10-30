// Formats staged files (the fixes are committed with them), then lints the whole affected project,
// which avoids mapping staged paths into each project's cwd.
module.exports = {
  "*": "prettier --write --ignore-unknown",
  // The packages' copies of providers/ and the docs written from it (scripts/sync-providers.mjs) are committed with it.
  "{providers/**,scripts/sync-providers.mjs}": () => [
    "npm run providers:sync",
    // Only what it writes: the copies beside the packages' own provider code (added, changed or removed), the docs
    // logos, the providers page and the website's provider pages.
    "git add --all -- *.generated.ts docs/assets/providers docs/PROVIDER_SETUP.md web/src/lib/providers.generated.mjs",
  ],
  // The SDK reference, the AI guides' copy of it and the examples' code in the docs, written from the SDK's types and
  // docs/developers/examples (scripts/sync-sdk-docs.mjs), are committed with them.
  "{frontend/src/sdk/types.ts,frontend/src/sdk/theme.ts,docs/developers/**,scripts/sync-sdk-docs.mjs}": () => [
    "npm run sdk:sync",
    "git add -- docs/developers/*.md docs/developers/examples/thingport.d.ts backend/src/services/sdkReference.generated.ts",
  ],
  "bridge/**/*.go": "gofmt -w",
  "backend/prisma/schema.prisma": () =>
    "npm --prefix backend exec -- prisma format --schema backend/prisma/schema.prisma",
  "backend/**/*.{ts,tsx}": () => "npm --prefix backend run lint",
  "frontend/**/*.{ts,tsx}": () => "npm --prefix frontend run lint",
  "extension/**/*.ts": () => "npm --prefix extension run lint",
};
