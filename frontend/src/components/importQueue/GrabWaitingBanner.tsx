import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GrabWaitingOut } from "../../api/imports";
import { isProviderId, MANIFESTS } from "../../providers/index.generated";
import { statusTint } from "../../theme";
import { riseInSx, tapTargetSx } from "./queueParts";

/** The site a provider's imports wait on, and where it lives. */
function siteOf(provider: string): { name: string; host: string } | null {
  if (!isProviderId(provider)) return null;
  const { name, site } = MANIFESTS[provider];
  return { name, host: new URL(site).hostname };
}

/** Over the queue: imports of one's own that a provider's block stopped and Thingport Grab finishes once its puzzle is
 *  solved on the site. One button sends the user there, to the first of them, where Grab offers to open the puzzle. */
export default function GrabWaitingBanner({ waiting }: { waiting: GrabWaitingOut[] }) {
  const { t } = useTranslation("app");
  const shown = waiting.flatMap((entry) => {
    const site = siteOf(entry.provider);
    return site && entry.url ? [{ ...entry, ...site, url: entry.url }] : [];
  });
  if (!shown.length) return null;
  return (
    <Box sx={{ display: "grid", gap: 1, mb: 2 }}>
      {shown.map((entry) => (
        <Box
          key={entry.provider}
          aria-live="polite"
          sx={[
            (theme) => ({
              ...riseInSx,
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 1.25,
              px: 1.5,
              py: 1.25,
              borderRadius: 1.5,
              bgcolor: statusTint(theme, "info").background,
              color: statusTint(theme, "info").text,
            }),
          ]}
        >
          <ExtensionOutlinedIcon fontSize="small" aria-hidden />
          <Box sx={{ flex: "1 1 220px", minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t("importQueue.grabWaiting.title", { count: entry.count, site: entry.name })}
            </Typography>
            <Typography variant="caption" component="div" sx={{ opacity: 0.85 }}>
              {t("importQueue.grabWaiting.text", { count: entry.count, host: entry.host })}
            </Typography>
          </Box>
          <Button
            size="small"
            variant="contained"
            startIcon={<ExtensionOutlinedIcon />}
            endIcon={<OpenInNewIcon sx={{ fontSize: "0.9rem !important" }} />}
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            sx={tapTargetSx}
          >
            {t("importQueue.grabWaiting.solve", { site: entry.name })}
          </Button>
        </Box>
      ))}
    </Box>
  );
}
