// Shared by astro.config.mjs (plain Node, hence .mjs) and the pages.

export const REPO = "TautvydasDerzinskas/Thingport";
export const REPO_URL = `https://github.com/${REPO}`;
export const BRANCH = "main";

export const SITE_NAME = "Thingport";
export const TAGLINE = "Your personal 3D model library";
export const SITE_DESCRIPTION =
  "Thingport is a free, open-source, self-hosted library for your 3D printing models. Import from MakerWorld, Printables and Thingiverse, preview STL, 3MF, STEP and OBJ files in your browser, and keep everything organized in one place.";

export const LINKS = {
  github: REPO_URL,
  releases: `${REPO_URL}/releases`,
  issues: `${REPO_URL}/issues`,
  license: `${REPO_URL}/blob/${BRANCH}/LICENSE`,
  sponsors: "https://github.com/sponsors/TautvydasDerzinskas",
  coffee: "https://buymeacoffee.com/TautvydasDerzinskas",
};

/**
 * Pages with a `source` render straight from that repo Markdown file; the rest are Astro pages
 * under src/pages/docs/. `unlisted` pages are built but left out of all navigation.
 */
export const DOCS = [
  {
    slug: "install",
    group: "Getting started",
    title: "Install with Docker Compose",
    nav: "Docker Compose",
    description: "Run Thingport on any Docker host from the pre-built images, with no build step.",
  },
  {
    slug: "providers",
    source: "docs/PROVIDER_SETUP.md",
    group: "Getting started",
    title: "Provider setup",
    nav: "Provider setup",
    description: "Connect MakerWorld and Thingiverse so Thingport can import from them. Printables needs no setup.",
  },
  {
    slug: "guides/existing-library",
    source: "docs/guides/existing-library.md",
    group: "Add your library",
    title: "Bring your existing model library",
    nav: "Bring your library",
    description:
      "Already have folders of STLs, 3MFs and ZIPs? Choose between uploading files, uploading folders and the consume folder.",
  },
  {
    slug: "guides/upload-files",
    source: "docs/guides/upload-files.md",
    group: "Add your library",
    title: "Upload files and ZIPs",
    nav: "Upload files and ZIPs",
    description: "Add models from your computer one by one or many at once, and unpack ZIPs into models and folders.",
  },
  {
    slug: "guides/upload-folders",
    source: "docs/guides/upload-folders.md",
    group: "Add your library",
    title: "Upload a folder",
    nav: "Upload a folder",
    description:
      "Upload a whole folder tree from the browser, with each file or each folder becoming a model and the tree kept.",
  },
  {
    slug: "guides/consume-folder",
    source: "docs/guides/consume-folder.md",
    group: "Add your library",
    title: "Import a library with the consume folder",
    nav: "Consume folder",
    description:
      "Mount a folder on your server and copy your library into it. Thingport imports everything and empties it.",
  },
  {
    slug: "guides/synced-collections",
    source: "docs/guides/synced-collections.md",
    group: "Add your library",
    title: "Synced collections",
    nav: "Synced collections",
    description:
      "Link a MakerWorld, Printables or Thingiverse collection to Thingport, and models added to it later are imported on their own.",
  },
  {
    slug: "features/importing",
    source: "docs/features/importing.md",
    group: "Features",
    title: "Import from MakerWorld, Printables and Thingiverse",
    nav: "Importing",
    description:
      "Import models, collections and likes with their files, photos, description, tags and author, by link or with Thingport Grab.",
  },
  {
    slug: "features/3d-previews",
    source: "docs/features/3d-previews.md",
    group: "Features",
    title: "3D previews",
    nav: "3D previews",
    description:
      "Preview STL, 3MF, OBJ and STEP files in the browser, with plate thumbnails and simplified previews of very detailed models.",
  },
  {
    slug: "features/organize-and-search",
    source: "docs/features/organize-and-search.md",
    group: "Features",
    title: "Organize and search",
    nav: "Organize and search",
    description:
      "Categories, folders, collections, tags, favourites and bookmarks, plus search across your whole library.",
  },
  {
    slug: "features/dashboard",
    source: "docs/features/dashboard.md",
    group: "Features",
    title: "Dashboard",
    nav: "Dashboard",
    description:
      "Library stats, recent and most used models, top authors, a daily featured model, and a layout you can customize.",
  },
  {
    slug: "features/profile-and-activity",
    source: "docs/features/profile-and-activity.md",
    group: "Features",
    title: "Profile and activity",
    nav: "Profile and activity",
    description: "A year-long activity heatmap and timeline of everything you've done with your library.",
  },
  {
    slug: "features/authors",
    source: "docs/features/authors.md",
    group: "Features",
    title: "Author pages",
    nav: "Author pages",
    description: "A page for every author whose models you've saved, and your own designs under My models.",
  },
  {
    slug: "features/slicers",
    source: "docs/features/slicers.md",
    group: "Features",
    title: "Open in your slicer",
    nav: "Open in your slicer",
    description: "Open files straight in Bambu Studio, OrcaSlicer, PrusaSlicer, Cura and other slicers.",
  },
  {
    slug: "features/normalized-3mf",
    source: "docs/features/normalized-3mf.md",
    group: "Features",
    title: "Normalized MakerWorld 3MFs",
    nav: "Normalized 3MFs",
    description:
      "Open MakerWorld's Bambu Studio projects in other slicers with their colours, plates and print settings.",
  },
  {
    slug: "features/supporting-files",
    source: "docs/features/supporting-files.md",
    group: "Features",
    title: "Everything to print it",
    nav: "Supporting files",
    description: "Keep instructions, notes and a ready-to-print sliced file next to each model.",
  },
  {
    slug: "features/downloads",
    source: "docs/features/downloads.md",
    group: "Features",
    title: "Download as ZIP",
    nav: "Download as ZIP",
    description: "Download a model, or a whole category, tag or collection, as one archive.",
  },
  {
    slug: "features/storage",
    source: "docs/features/storage.md",
    group: "Features",
    title: "Plain files on your disk",
    nav: "Storage",
    description: "Models stored as ordinary files, in a folder layout you choose and can change later.",
  },
  {
    slug: "features/multi-user",
    source: "docs/features/multi-user.md",
    group: "Features",
    title: "Multi-user",
    nav: "Multi-user",
    description:
      "Separate libraries for everyone, with open or invite-only registration, email verification, captcha and single sign-on.",
  },
  {
    slug: "features/administration",
    source: "docs/features/administration.md",
    group: "Features",
    title: "Administration",
    nav: "Administration",
    description: "Every instance-wide setting, a page per area, all in the browser.",
  },
  {
    slug: "features/appearance",
    source: "docs/features/appearance.md",
    group: "Features",
    title: "Themes and languages",
    nav: "Themes and languages",
    description: "Light, dark or system theme, in English or Lithuanian.",
  },
  {
    slug: "guides/system-health",
    source: "docs/guides/system-health.md",
    group: "Administration",
    title: "System Health",
    nav: "System Health",
    description:
      "Check that the database, storage, memory, FlareSolverr, Thingiverse, AI and email all work, and fix what doesn't.",
  },
  {
    slug: "guides/ai",
    source: "docs/guides/ai.md",
    group: "Administration",
    title: "AI categorization and descriptions",
    nav: "AI features",
    description:
      "Sort models into your categories and clean up their descriptions with AI, on a local model through Ollama or a cloud API.",
  },
  {
    slug: "guides/single-sign-on",
    source: "docs/guides/single-sign-on.md",
    group: "Administration",
    title: "Single sign-on (OIDC)",
    nav: "Single sign-on",
    description:
      "Let people sign in to Thingport with Authentik, Pocket ID, Keycloak or any other OpenID Connect provider.",
  },
  {
    slug: "install/unraid",
    source: "docs/install/unraid/README.md",
    group: "Platform guides",
    title: "Install on Unraid",
    nav: "Unraid",
    description: "Run the Thingport stack on Unraid with the built-in Compose support or Compose Manager.",
  },
  {
    slug: "install/truenas",
    source: "docs/install/truenas/README.md",
    group: "Platform guides",
    title: "Install on TrueNAS SCALE",
    nav: "TrueNAS SCALE",
    description: "Run Thingport on TrueNAS SCALE as a Custom App or over SSH, with dataset-backed storage.",
  },
  {
    slug: "install/casaos",
    source: "docs/install/casaos/README.md",
    group: "Platform guides",
    title: "Install on CasaOS",
    nav: "CasaOS",
    description: "Run Thingport on CasaOS as a customized app or over SSH.",
  },
  {
    slug: "grab",
    source: "extension/README.md",
    group: "Companion apps",
    title: "Thingport Grab browser extension",
    nav: "Thingport Grab",
    description: "Import MakerWorld, Printables and Thingiverse models straight from their own pages.",
  },
  {
    slug: "grab/privacy",
    source: "extension/PRIVACY.md",
    group: "Companion apps",
    title: "Thingport Grab privacy policy",
    nav: "Thingport Grab privacy",
    description: "What the Thingport Grab browser extension stores, what it sends, and where.",
    unlisted: true,
  },
  {
    slug: "bridge",
    source: "bridge/README.md",
    group: "Companion apps",
    title: "Thingport Bridge",
    nav: "Thingport Bridge",
    description:
      "A small desktop helper that makes “Open in slicer” work for Bambu Studio, PrusaSlicer, Cura and Anycubic Slicer Next.",
  },
  {
    slug: "guides/api-token",
    source: "docs/guides/api-token.md",
    group: "Integrations",
    title: "Connect other apps with an API token",
    nav: "API token",
    description: "Generate a read-only token that lets other apps, scripts and dashboards read your Thingport library.",
  },
  {
    slug: "contributing",
    source: "CONTRIBUTING.md",
    group: "Contributing",
    title: "Contributing to Thingport",
    nav: "Contributing",
    description: "The branch, commit and pull request workflow for Thingport contributions.",
  },
  {
    slug: "development",
    source: "docs/DEVELOPMENT.md",
    group: "Contributing",
    title: "Development setup",
    nav: "Development",
    description: "Run Thingport locally with hot reload, and run the test suites.",
  },
  {
    slug: "grab/development",
    source: "extension/CONTRIBUTING.md",
    group: "Contributing",
    title: "Developing Thingport Grab",
    nav: "Thingport Grab development",
    description: "Build, run and package the Thingport Grab browser extension for Chrome, Edge and Firefox.",
  },
];

export const NAV_DOCS = DOCS.filter((d) => !d.unlisted);

/** Repo files that have a page on this site, so links between them stay on the site. */
export const SITE_ROUTES_BY_SOURCE = {
  "README.md": "",
  ...Object.fromEntries(DOCS.filter((d) => d.source).map((d) => [d.source, `docs/${d.slug}/`])),
};
