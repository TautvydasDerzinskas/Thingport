// What an API token may read over the REST API, a scope per kind of data. A token reaches only the
// scopes its user allowed; a path no scope lists falls under "other". Ids are stored on the user, so
// don't rename one; split a new scope out of an existing one with a migration that grants it to
// tokens holding that one, or the apps using them lose access.
//
// Keep this up to date when adding an important GET endpoint (see .claude/CLAUDE.md).

export type ApiTokenScope = {
  id: string;
  title: string;
  description: string;
  /** Paths under /api; `:name` matches one segment. */
  paths: string[];
};

export const OTHER_SCOPE = "other";

export const API_TOKEN_SCOPES: readonly ApiTokenScope[] = [
  {
    id: "search",
    title: "Search",
    description: "Search models, collections and tags.",
    paths: ["/search"],
  },
  {
    id: "models",
    title: "Models",
    description: "List models and read their details.",
    paths: ["/prints", "/print/:id", "/print/:id/quality"],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    description: "Library totals, most viewed and printed, the featured model and widgets.",
    paths: [
      "/dashboard/summary",
      "/dashboard/top-viewed",
      "/dashboard/top-printed",
      "/dashboard/top-authors",
      "/dashboard/recently-added",
      "/dashboard/featured",
      "/dashboard/weather",
      "/dashboard/weather/places",
      "/dashboard/weather/place-name",
      "/dashboard/feeds",
      "/dashboard/monitors",
      "/dashboard/system",
      "/dashboard/trending",
    ],
  },
  {
    id: "activity",
    title: "Activity",
    description: "Your activity heatmap and feed.",
    paths: ["/activity", "/activity/feed"],
  },
  {
    id: "collections",
    title: "Collections",
    description: "Your collections and what's in them.",
    paths: ["/collections", "/collection/:id", "/print/:id/collections", "/bookmarks"],
  },
  {
    id: "tags",
    title: "Tags",
    description: "Your tags and how many models have each.",
    paths: ["/tags", "/tags/summary", "/tags/bookmarked"],
  },
  {
    id: "categories",
    title: "Categories",
    description: "Your category tree.",
    paths: ["/categories"],
  },
  {
    id: "authors",
    title: "Authors",
    description: "Authors' profiles.",
    paths: ["/author/:id", "/me/author-links"],
  },
  {
    id: "images",
    title: "Images",
    description: "Thumbnails, renders and preview pictures.",
    paths: [
      "/plate/:id/thumb.jpg",
      "/plate/:id/render.png",
      "/print/:id/thumb.jpg",
      "/preview-image/:id/file.jpg",
      "/description-image/:id",
      "/tags/:tag/mosaic.webp",
      "/tags/:tag/render-mosaic.webp",
    ],
  },
  {
    id: "files",
    title: "Model files",
    description: "Download model files and 3D previews.",
    paths: [
      "/print/:id/plate/:plateId/file/:filename",
      "/plate/:id/preview.glb",
      "/print/:id/files",
      "/print/:id/files/:fileId",
      "/print/:id/prepared-print",
      "/category/:id/download",
    ],
  },
  {
    id: "imports",
    title: "Imports",
    description: "Progress of running imports.",
    paths: [
      "/import/status",
      "/import/tasks/:id",
      "/import/jobs/active",
      "/import/jobs/active-list",
      "/import/jobs/:id",
      "/import/jobs/:id/items",
      // MakerOnline's imports waiting for Grab (providers/makeronline/routes.ts). Scopes are listed here, one place for
      // every app that reads with a token, rather than by each provider.
      "/import/makeronline/waiting",
    ],
  },
  {
    id: OTHER_SCOPE,
    title: "Everything else",
    description: "Your settings, notifications, AI suggestions and anything not listed above.",
    paths: [],
  },
];

export const API_TOKEN_SCOPE_IDS = API_TOKEN_SCOPES.map((scope) => scope.id);

function pathPattern(path: string): RegExp {
  const segments = path
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  // Case-insensitive and with an optional trailing slash, as Express routes match.
  return new RegExp(`^${segments.join("/")}/?$`, "i");
}

const PATTERNS = API_TOKEN_SCOPES.flatMap((scope) =>
  scope.paths.map((path) => ({ id: scope.id, re: pathPattern(path) })),
);

/** The scope a path under /api needs. */
export function scopeForPath(path: string): string {
  return PATTERNS.find((pattern) => pattern.re.test(path))?.id ?? OTHER_SCOPE;
}

/** What the profile page offers to allow. */
export function apiTokenScopeCatalog() {
  return API_TOKEN_SCOPES.map(({ id, title, description }) => ({ id, title, description }));
}
