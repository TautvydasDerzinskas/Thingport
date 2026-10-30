// Builds the GitHub wiki from the repo's Markdown so it can't drift from the docs. Run by
// .github/workflows/wiki.yml; locally:
//
//   node .github/wiki/build.mjs <out-dir>
//
// Home is the README minus its install section, Installation is that section, and every doc in
// site.mjs's DOCS with a `source` gets a page.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRANCH, DOCS, REPO, REPO_URL } from "../../web/src/lib/site.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const outDir = path.resolve(process.argv[2] ?? "wiki-out");

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const pageName = (title) => title.replace(/[\s/]+/g, "-");

const readme = read("README.md");
const installStart = readme.indexOf("\n## Installation\n");
const installEnd = readme.indexOf("\n## ", installStart + 1);
if (installStart < 0 || installEnd < 0) throw new Error("README.md has no '## Installation' section");

const pages = [
  {
    name: "Home",
    source: "README.md",
    body:
      readme.slice(0, installStart) +
      "\n## Installation\n\nSee **[Installation](Installation)** for Docker Compose, and the sidebar for Unraid, TrueNAS SCALE and CasaOS.\n" +
      readme.slice(installEnd),
  },
  {
    name: "Installation",
    group: "Getting started",
    source: "README.md",
    body: readme.slice(installStart + 1, installEnd),
  },
  ...DOCS.filter((d) => d.source).map((d) => ({
    name: pageName(d.title),
    nav: d.nav,
    group: d.unlisted ? undefined : d.group,
    source: d.source,
    body: read(d.source),
  })),
];

const pageBySource = {
  "README.md": "Home",
  ...Object.fromEntries(pages.slice(2).map((p) => [p.source, p.name])),
};
const pageNames = new Set(pages.map((p) => p.name));

function rewrite(attr, value, dir) {
  if (!value || /^[a-z][a-z0-9+.-]*:|^#|^\//i.test(value)) return value;
  const [target, hash] = value.split("#");
  if (pageNames.has(target)) return value;
  const repoPath = path.posix.normalize(path.posix.join(dir, target));
  const anchor = hash ? `#${hash}` : "";
  if (attr === "src") return `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${repoPath}`;
  if (repoPath in pageBySource) return pageBySource[repoPath] + anchor;
  const isFile = fs.statSync(path.join(ROOT, repoPath), { throwIfNoEntry: false })?.isFile() ?? true;
  return `${REPO_URL}/${isFile ? "blob" : "tree"}/${BRANCH}/${repoPath}${anchor}`;
}

/** Rewrites Markdown links/images and inline-HTML href/src, leaving fenced code blocks alone. */
function rewriteLinks(markdown, source) {
  const dir = path.posix.dirname(source);
  return markdown
    .split(/(^```[\s\S]*?^```)/m)
    .map((chunk, i) =>
      i % 2
        ? chunk
        : chunk
            .replace(
              /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g,
              (_, bang, text, url) => `${bang}[${text}](${rewrite(bang ? "src" : "href", url, dir)})`,
            )
            .replace(/\b(href|src)="([^"]*)"/g, (_, attr, url) => `${attr}="${rewrite(attr, url, dir)}"`)
            // A <picture>'s dark variant: left relative, it resolves to a wiki page and shows as a broken image.
            .replace(
              /\bsrcset="([^"]*)"/g,
              (_, set) =>
                `srcset="${set
                  .split(",")
                  .map((entry) => entry.trim().replace(/^\S+/, (url) => rewrite("src", url, dir)))
                  .join(", ")}"`,
            ),
    )
    .join("");
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const page of pages) {
  const note = `<!-- Generated from ${page.source} by .github/wiki/build.mjs. Edit that file, not the wiki. -->\n\n`;
  fs.writeFileSync(path.join(outDir, `${page.name}.md`), note + rewriteLinks(page.body, page.source));
}

const groups = [...new Set(pages.filter((p) => p.group).map((p) => p.group))];
const sidebar = [
  "**[Home](Home)**",
  ...groups.map(
    (g) =>
      `\n**${g}**\n\n` +
      pages
        .filter((p) => p.group === g)
        .map((p) => `- [${p.nav ?? p.name}](${p.name})`)
        .join("\n"),
  ),
  `\n**Links**\n\n- [Website](https://thingport.net/)\n- [Releases](${REPO_URL}/releases)\n- [Issues](${REPO_URL}/issues)`,
].join("\n");
fs.writeFileSync(path.join(outDir, "_Sidebar.md"), sidebar + "\n");
fs.writeFileSync(
  path.join(outDir, "_Footer.md"),
  `This wiki is generated from the [repository](${REPO_URL}) docs. To change a page, edit its source file there.\n`,
);

console.log(`Wrote ${pages.length} pages to ${outDir}`);
