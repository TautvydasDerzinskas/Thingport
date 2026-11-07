import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import { printsApi } from "../api/prints";
import { dividerBorderColor } from "../theme";

// Stored images are referenced relative to the API, without the auth token.
function urlTransform(url: string, key: string): string {
  if (key === "src" && url.startsWith("/description-image/")) return printsApi.fileUrl(url);
  return defaultUrlTransform(url);
}

const components: Components = {
  a: ({ href, children }) => (
    <Link href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </Link>
  ),
  // No referrer, so a source CDN's hotlink protection doesn't block images that stayed remote.
  img: ({ src, alt }) => <img src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />,
};

// From a partner instance: images it names would be fetched by the viewer's browser, from wherever they are. Their
// words show instead, and links stay links.
const remoteComponents: Components = {
  ...components,
  img: ({ alt }) => (alt ? <em>{alt}</em> : null),
};

/** Renders a model description. Raw HTML in it is not rendered, so it needs no sanitizing. `remote` for one from a
 *  partner instance: no images, so a viewer's browser never reaches anywhere else. */
export default function MarkdownDescription({ markdown, remote = false }: { markdown: string; remote?: boolean }) {
  return (
    <Box
      sx={{
        typography: "body2",
        color: "text.primary",
        overflowWrap: "anywhere",
        "& > :first-child": { mt: 0 },
        "& > :last-child": { mb: 0 },
        "& p, & ul, & ol, & blockquote, & pre, & table": { my: 1.25 },
        "& h1, & h2, & h3, & h4, & h5, & h6": {
          mt: 2.5,
          mb: 1,
          lineHeight: 1.3,
          fontWeight: 700,
          color: (theme) => theme.thingport.headingText,
        },
        "& h1": { fontSize: "1.35rem" },
        "& h2": { fontSize: "1.2rem" },
        "& h3": { fontSize: "1.05rem" },
        "& h4, & h5, & h6": { fontSize: "0.95rem" },
        "& ul, & ol": { pl: 3 },
        "& li + li": { mt: 0.5 },
        "& img": { display: "block", maxWidth: "100%", height: "auto", borderRadius: "8px", my: 1 },
        "& blockquote": {
          mx: 0,
          pl: 1.5,
          borderLeft: "3px solid",
          borderColor: dividerBorderColor,
          color: "text.secondary",
        },
        "& code": {
          fontFamily: "monospace",
          fontSize: "0.85em",
          px: 0.5,
          borderRadius: "4px",
          bgcolor: "action.hover",
        },
        "& pre": { p: 1.5, borderRadius: "8px", bgcolor: "action.hover", overflowX: "auto" },
        "& pre code": { p: 0, bgcolor: "transparent" },
        "& hr": { border: 0, borderTop: "1px solid", borderColor: dividerBorderColor, my: 2 },
        "& table": { display: "block", overflowX: "auto", borderCollapse: "collapse" },
        "& th, & td": { border: "1px solid", borderColor: dividerBorderColor, px: 1, py: 0.5, textAlign: "left" },
      }}
    >
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={remote ? remoteComponents : components}
        urlTransform={remote ? defaultUrlTransform : urlTransform}
      >
        {markdown}
      </Markdown>
    </Box>
  );
}
