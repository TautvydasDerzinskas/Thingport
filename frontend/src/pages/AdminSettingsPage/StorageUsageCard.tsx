import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import CleaningServicesOutlinedIcon from "@mui/icons-material/CleaningServicesOutlined";
import type { StorageUsage } from "../../api/admin";
import HelpTip from "../../components/HelpTip";
import SegmentedBar, { segmentFill, type BarSegment } from "../../components/charts/SegmentedBar";
import { formatFileSize } from "../../utils/fileSize";

type Props = {
  /** undefined while it's measured, null when it couldn't be. */
  usage: StorageUsage | null | undefined;
  /** A clean-up is running: the button follows it instead of starting one. */
  freeing: boolean;
  onFreeUp: () => void;
};

const KINDS = ["models", "previews", "old", "photos", "thumbnails", "description", "slicer", "other"] as const;
type ShownKind = (typeof KINDS)[number];

/** The disk Thingport's storage takes, split by what it's for, and the way to free some of it. */
export default function StorageUsageCard({ usage, freeing, onFreeUp }: Props) {
  const { t } = useTranslation("app");
  const theme = useTheme();
  const { series, other } = theme.thingport.chart;

  const valueOf = (kind: ShownKind): number => {
    if (!usage) return 0;
    const parts = usage.breakdown;
    if (kind === "models") return usage.model_bytes;
    // Too small to tell apart on a bar, and nothing to act on.
    if (kind === "other") return parts.other + parts.tag_pictures + parts.bundles;
    return parts[kind];
  };
  // The old previews share their colour with the current ones, striped: older versions of the same thing.
  const colorOf: Record<ShownKind, string> = {
    models: series[0],
    previews: series[1],
    old: series[1],
    photos: series[2],
    thumbnails: series[3],
    description: series[4],
    slicer: series[5],
    other,
  };
  const segments: BarSegment[] = KINDS.map((kind) => ({
    key: kind,
    label: t(`adminSettings.storageUsage.kinds.${kind}`),
    value: valueOf(kind),
    valueLabel: formatFileSize(valueOf(kind)),
    color: colorOf[kind],
    hatched: kind === "old",
  }));

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" alignItems="center" spacing={2}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {usage === undefined ? (
            <Skeleton width={220} />
          ) : usage === null ? (
            <Typography variant="body2" color="text.secondary">
              {t("adminSettings.storageUsage.failed")}
            </Typography>
          ) : (
            <Typography component="div" sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1 }}>
              <Typography component="span" variant="subtitle1" fontWeight={600}>
                {t("adminSettings.storageUsage.onDisk", { total: formatFileSize(usage.total_bytes) })}
              </Typography>
              <Typography component="span" variant="body2" color="text.secondary">
                {t("adminSettings.storageUsage.modelCount", { count: usage.model_count })}
              </Typography>
              <HelpTip text={t("adminSettings.storageUsage.breakdownHint")} />
            </Typography>
          )}
        </Box>
        <Button
          variant="outlined"
          startIcon={freeing ? <CircularProgress size={16} color="inherit" /> : <CleaningServicesOutlinedIcon />}
          onClick={onFreeUp}
          disabled={!usage && !freeing}
          sx={{ flexShrink: 0 }}
        >
          {t(freeing ? "adminSettings.freeSpace.freeing" : "adminSettings.freeSpace.open")}
        </Button>
      </Stack>

      {usage === undefined && <Skeleton variant="rounded" height={24} />}
      {usage && <SegmentedBar segments={segments} label={t("adminSettings.storageUsage.chartLabel")} />}
      {usage && (
        <Box
          component="ul"
          sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexWrap: "wrap", columnGap: 2.5, rowGap: 0.75 }}
        >
          {segments
            .filter((segment) => segment.value > 0)
            .map((segment) => (
              <Stack key={segment.key} component="li" direction="row" spacing={0.75} alignItems="center">
                <Box
                  sx={{ width: 10, height: 10, borderRadius: "3px", background: segmentFill(segment), flexShrink: 0 }}
                />
                <Typography variant="body2">{segment.label}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {segment.valueLabel}
                </Typography>
              </Stack>
            ))}
        </Box>
      )}
    </Stack>
  );
}
