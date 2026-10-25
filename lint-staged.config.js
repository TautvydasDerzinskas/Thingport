// Formats staged files (the fixes are committed with them), then lints the whole affected project,
// which avoids mapping staged paths into each project's cwd.
module.exports = {
  "*": "prettier --write --ignore-unknown",
  // The packages' copies of providers/ (scripts/sync-providers.mjs) are committed with it.
  "providers/**": () => [
    "npm run providers:sync",
    // Only the copies, which sit beside the packages' own provider code: added, changed or removed.
    "git add --all -- *.generated.ts",
  ],
  "bridge/**/*.go": "gofmt -w",
  "backend/prisma/schema.prisma": () =>
    "npm --prefix backend exec -- prisma format --schema backend/prisma/schema.prisma",
  "backend/**/*.{ts,tsx}": () => "npm --prefix backend run lint",
  "frontend/**/*.{ts,tsx}": () => "npm --prefix frontend run lint",
  "extension/**/*.ts": () => "npm --prefix extension run lint",
};
