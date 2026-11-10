import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import Popover from "@mui/material/Popover";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, type Theme } from "@mui/material/styles";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DoNotDisturbOnOutlinedIcon from "@mui/icons-material/DoNotDisturbOnOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import type { License } from "../../api/prints";
import { printProviderInfo } from "../../constants/importProviders";
import { neutralTint } from "../../theme";
import { copyText } from "../../utils/clipboard";
import { visuallyHiddenSx } from "../importQueue/queueParts";
import { hasProviderLogo, ProviderLogo } from "../Layout/ConfigurationDialog/providerLogos";
import { useToast } from "../ToastProvider";
import LicenseMarks from "./LicenseMarks";

type Can = "yes" | "no" | "must";
type Row = { key: string; label: string; can: Can };

/** The three or four words the strip says the licence comes to. */
export function licenseSummary(license: License, t: TFunction): string {
  if (!license.family) return t("models:license.summary.seeTerms");
  const allows = new Set(license.allows);
  // A site's own licence gives personal use; one with every right reserved gives nothing.
  if (!allows.size) {
    return t(
      license.family === "reserved" ? "models:license.summary.nothingGiven" : "models:license.summary.personalUse",
    );
  }
  const parts: string[] = [];
  if (license.requires.credit) parts.push(t("models:license.summary.credit"));
  if (!allows.has("commercial")) parts.push(t("models:license.summary.nonCommercial"));
  if (!allows.has("remix")) parts.push(t("models:license.summary.noRemix"));
  else if (license.requires.same_license) parts.push(t("models:license.summary.shareAlike"));
  if (!allows.has("share")) parts.push(t("models:license.summary.noSharing"));
  return parts.length ? parts.join(" · ") : t("models:license.summary.noConditions");
}

function deedRows(license: License, t: TFunction): Row[] {
  const allows = new Set(license.allows);
  const rows: Row[] = [
    { key: "share", label: t("models:license.deed.share"), can: allows.has("share") ? "yes" : "no" },
    { key: "remix", label: t("models:license.deed.remix"), can: allows.has("remix") ? "yes" : "no" },
    { key: "commercial", label: t("models:license.deed.commercial"), can: allows.has("commercial") ? "yes" : "no" },
  ];
  if (license.requires.credit) rows.push({ key: "credit", label: t("models:license.deed.credit"), can: "must" });
  if (license.requires.same_license && allows.has("remix")) {
    rows.push({ key: "same", label: t("models:license.deed.sameLicense"), can: "must" });
  }
  return rows;
}

const CAN_COLOR: Record<Can, string> = { yes: "success.main", no: "error.main", must: "warning.main" };
const CAN_WORD: Record<Can, string> = {
  yes: "models:license.can.yes",
  no: "models:license.can.no",
  must: "models:license.can.must",
};
function CanIcon({ can }: { can: Can }) {
  if (can === "yes") return <CheckCircleOutlineIcon sx={{ fontSize: 16 }} />;
  if (can === "no") return <DoNotDisturbOnOutlinedIcon sx={{ fontSize: 16 }} />;
  return <InfoOutlinedIcon sx={{ fontSize: 16 }} />;
}

type Props = {
  license: License | null;
  /** Being read from its source now. */
  loading: boolean;
  /** Its source couldn't be read, as opposed to stating none; `onRetry` asks again. */
  failed?: boolean;
  onRetry?: () => void;
  /** Where the model came from; with no licence, the strip says that site doesn't state one. */
  provider: string | null | undefined;
  /** What the credit line names. */
  credit: { title: string; creator: string | null | undefined; sourceUrl: string | null | undefined };
  /** The owner's way to pick another, in Edit model. */
  onChange?: () => void;
  /** "footer" closes a padded box it's the last thing in; "standalone" is a box of its own. */
  variant?: "footer" | "standalone";
};

/**
 * The licence, as a strip closing the description box: its marks, name and what it comes to in a few words. Clicking
 * it opens the rest -- what it allows, the site's or creator's own terms, the licence itself and a credit line to copy.
 * Renders nothing for a model with no source and no licence.
 */
export default function LicenseStrip({
  license,
  loading,
  failed = false,
  onRetry,
  provider,
  credit,
  onChange,
  variant = "footer",
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const showToast = useToast();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!license && !loading && !provider) return null;
  const site = provider ? printProviderInfo(provider).label : null;

  const shell = (children: React.ReactNode) => (
    <Box
      sx={{
        ...(variant === "footer"
          ? { mx: -2, mb: -2, mt: 2.5, borderTop: 1, borderBottomLeftRadius: "12px", borderBottomRightRadius: "12px" }
          : { border: 1, borderRadius: "12px" }),
        borderColor: "divider",
        bgcolor: (theme: Theme) => neutralTint(theme),
        overflow: "hidden",
      }}
    >
      {children}
    </Box>
  );

  if (!license) {
    return shell(
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2, py: 1, minHeight: 40 }}>
        <GavelOutlinedIcon fontSize="small" sx={{ color: "text.disabled" }} />
        {loading ? (
          <Skeleton variant="rounded" width={220} height={18} aria-label={t("models:license.reading")} />
        ) : failed ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
              {t("models:license.readFailed", { site })}
            </Typography>
            {onRetry && (
              <Button size="small" startIcon={<RefreshIcon fontSize="small" />} onClick={onRetry} sx={{ my: -0.5 }}>
                {t("models:license.retry")}
              </Button>
            )}
          </>
        ) : (
          <Typography variant="body2" color="text.disabled">
            {t("models:license.notStated", { site })}
          </Typography>
        )}
      </Stack>,
    );
  }

  // Where the licence was read from: the site it names, even once the model's source is cleared.
  const from = license.provider ?? provider ?? null;
  const fromSite = from ? printProviderInfo(from).label : null;
  const summary = licenseSummary(license, t);
  const creditLine = [
    `“${credit.title}”`,
    credit.creator?.trim() ? t("models:license.creditBy", { creator: credit.creator.trim() }) : null,
    credit.sourceUrl ? `(${credit.sourceUrl})` : null,
    t("models:license.creditUnder", { license: license.short }),
  ]
    .filter(Boolean)
    .join(" ");
  const copyCredit = async () => {
    try {
      await copyText(creditLine);
      showToast({ message: t("models:license.copied") });
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    }
  };

  return shell(
    <>
      <ButtonBase
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        aria-label={t("models:license.details", { license: license.short })}
        sx={{
          width: 1,
          px: 2,
          py: 1,
          minHeight: 40,
          justifyContent: "flex-start",
          gap: 1,
          textAlign: "left",
          transition: "background-color 150ms",
          "&:hover": { bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.08) },
          "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
        }}
      >
        <LicenseMarks marks={license.marks} family={license.family} />
        <Typography variant="body2" fontWeight={600} noWrap sx={{ flexShrink: 0, maxWidth: "50%" }}>
          {license.short}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {summary}
        </Typography>
        <ExpandMoreIcon
          fontSize="small"
          sx={{
            color: "text.secondary",
            transition: "transform 200ms",
            transform: anchor ? "rotate(180deg)" : "none",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          }}
        />
      </ButtonBase>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { mb: 1, p: 2, width: 380, maxWidth: "calc(100vw - 32px)" } } }}
      >
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="subtitle2" fontWeight={700}>
              {license.short}
            </Typography>
            {license.name !== license.short && (
              <Typography variant="caption" color="text.secondary">
                {license.name}
              </Typography>
            )}
          </Box>
          {license.family ? (
            <Stack spacing={0.75} component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
              {deedRows(license, t).map((row) => (
                <Stack component="li" key={row.key} direction="row" spacing={1} alignItems="center">
                  <Box sx={{ color: CAN_COLOR[row.can], display: "flex" }} aria-hidden="true">
                    <CanIcon can={row.can} />
                  </Box>
                  <Typography variant="body2">
                    {row.label}
                    <Box component="span" sx={visuallyHiddenSx}>
                      {`: ${t(CAN_WORD[row.can])}`}
                    </Box>
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("models:license.unknown")}
            </Typography>
          )}
          {license.terms && (
            <Box sx={{ borderLeft: 3, borderColor: "divider", pl: 1.25, py: 0.25 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {/* Added to a standard licence by the site or its creator; a site's own licence is its terms. */}
                {license.source === "provider" && fromSite && (license.family === "cc" || license.family === "open")
                  ? t("models:license.siteAdds", { site: fromSite })
                  : t("models:license.terms")}
              </Typography>
              <Typography
                variant="body2"
                sx={{ maxHeight: 160, overflowY: "auto", whiteSpace: "pre-line", overflowWrap: "anywhere" }}
              >
                {license.terms}
              </Typography>
            </Box>
          )}
          <Divider />
          <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ color: "text.secondary", minWidth: 0 }}>
              {license.source === "provider" && hasProviderLogo(from) && <ProviderLogo id={from} size={14} />}
              <Typography variant="caption">
                {license.source === "user" || !fromSite
                  ? t("models:license.pickedByOwner")
                  : t("models:license.asListed", { site: fromSite })}
              </Typography>
              {license.url && (
                <>
                  <Typography variant="caption">·</Typography>
                  <Link
                    href={license.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="caption"
                    underline="hover"
                  >
                    {t("models:license.fullLicense")}
                    <OpenInNewIcon sx={{ fontSize: 11, ml: 0.25, verticalAlign: "-1px" }} />
                  </Link>
                </>
              )}
            </Stack>
            <Stack direction="row" spacing={0.5}>
              {onChange && (
                <Button
                  size="small"
                  startIcon={<EditOutlinedIcon fontSize="small" />}
                  onClick={() => {
                    setAnchor(null);
                    onChange();
                  }}
                >
                  {t("models:license.change")}
                </Button>
              )}
              <Button size="small" startIcon={<ContentCopyIcon fontSize="small" />} onClick={() => void copyCredit()}>
                {t("models:license.copyCredit")}
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </Popover>
    </>,
  );
}
