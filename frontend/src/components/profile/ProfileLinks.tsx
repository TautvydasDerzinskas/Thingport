import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import LinkIcon from "@mui/icons-material/Link";
import { printProviderInfo } from "../../constants/importProviders";
import { detectProvider } from "../../providers/index.generated";

const decoded = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** A link as its owner would say it: the model site's name and their handle there, or the address without its
 *  scheme. */
export function linkLabel(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  const provider = detectProvider(url);
  if (provider) {
    const last = path.split("/").findLast((segment) => segment.length > 0);
    const name = printProviderInfo(provider).label;
    return last && last.length <= 32 ? `${name} · ${decoded(last)}` : name;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  return path && path.length <= 28 ? `${host}${path}` : host;
}

/** A profile's links, under its bio. They're the owner's to choose, so they open apart from Thingport and tell the
 *  site nothing about it. */
export default function ProfileLinks({ links }: { links: string[] }) {
  return (
    <Stack component="ul" spacing={0.75} sx={{ listStyle: "none", p: 0, m: 0, mt: 2 }}>
      {links.map((url) => (
        <li key={url}>
          {/* The address as a description: the link is named by what it shows. */}
          <Tooltip title={url} placement="bottom-start" describeChild>
            <Link
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              referrerPolicy="no-referrer"
              underline="hover"
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, maxWidth: "100%", typography: "body2" }}
            >
              <LinkIcon sx={{ fontSize: 16, color: "text.secondary", flexShrink: 0 }} />
              <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {linkLabel(url)}
              </Box>
            </Link>
          </Tooltip>
        </li>
      ))}
    </Stack>
  );
}
