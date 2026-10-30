import { visit } from "unist-util-visit";

/**
 * Ends each table header cell with a space, which the page doesn't show. The search index runs a header row's cells
 * together otherwise ("SiteWhat syncs"), while it keeps body cells apart. Whitespace between the cells wouldn't
 * last: Astro's final HTML pass moves it out of the table. Empty cells stay empty: there's nothing in them to run
 * together, and starlight.css tells a key/value table by its empty last header cell.
 */
export function rehypeTableHeaders() {
  return (tree) => {
    visit(tree, "element", (node) => {
      if (node.tagName === "th" && node.children.length) node.children.push({ type: "text", value: " " });
    });
  };
}
