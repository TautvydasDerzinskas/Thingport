import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

// Descriptions are stored as Markdown: it stays readable as plain text (search, the edit
// field), and the sources' HTML converts to it without needing sanitizing on display.

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  service.use(gfm);
  // MakerWorld's "Boost Me" banner, and anything that isn't content.
  service.remove(["boostme", "script", "style", "noscript", "button", "form"] as unknown as TurndownService.Filter);
  service.addRule("image", {
    filter: "img",
    replacement: (_content, node) => {
      const src = absoluteHttpUrl(attrs(node).getAttribute("src"));
      if (!src) return "";
      const alt = (attrs(node).getAttribute("alt") || "").replace(/[[\]\n]/g, " ").trim();
      return `![${alt}](${src})`;
    },
  });
  // "- item" rather than Turndown's "-   item", which is awkward to edit by hand.
  service.addRule("listItem", {
    filter: "li",
    replacement: (content, node, options) => {
      const item = node as unknown as { parentNode: ListNode | null; nextSibling: unknown };
      const list = item.parentNode;
      let prefix = `${options.bulletListMarker} `;
      if (list?.nodeName === "OL") {
        const start = Number(list.getAttribute("start")) || 1;
        prefix = `${start + Array.prototype.indexOf.call(list.children, node)}. `;
      }
      const body = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n")
        .replace(/\n/gm, `\n${" ".repeat(prefix.length)}`);
      return prefix + body + (item.nextSibling && !body.endsWith("\n") ? "\n" : "");
    },
  });
  // Overrides the GFM plugin's tables, which keep any table without a header row as raw HTML.
  service.addRule("table", {
    filter: "table",
    replacement: (_content, node) => `\n\n${tableToMarkdown(service, node as unknown as DomNode)}\n\n`,
  });
  // Embedded videos can't be kept; a link to them can.
  service.addRule("iframe", {
    filter: "iframe",
    replacement: (_content, node) => {
      const src = absoluteHttpUrl(attrs(node).getAttribute("src"));
      return src ? `\n\n[${src}](${src})\n\n` : "";
    },
  });
  return service;
}

let turndown: TurndownService | null = null;

// The backend builds without the DOM lib; these are all the rules read from a node.
type ListNode = { nodeName: string; children: ArrayLike<unknown>; getAttribute(name: string): string | null };

type DomNode = {
  nodeName: string;
  children: ArrayLike<DomNode>;
  innerHTML: string;
  querySelector(selector: string): DomNode | null;
};

// A cell holding any of these is page layout (text beside a picture, say), not tabular data.
const LAYOUT_CELL_CONTENT = "ul, ol, img, figure, h1, h2, h3, h4, h5, h6, table, blockquote, pre";

function tableRows(table: DomNode): DomNode[][] {
  const rows: DomNode[] = [];
  for (const child of Array.from(table.children)) {
    if (child.nodeName === "TR") rows.push(child);
    else if (["THEAD", "TBODY", "TFOOT"].includes(child.nodeName)) {
      rows.push(...Array.from(child.children).filter((row) => row.nodeName === "TR"));
    }
  }
  return rows
    .map((row) => Array.from(row.children).filter((cell) => cell.nodeName === "TD" || cell.nodeName === "TH"))
    .filter((cells) => cells.length);
}

/** A Markdown table when the cells hold plain text; Markdown tables can't hold lists, images or
 *  more than one line, so a layout table is unrolled into its cells' content instead. */
function tableToMarkdown(service: TurndownService, table: DomNode): string {
  const rows = tableRows(table);
  if (!rows.length) return "";
  if (table.querySelector(LAYOUT_CELL_CONTENT)) {
    return rows
      .flat()
      .map((cell) => service.turndown(cell.innerHTML).trim())
      .filter(Boolean)
      .join("\n\n");
  }
  const width = Math.max(...rows.map((cells) => cells.length));
  const lines = rows.map((cells) => {
    const texts = cells.map((cell) =>
      service
        .turndown(cell.innerHTML)
        .replace(/\s*\n+\s*/g, " ")
        .replace(/\|/g, "\\|")
        .trim(),
    );
    while (texts.length < width) texts.push("");
    return `| ${texts.join(" | ")} |`;
  });
  // GFM tables need a header row; without a <th> row, the first row is the closest thing.
  lines.splice(1, 0, `|${" --- |".repeat(width)}`);
  return lines.join("\n");
}

function attrs(node: unknown): { getAttribute(name: string): string | null } {
  return node as { getAttribute(name: string): string | null };
}

export function absoluteHttpUrl(value: string | null): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  const url = raw.startsWith("//") ? `https:${raw}` : raw;
  return /^https?:\/\//i.test(url) ? url.replace(/[()\s]/g, encodeURIComponent) : null;
}

export function tidy(markdown: string): string | null {
  const text = markdown
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

export function htmlToMarkdown(html: string): string | null {
  turndown ??= createTurndown();
  return tidy(turndown.turndown(html));
}
