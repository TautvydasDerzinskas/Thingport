import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = fileURLToPath(new URL("../../", import.meta.url));
const REPO_DIR = path.dirname(WEB_DIR);

/** Whether a Markdown file is one of the repo's docs, rather than one of the site's own (the blog, in web/). */
export function isRepoDoc(file) {
  return Boolean(file.path) && !path.resolve(file.path).startsWith(WEB_DIR);
}

/** Whether a repo doc is at the repo's root, which Starlight doesn't process Markdown in (astro.config.mjs). */
export function isRootDoc(file) {
  return isRepoDoc(file) && path.dirname(path.resolve(file.path)) === REPO_DIR;
}

/**
 * Starlight puts each page's title above it, so the repo's Markdown drops its own `# Title`, along with any HTML
 * before it (the centred icon the install guides open with on GitHub).
 */
export function remarkDropTitle() {
  return (tree, file) => {
    if (!isRepoDoc(file)) return;
    const title = tree.children.findIndex((node) => node.type === "heading" && node.depth === 1);
    if (title === -1 || tree.children.slice(0, title).some((node) => node.type !== "html")) return;
    tree.children.splice(0, title + 1);
  };
}
