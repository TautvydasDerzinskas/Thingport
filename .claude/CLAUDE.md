# Instructions for Claude

Read [CONTRIBUTING.md](../CONTRIBUTING.md) for the workflow, commit style and code conventions -- they apply to you too.

## Git

- **No AI attribution.** Never add a `Co-Authored-By: Claude ...` trailer (or any other AI co-author line) to a
  commit, and never add a "Generated with Claude Code" line, or similar, to a pull request description. The
  `commit-msg` hook rejects commits that carry one.
- **Never push without being asked.** Commit locally, then stop and say what is ready. Only `git push`, open a
  pull request or update one when the user explicitly asks for that, each time -- approval for one push isn't
  approval for the next.

## Providers

Before adding or changing a provider (a model site Thingport imports from), read
[docs/PROVIDER_DEVELOPMENT.md](../docs/PROVIDER_DEVELOPMENT.md) and follow its checklist.

## API token permissions

Third-party apps (dashboards, launchers such as Homarr and holm) read the REST API with a user's API token, and the
user picks what it may read by scope in `backend/src/services/apiTokenScopes.ts`. A GET path no scope lists falls
under "Everything else", so when you add or rename a GET endpoint that such an app would plausibly read (models,
collections, search, dashboard data, images, files), add its path to the fitting scope, or add a scope for it with
its translations under `profile.apiToken.rest.scopes` in every locale, a picture in `PermissionTile` (reuse the MCP
tool's when one reads the same thing), and a row in the table in `docs/guides/api-token.md`. Scope ids are stored per
user: never rename one, and when a new scope takes paths from an existing one, add a migration granting it to tokens
that hold that one, so apps using them don't lose access. A new MCP tool that reads the same data should match its scope.

## UI

The UI is what Thingport is judged on, so treat it as a first-class part of every frontend change, not a
finish at the end. The frontend is React + MUI 6 (Emotion `sx`), themed in `frontend/src/theme.ts`. Reuse the
components below before building new ones, and if a new pattern is genuinely needed, make it a shared
component in `frontend/src/components/` rather than a one-off inside a page.

- **Compact by default.** Dense, scannable layouts: short labels, tight spacing, no explanatory paragraphs in
  the page. Put the explanation behind a `?` with `HelpTip` (`components/HelpTip.tsx`) next to the label it
  explains -- it's focusable and screen-reader friendly, so nothing is lost by hiding the text.
- **Modals for focused tasks.** Settings, editors, imports and anything with several steps or sections open in a
  dialog rather than a new page. Multi-section dialogs use `SectionedDialog` (the Configuration dialog in
  `components/Layout/ConfigurationDialog/` is the reference). Confirmations go through `useConfirm()` from
  `ConfirmProvider`, never `window.confirm`; feedback goes through `useToast()`, never `alert`.
- **Actions live in menus.** Secondary actions on an item go in an MUI `Menu` behind an icon button (a `⋮`
  "more" button, as in `ModelActionsMenu`, `AddMenu` and `UserMenu`), with an icon and label per item, a
  `Divider` before destructive ones, and right-click (`onContextMenu`) opening the same menu where items are
  in a list or grid. Keep the toolbar itself to a few primary icon buttons, each with a `Tooltip`.
- **Modern toggles, not radios or dropdowns.** A choice between a few options uses `Segmented`
  (`components/controls/Segmented.tsx`) -- the theme toggle in the Appearance panel is the model. On/off uses
  an MUI `Switch`, a favourite-style flag uses `StarToggle`. Reach for a `Select` only when the list is long or
  open-ended.
- **Animate where it explains something.** Use CSS transitions and `@keyframes` for state changes -- dialogs and
  menus opening, items appearing, moving or being removed, progress, success -- and keep them short (roughly
  150--300 ms, longer only for a deliberate illustration like the ones in `*Animations/`). Animate `transform` and
  `opacity`, not layout properties. Always honour `prefers-reduced-motion` (see `FileMoveAnimation.tsx`).
- **Loading and empty states are designed too.** Use `ListSkeleton` or a matching skeleton instead of a bare
  spinner for content, and give empty lists a short message and the action that fills them.
- **Both themes, all languages.** Take colours from the theme (`theme.palette`, `theme.thingport`), never hard-
  coded hex, and check the change in light and dark. Every user-facing string goes through `t()` with a key in
  all `frontend/src/i18n/locales/en.json` and `lt.json` and other language files.
- **Accessible.** Icon-only buttons get an `aria-label` (and a `Tooltip`), everything works by keyboard, and focus
  is visible.
