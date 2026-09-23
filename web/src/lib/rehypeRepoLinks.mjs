import path from "node:path";
import { fileURLToPath } from "node:url";
import { visit } from "unist-util-visit";
import { BRANCH, REPO, REPO_URL, SITE_ROUTES_BY_SOURCE } from "./site.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The docs are written for GitHub, where `[x](../PROVIDER_SETUP.md)` or `<img src="icon.png">`
 * resolve against the file's own folder. On the site, links to another rendered doc go to its
 * page, anything else in the repo goes to GitHub, and images load from the raw file. Root-relative
 * links (`/docs/install/`, used in blog posts) get the base path prefixed.
 */
export function rehypeRepoLinks({ base = "/" } = {}) {
  const basePrefix = base.endsWith("/") ? base : `${base}/`;
  return (tree, file) => {
    const sourcePath = file.path || file.history?.[0];
    const sourceDir = sourcePath ? path.relative(REPO_ROOT, path.dirname(sourcePath)) : "";
    const dir = sourceDir.split(path.sep).join("/");
    visit(tree, "element", (node) => {
      const attr = node.tagName === "a" ? "href" : node.tagName === "img" ? "src" : null;
      const value = attr && node.properties?.[attr];
      if (typeof value === "string" && value) node.properties[attr] = rewrite(attr, value, dir, basePrefix);
    });
    // Inline HTML in the Markdown (the install guides' centered `<img src="icon.png">`) stays a raw
    // string rather than becoming elements, so its attributes are rewritten textually.
    visit(tree, "raw", (node) => {
      node.value = node.value.replace(
        /\b(href|src)="([^"]*)"/g,
        (_, attr, value) => `${attr}="${rewrite(attr, value, dir, basePrefix)}"`,
      );
    });
  };
}

function rewrite(attr, value, dir, basePrefix) {
  if (value.startsWith("/") && !value.startsWith("//")) return basePrefix + value.slice(1);
  if (!value || /^[a-z][a-z0-9+.-]*:|^#|^\/\//i.test(value)) return value;

  const [target, hash = ""] = value.split("#");
  const repoPath = path.posix.normalize(path.posix.join(dir, target));
  const anchor = hash ? `#${hash}` : "";
  if (attr === "src") return `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${repoPath}`;
  if (repoPath in SITE_ROUTES_BY_SOURCE) return basePrefix + SITE_ROUTES_BY_SOURCE[repoPath] + anchor;
  // A dotfile like `.env` has no extname as far as path is concerned, but is still a file.
  const isFile = path.posix.extname(repoPath) || path.posix.basename(repoPath).startsWith(".");
  return `${REPO_URL}/${isFile ? "blob" : "tree"}/${BRANCH}/${repoPath}${anchor}`;
}
