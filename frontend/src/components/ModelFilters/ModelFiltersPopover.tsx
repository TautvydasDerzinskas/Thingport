import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import type { PrintSource } from "../../api/prints";
import HelpTip from "../HelpTip";
import { printProviderInfo } from "../../constants/importProviders";
import { hasProviderLogo, ProviderLogo } from "../Layout/ConfigurationDialog/providerLogos";

type Props = {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  /** The sites the library holds models from, most first. */
  sources: PrintSource[];
  /** The sites turned off; every other one is on. */
  hidden: string[];
  onHiddenChange: (next: string[]) => void;
  generative: boolean;
  onGenerativeChange: (on: boolean) => void;
};

/** One site, as a chip carrying its logo. Every site is on to begin with, so it's the ones turned off that are
 *  marked -- faded, with a dashed edge and a grey logo -- rather than the ones left alone, which would otherwise
 *  make the untouched filter look like a filter. */
function SourceChip({
  provider,
  count,
  on,
  onClick,
}: {
  provider: string;
  count: number;
  on: boolean;
  onClick: () => void;
}) {
  const info = printProviderInfo(provider);
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-pressed={on}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        px: 1,
        py: 0.5,
        border: 1,
        borderStyle: on ? "solid" : "dashed",
        borderColor: "divider",
        borderRadius: 1.5,
        bgcolor: on ? "background.paper" : "transparent",
        color: on ? "text.primary" : "text.disabled",
        font: "inherit",
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.3,
        cursor: "pointer",
        opacity: on ? 1 : 0.65,
        textDecoration: on ? "none" : "line-through",
        transition: "background-color 150ms, border-color 150ms, opacity 150ms",
        "&:hover": { opacity: 1, borderColor: "text.secondary" },
        "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
      }}
    >
      {hasProviderLogo(provider) && (
        <Box sx={{ display: "flex", filter: on ? "none" : "grayscale(1)" }} aria-hidden="true">
          <ProviderLogo id={provider} size={14} />
        </Box>
      )}
      {info.label}
      <Box component="span" sx={{ opacity: 0.7, fontWeight: 500 }}>
        {count}
      </Box>
    </Box>
  );
}

/**
 * The listing's filters, behind the toolbar's filter button: which sites to list models from, and whether to list
 * only the generative ones.
 *
 * Every site is on until it is turned off, so what's kept is the sites hidden rather than the sites shown -- one the
 * library gains later is then in the listing from the start, instead of arriving already filtered out.
 */
export default function ModelFiltersPopover({
  anchorEl,
  onClose,
  sources,
  hidden,
  onHiddenChange,
  generative,
  onGenerativeChange,
}: Props) {
  const { t } = useTranslation("models");
  const isOn = (provider: string) => !hidden.includes(provider);
  const toggle = (provider: string) =>
    onHiddenChange(isOn(provider) ? [...hidden, provider] : hidden.filter((id) => id !== provider));

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{ paper: { sx: { mt: 1, p: 2, width: 320, maxWidth: "calc(100vw - 32px)" } } }}
    >
      <Stack spacing={1.5}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography component="label" htmlFor="generative-switch" sx={{ fontWeight: 600, fontSize: 14 }}>
              {t("filters.generative")}
              <HelpTip text={t("filters.generativeHint")} />
            </Typography>
          </Box>
          <Switch
            id="generative-switch"
            size="small"
            checked={generative}
            onChange={(event) => onGenerativeChange(event.target.checked)}
            inputProps={{ "aria-label": t("filters.generative") }}
          />
        </Box>

        <Divider />

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="overline" sx={{ flex: 1, color: "text.secondary", lineHeight: 1.6 }}>
            {t("filters.sources")}
          </Typography>
          <Button size="small" onClick={() => onHiddenChange([])} disabled={!hidden.length} sx={{ minWidth: 0 }}>
            {t("filters.allSources")}
          </Button>
        </Box>

        {sources.length ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {sources.map((source) => (
              <SourceChip
                key={source.provider}
                provider={source.provider}
                count={source.model_count}
                on={isOn(source.provider)}
                onClick={() => toggle(source.provider)}
              />
            ))}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t("filters.noSources")}
          </Typography>
        )}
      </Stack>
    </Popover>
  );
}
