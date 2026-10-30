import { isRepoDoc, isRootDoc } from "./remarkDropTitle.mjs";

/** Each GitHub alert type as a Starlight aside variant, under GitHub's own title. */
const ALERTS = {
  note: { variant: "note", title: "Note" },
  tip: { variant: "tip", title: "Tip" },
  // Key information rather than a risk: a warning's colour stays for warnings.
  important: { variant: "note", title: "Important" },
  warning: { variant: "caution", title: "Warning" },
  caution: { variant: "danger", title: "Caution" },
};

const MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i;

/**
 * GitHub's alerts (`> [!WARNING]` on a line of its own, then the text) as Starlight asides. Each becomes the container
 * directive a `:::caution[Warning]` block parses to, which Starlight's asides plugin renders after this one. As on
 * GitHub, only a top-level quote counts, and one with text after the marker or nothing below it stays a quote.
 *
 * Starlight doesn't render asides in the docs at the repo's root (CONTRIBUTING.md), so an alert there fails the build
 * rather than turn up on the site as bare text.
 */
export function remarkGithubAlerts() {
  return (tree, file) => {
    if (!isRepoDoc(file)) return;
    tree.children = tree.children.map((node) => {
      const aside = toAside(node);
      if (aside && isRootDoc(file)) {
        file.fail(
          "The site can't show GitHub alerts in files at the repo's root (see astro.config.mjs): make this a plain quote",
          node,
        );
      }
      return aside ?? node;
    });
  };
}

function toAside(quote) {
  if (quote.type !== "blockquote") return;
  const [first, ...rest] = quote.children;
  const [marker, ...inline] = first?.type === "paragraph" ? first.children : [];
  const match = marker?.type === "text" ? MARKER.exec(marker.value) : null;
  if (!match) return;

  const text = marker.value.slice(match[0].length);
  const lead = [...(text ? [{ ...marker, value: text }] : []), ...inline];
  if (lead[0]?.type === "break") lead.shift();
  const content = lead.length ? [{ ...first, children: lead }, ...rest] : rest;
  if (!content.length) return;

  const { variant, title } = ALERTS[match[1].toLowerCase()];
  return {
    type: "containerDirective",
    name: variant,
    attributes: {},
    children: [
      { type: "paragraph", data: { directiveLabel: true }, children: [{ type: "text", value: title }] },
      ...content,
    ],
    position: quote.position,
  };
}
