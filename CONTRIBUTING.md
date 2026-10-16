# Contributing to Thingport

Thanks for taking the time. Bug reports, fixes and features are all welcome.

## Before you start

- **Small fix?** Just open a pull request.
- **Something bigger** -- a new provider, a schema change, a new page -- please open an issue
  first so we can agree on the shape before you write it. It's no fun to have a large PR turned
  down over a design decision that could have been a two-message conversation.

Getting the project running locally is covered in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Workflow

1. **Fork** the repository and clone your fork.
2. **Branch** from `develop`. Name it after what it does: `fix/firefox-background-importscripts`,
   `feat/printables-collections`.
3. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/) -- this repo's
   history uses `feat:`, `fix:`, `docs:`, `refactor:` and `ci:`, with an optional scope:

   ```
   fix(extension): load common.js on Firefox, where importScripts is undefined
   feat: show model usage in memory size
   ```

   The type also decides the next version of what you touched (`feat:` minor, `fix:` and `perf:` patch, `!`
   major; anything else none). The backend, the frontend and the browser extension are each versioned on their
   own, from the commits under their folder: the backend and frontend when a release is merged into `main`, the
   extension weekly -- see [extension/CONTRIBUTING.md](extension/CONTRIBUTING.md#versioning-how-the-next-version-is-picked).
   Each gets a `CHANGELOG.md` and a GitHub release.

4. **Push** to your fork and open a pull request against `develop`.

`develop` is where work comes together; `main` is what's released. Neither takes direct pushes: changes reach
`develop` by pull request, and a release is a pull request from `develop` into `main`.

A husky pre-commit hook formats your staged files and runs oxlint over whichever project you touched.
If it blocks your commit, fix the lint error rather than passing `--no-verify`.

## Before you push

Run whatever covers the area you changed:

```bash
npm --prefix frontend run verify # typecheck + lint + tests + build
npm --prefix backend run lint
```

Backend tests need their own throwaway database -- see the warning in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#running-the-tests) before running them, because the
default configuration points at your development database.

## What CI checks

Formatting is checked on every pull request (`npm run format:check`). The other workflows are
path-filtered, so only the parts you touched run:

| You changed    | CI runs                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `backend/**`   | oxlint, then a multi-arch Docker image build (which runs `tsc`)                                 |
| `frontend/**`  | oxlint, `tsc --noEmit`, then a Docker image build                                               |
| `extension/**` | oxlint, `tsc --noEmit`, the Chrome/Edge/Firefox builds, and `web-ext lint` on the Firefox build |
| `bridge/**`    | `go test ./...` and a build for Windows, Linux and macOS                                        |

The [regression pack](docs/DEVELOPMENT.md#regression-pack), which runs end-to-end browser scenarios
against the full stack, isn't run on pull requests. It runs weekly on `main`.

Nothing is published from a pull request or from `develop` -- images are built to prove they build, but
only a release, merged into `main`, publishes anything.

If you're a brand-new GitHub account, your first PR's workflows wait for a maintainer to approve
them before running. That's a GitHub setting, not something wrong with your PR.

## Writing the pull request

Explain the problem, not just the patch. A description that covers **symptom, cause, fix and how
you verified it** is much faster to review than a diff alone -- especially for a bug fix, where the
reviewer otherwise has to reconstruct your reasoning from scratch.

If you couldn't verify something end to end, say so. That's useful information, not a weakness.

## Code style

- **Match the surrounding code.** This codebase uses long explanatory comments that say _why_
  something is the way it is -- particularly where behaviour is non-obvious or a workaround exists.
  Follow that where it helps; don't narrate what the code already says.
- Prettier formats everything it can (config in `.prettierrc.json`), `gofmt` the bridge and
  `prisma format` the schema. Run `npm run format` at the repo root; the pre-commit hook does it for
  staged files.
- oxlint is the linter for every TypeScript project (backend, frontend, extension).
- The extension is TypeScript + SCSS built with esbuild, and its background has to run as a Chrome
  service worker _and_ a Firefox event page. See
  [extension/CONTRIBUTING.md](extension/CONTRIBUTING.md) before changing it.
- Frontend is TypeScript with `strict: true`. Don't reach for `any` to get past a type error.

## Don't commit

- `.env` files -- `backend/.env` and root `.env` are gitignored and hold real credentials.
- `data/`, `backend/storage/`, `dist/`, `node_modules/` -- all runtime or build output.

## Licence

Thingport is copyright (C) 2026 Tautvydas Deržinskas and licensed under the GNU Affero General Public
License v3.0 (AGPL-3.0-only). By contributing, you agree that your contributions are licensed under
the same terms.
