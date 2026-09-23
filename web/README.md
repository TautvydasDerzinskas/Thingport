# Thingport website

The product site, docs and blog, published to GitHub Pages by
[`.github/workflows/web-pages.yml`](../.github/workflows/web-pages.yml). Built with [Astro](https://astro.build) as
plain static HTML. The only JavaScript is the theme toggle.

```bash
cd web
npm install
npm run dev      # http://localhost:4321/Thingport/
npm run build    # static output in dist/
npm run check    # type-check
```

Requires Node 22.12+ (see `.nvmrc`).

## Where the content lives

- **Docs are not copied here.** The docs pages render the repo's own Markdown (`docs/`, `extension/README.md`,
  `bridge/README.md`, `CONTRIBUTING.md`) at build time. Edit those files, not the site. The list of pages, with their
  titles, sidebar groups and SEO descriptions, is `DOCS` in [`src/lib/site.mjs`](src/lib/site.mjs). Relative links in
  those files are rewritten by [`src/lib/rehypeRepoLinks.mjs`](src/lib/rehypeRepoLinks.mjs): links to another rendered
  doc stay on the site, and everything else points to GitHub.
- **The Docker Compose install page** ([`src/pages/docs/install.astro`](src/pages/docs/install.astro)) embeds the real
  `docker-compose.deploy.yml` and `.env.example`.
- **Blog posts** are Markdown files in [`src/content/blog/`](src/content/blog/). Frontmatter: `title`, `description`,
  `pubDate`, and optionally `updatedDate`, `tags` and `draft: true`. Link to site pages root-relative
  (`/docs/install/`); the base path is added automatically.
- **Logos, fonts, favicons and screenshots** come from `frontend/`, so the site always matches the app.
- **Colours** mirror `THEME_DEFS` in `frontend/src/theme.ts`, as CSS variables in
  [`src/styles/global.css`](src/styles/global.css). The site follows the visitor's system light/dark setting, and the
  header button overrides it.

## URL and custom domain

The site is served from `https://tautvydasderzinskas.github.io/Thingport/`. In CI the URL and base path come from
GitHub Pages itself, so a custom domain set in the repo's Pages settings needs no code change. Locally, override with
`SITE_URL=https://example.com BASE_PATH=/ npm run build`.
