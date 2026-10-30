import path from "node:path";
import { rehypeHeadingIds } from "@astrojs/markdown-remark";
import { SKIP, visit } from "unist-util-visit";
import { isRootDoc } from "./remarkDropTitle.mjs";
import { REPO_IMAGES, REPO_ROOT } from "./repoImages.mjs";
import { BRANCH, REPO_URL, SITE_ROUTES_BY_SOURCE } from "./site.mjs";

/**
 * The docs are written for GitHub, where `[x](../PROVIDER_SETUP.md)` or `<img src="icon.png">`
 * resolve against the file's own folder. On the site, links to another rendered doc go to its
 * page and anything else in the repo goes to GitHub. Images are the site's own: `repo/<path>`,
 * which repoImages.mjs copies from the checkout into the build (and serves in `astro dev`), so a
 * page shows the images of the branch it was built from. Root-relative links (`/docs/install/`,
 * used in blog posts) get the base path prefixed.
 *
 * A `<picture>` with a `prefers-color-scheme: dark` source (GitHub's way of theming an image)
 * becomes two images shown by the site's own theme, so the header's theme toggle switches it too.
 *
 * Starlight links the headings of files in its processedDirs, which are folders: the repo root
 * would take in the blog too, so the docs at the root (CONTRIBUTING.md) get the same links here.
 */
export function rehypeRepoLinks({ base = "/" } = {}) {
  const basePrefix = base.endsWith("/") ? base : `${base}/`;
  return (tree, file) => {
    const sourcePath = file.path || file.history?.[0];
    const sourceDir = sourcePath ? path.relative(REPO_ROOT, path.dirname(sourcePath)) : "";
    const dir = sourceDir.split(path.sep).join("/");
    const images = new Set();
    visit(tree, "element", (node) => {
      const attr = node.tagName === "a" ? "href" : node.tagName === "img" ? "src" : null;
      const value = attr && node.properties?.[attr];
      if (typeof value !== "string" || !value) return;
      node.properties[attr] = rewrite(attr, value, dir, basePrefix);
      if (attr === "src") images.add(decodeURI(value));
    });
    // Astro would bundle the Markdown's images as well, though the pages no longer use those copies.
    const collected = file.data.astro?.localImagePaths;
    if (collected) file.data.astro.localImagePaths = collected.filter((src) => !images.has(src));
    // Inline HTML stays a raw string, so its attributes are rewritten textually.
    visit(tree, "raw", (node) => {
      node.value = themedPictures(node.value).replace(/\b(href|src|srcset)="([^"]*)"/g, (_, attr, value) => {
        // A srcset lists `url [size]` candidates, separated by commas. A <picture> written on one line reaches
        // here in pieces, too late for themedPictures, and its dark source still has to load.
        const rewritten =
          attr === "srcset"
            ? value
                .split(",")
                .map((candidate) => candidate.replace(/\S+/, (src) => rewrite("src", src, dir, basePrefix)))
                .join(",")
            : rewrite(attr, value, dir, basePrefix);
        return `${attr}="${rewritten}"`;
      });
    });
    if (isRootDoc(file)) linkHeadings(tree, file);
  };
}

// Starlight's anchor link icon ("link-alt").
const LINK_ICON =
  "m12.11 15.39-3.88 3.88a2.52 2.52 0 0 1-3.5 0 2.47 2.47 0 0 1 0-3.5l3.88-3.88a1 1 0 1 0-1.42-1.42l-3.88 3.89a4.48 4.48 0 0 0 6.33 6.33l3.89-3.88a1 1 0 0 0-1.42-1.42m8.58-12.08a4.49 4.49 0 0 0-6.33 0l-3.89 3.88a1 1 0 1 0 1.42 1.42l3.88-3.88a2.52 2.52 0 0 1 3.5 0 2.47 2.47 0 0 1 0 3.5l-3.88 3.88a1 1 0 0 0 0 1.42 1 1 0 0 0 1.42 0l3.88-3.89a4.49 4.49 0 0 0 0-6.33M8.83 15.17a1 1 0 0 0 .71.29 1 1 0 0 0 .71-.29l4.92-4.92a1 1 0 1 0-1.42-1.42l-4.92 4.92a1 1 0 0 0 0 1.42";

const element = (tagName, properties, children = []) => ({ type: "element", tagName, properties, children });
const textOf = (node) => (node.type === "text" ? node.value : (node.children ?? []).map(textOf).join(""));

/** Wraps each heading with an anchor link to it, in the markup Starlight uses for the docs it processes. */
function linkHeadings(tree, file) {
  // Starlight sets the ids after this plugin; its pass and Astro's keep the ones set here.
  rehypeHeadingIds()(tree, file);
  visit(tree, "element", (node, index, parent) => {
    if (!/^h[1-6]$/.test(node.tagName) || !node.properties.id || index === undefined || !parent) return;
    parent.children[index] = element("div", { className: ["sl-heading-wrapper", `level-${node.tagName}`] }, [
      node,
      element("a", { className: ["sl-anchor-link"], href: `#${node.properties.id}` }, [
        element("span", { ariaHidden: "true", className: ["sl-anchor-icon"] }, [
          element("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "currentColor" }, [
            element("path", { d: LINK_ICON }),
          ]),
        ]),
        element("span", { className: ["sr-only"], dataPagefindIgnore: true }, [
          { type: "text", value: `Section titled “${textOf(node)}”` },
        ]),
      ]),
    ]);
    return SKIP;
  });
}

const THEMED_PICTURE =
  /<picture>\s*<source\s+media="\(prefers-color-scheme:\s*dark\)"\s+srcset="([^"]+)"\s*\/?>\s*<img\s+([^>]*?)\s*\/?>\s*<\/picture>/g;

function themedPictures(html) {
  return html.replace(THEMED_PICTURE, (_, dark, attrs) => {
    // A lazy image that's hidden is never fetched, so only the theme's own one downloads.
    const lazy = /\bloading=/.test(attrs) ? attrs : `loading="lazy" ${attrs}`;
    return `<img class="only-light" ${lazy}><img class="only-dark" ${lazy.replace(/\bsrc="[^"]*"/, `src="${dark}"`)}>`;
  });
}

function rewrite(attr, value, dir, basePrefix) {
  if (value.startsWith("/") && !value.startsWith("//")) return basePrefix + value.slice(1);
  if (!value || /^[a-z][a-z0-9+.-]*:|^#|^\/\//i.test(value)) return value;

  const [target, hash = ""] = value.split("#");
  const repoPath = path.posix.normalize(path.posix.join(dir, target));
  const anchor = hash ? `#${hash}` : "";
  if (attr === "src") return basePrefix + REPO_IMAGES + repoPath;
  if (repoPath in SITE_ROUTES_BY_SOURCE) return basePrefix + SITE_ROUTES_BY_SOURCE[repoPath] + anchor;
  // `.env` has no extname but is still a file.
  const isFile = path.posix.extname(repoPath) || path.posix.basename(repoPath).startsWith(".");
  return `${REPO_URL}/${isFile ? "blob" : "tree"}/${BRANCH}/${repoPath}${anchor}`;
}
