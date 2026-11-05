# Thingport website

The product site, docs and blog, published to GitHub Pages by
[`.github/workflows/web-pages.yml`](../.github/workflows/web-pages.yml). Built with [Astro](https://astro.build) as
plain static HTML: `/docs/` is [Starlight](https://starlight.astro.build), and the home page, the feature tour and the
blog are the site's own pages. The little JavaScript there is: the theme toggle, copy buttons, the docs search and
menus, the GitHub star count, the seasonal logo, which the visitor's browser picks by date (the pages are built ahead
of time), and the comments, which a script from giscus.app draws ([below](#comments)).

```bash
cd web
npm install
npm run dev   # http://localhost:4321/
npm run build # static output in dist/
npm run check # type-check
```

Requires Node 24+ (see the root `.nvmrc`). The build fails if a page in `DOCS` (below) didn't come out, so a docs
file that moves or is renamed can't quietly drop off the site.

## Where the content lives

- **Docs are not copied here.** The docs pages render the repo's own Markdown (`docs/`, `extension/README.md`,
  `bridge/README.md`, `CONTRIBUTING.md`) at build time. Edit those files, not the site, and keep them plain GitHub
  Markdown: GitHub and the wiki show the same files. The list of pages, with their titles, sidebar groups and SEO
  descriptions, is `DOCS` in [`src/lib/site.mjs`](src/lib/site.mjs); the docs sidebar (`DOCS_SIDEBAR`) and Starlight's
  `docs` collection ([`src/lib/repoDocsLoader.ts`](src/lib/repoDocsLoader.ts)) are made from it. On the way in, each
  file loses its own `# Title` (Starlight shows it), GitHub's `> [!NOTE]` alerts become asides, and relative links are
  rewritten by [`src/lib/rehypeRepoLinks.mjs`](src/lib/rehypeRepoLinks.mjs): links to another rendered doc stay on the
  site, and everything else points to GitHub. Images (the blog's too) are the site's own copies, at `/repo/` plus
  their path in the repo ([`src/lib/repoImages.mjs`](src/lib/repoImages.mjs)): the build copies in each one a page
  shows from the checkout, scaling screenshots wider than 1600 px down to that, and fails if one is missing. The dev
  server reads them straight from the repo.
- **The docs home and the Docker Compose install page** are Astro pages in [`src/pages/docs/`](src/pages/docs/), in
  Starlight's layout. The install page embeds the real `docker-compose.deploy.yml` and `.env.example`.
- **Blog posts** are Markdown files in [`src/content/blog/`](src/content/blog/). Frontmatter: `title`, `description`,
  `pubDate`, and optionally `updatedDate`, `tags` and `draft: true`. Link to site pages root-relative
  (`/docs/install/`); the base path is added automatically.
- **Widgets & tools** (`/community/`, and a page for each under it) lists what Thingport offers to install, found as
  the app finds it: the folders `community-widgets/index.json` and `tools/index.json` list, in their order, each with
  its metadata (`.json` or `.yml`), script and `README.md`
  ([`src/lib/communityCatalog.mjs`](src/lib/communityCatalog.mjs), read into collections by
  [`src/lib/communityLoader.ts`](src/lib/communityLoader.ts)). The READMEs go through the docs' Markdown pipeline, the
  screenshots are served from `/repo/` like the docs' images, and a `builtin:` icon is the file the app's icon
  catalog draws. A widget or tool added to its `index.json` is on the site at the next deploy.
- **Logos, fonts, favicons and screenshots** come from `frontend/`, so the site always matches the app.
- **Colours** mirror `THEME_DEFS` in `frontend/src/theme.ts`, as CSS variables in
  [`src/styles/tokens.css`](src/styles/tokens.css), used by the site's pages (`global.css`) and the docs
  (`starlight.css` points Starlight's variables at them). The site follows the system's theme until the visitor picks
  light or dark with the header button, which [`src/components/ThemeScript.astro`](src/components/ThemeScript.astro)
  applies before the first paint on every page (in the docs as `starlight/ThemeProvider.astro`). Without JavaScript,
  every page is light and the button is hidden.

## The docs (Starlight)

- Starlight takes the site's look from `starlight.css` and its component overrides in
  [`src/components/starlight/`](src/components/starlight/) (`components` in `astro.config.mjs`): the site's header
  with the docs search, provider logos in the sidebar, "View this page on GitHub" linking to the page's file, and the
  site's footer.
- A provider's page has more than its Markdown: its logo, and a highlight in its brand colour, under the title
  (`starlight/PageTitle.astro`, `ProviderHighlight.astro`), then "Related" (`ProviderRelated.astro`), "Compare with
  other providers" (`ProviderComparison.astro`), "Known problems" ([below](#report-a-problem)) and "Notes from
  users" ([comments](#comments)) after it, all drawn from `src/lib/providers.generated.mjs`, which
  `npm run providers:sync` writes from `providers/`. Every other docs page but the home ends with "Feedback". The build fails if a page's own heading has the id of one of these
  sections, or if a provider's links point at a page or heading that isn't there.
- Every page's `<head>` has the same site-wide tags and JSON-LD graph, from [`src/lib/head.mjs`](src/lib/head.mjs):
  `BaseLayout.astro` writes them on the site's pages, and in the docs they're Starlight's `head` (in
  `astro.config.mjs`) and `starlight/Head.astro`, which adds the per-page ones (title, share image, JSON-LD).
- Starlight renders asides and heading links only in the folders the docs' Markdown is in (`processedDirs`, made from
  `DOCS`), not at the repo root, which would take in the blog. For `CONTRIBUTING.md`, `rehypeRepoLinks.mjs` adds the
  same heading links itself, and a GitHub alert there fails the build.
- Search is Pagefind, which Starlight runs after the build, so it works in `npm run preview` but not `npm run dev`. It
  covers the docs pages, the blog posts, the feature tour and the widgets & tools (`BaseLayout`'s `search` prop).

## Comments

Blog posts and provider pages end with comments, and the other docs pages, except the home, with a "Leave feedback"
button that brings them up. They're [giscus](https://giscus.app): each thread is a GitHub Discussion on this repo,
drawn in an iframe from giscus.app, which needs the giscus GitHub app installed on the repo. Its settings are `GISCUS`
in [`src/lib/site.mjs`](src/lib/site.mjs), with a Discussions category for each kind of page: "Blog comments",
"Provider notes" and "Docs feedback". They're in the Announcement format, so only giscus and maintainers start
threads. A category with an empty id turns that kind of thread off, and its section with it.

A page's thread is found by name, not by its URL or title: `blog/<post id>`, `providers/<slug>` or `docs/<slug>`
(giscus' `specific` mapping, in [`src/components/Comments.astro`](src/components/Comments.astro)). Renaming a post or
a docs page's slug starts it on a new, empty thread.

## Report a problem

"Report a problem" links (`ReportLink.astro`, under "Known problems" on a provider's page and beside "Leave feedback"
on the other docs pages) open the repo's bug form filled in from the link ([`src/lib/report.mjs`](src/lib/report.mjs)):
"Where?", the provider, the page's URL and, for a provider, the title's start. GitHub fills a dropdown only with one of
its options word for word, so the build fails if the form loses a field or option the links give. The form's Provider
answer becomes a `provider: <name>` label (`.github/workflows/issue-provider-label.yml`), and "Known problems"
(`KnownProblems.astro`) lists the open issues with the provider's label, fetched once per build with the star count's
token and refreshed in the visitor's browser. Without GitHub at build time, it links to them instead.

## GitHub star count

The GitHub button shows the repo's stars, fetched once per build ([`src/lib/github.mjs`](src/lib/github.mjs)) and
refreshed in the visitor's browser. CI passes `GITHUB_TOKEN` so the build isn't rate-limited. Locally it's optional
until GitHub's anonymous limit (60 requests an hour) runs out; then build with `GITHUB_TOKEN=$(gh auth token)`. If
GitHub can't be reached, the page is built without a count and the browser fills it in.

## Upgrading Starlight

The docs lean on parts of Starlight that aren't its public API. After upgrading it, build the site, look at a docs
page in both themes and with JavaScript off, search for a blog post, and check these:

- `astro.config.mjs` turns each docs page's `<html data-theme="dark">`, which Starlight renders for its theme script
  to correct, into light, so the docs are light without JavaScript. It fails the build if that markup is gone.
- The overrides in `src/components/starlight/`. `Header`, `MobileMenuFooter`, `EditLink` and `ThemeProvider` replace
  Starlight's, so its theme picker, which needs its own `ThemeProvider`, can't be used. `Head`, `MarkdownContent`,
  `PageTitle`, `Sidebar` and `Footer` wrap Starlight's. `Head` rewrites some of the tags Starlight writes (the title,
  `og:title` and `og:type`) and drops its favicon link, and `MarkdownContent`, `ProviderRelated` and
  `ProviderComparison` use its `AnchorHeading`.
- `src/styles/starlight.css` restyles Starlight's parts by their class names, and `src/content/i18n/en.json` rewords
  its interface by the strings' keys.
- `src/lib/rehypeRepoLinks.mjs` copies Starlight's heading links (the wrapper, icon and "Section titled" label) for
  `CONTRIBUTING.md`, and `src/lib/remarkGithubAlerts.mjs` hands Starlight's asides plugin the directive a `:::note`
  block parses to.
- Two things Starlight does for the whole site, not just the docs: its Pagefind run indexes every page with
  `data-pagefind-body`, and its Expressive Code draws the code blocks in all Markdown, the blog's included
  (`ec.config.mjs`).

## URL and custom domain

The site is served from `https://thingport.net/` (a custom domain set in the repo's Pages settings). In CI the URL
and base path come from GitHub Pages itself; local and PR builds default to that domain with base `/`. Override with
`SITE_URL=https://example.com BASE_PATH=/sub-path npm run build`.
