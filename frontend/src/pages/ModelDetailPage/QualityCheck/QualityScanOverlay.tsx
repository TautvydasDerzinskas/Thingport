import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, keyframes } from "@mui/material/styles";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ViewInArRoundedIcon from "@mui/icons-material/ViewInArRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import type { PrintQuality } from "../../../api/prints";
import type { QualityOutcome } from "./useQualityCheck";

// How long the result stays up before the overlay leaves.
const LINGER_MS = 1800;

const enter = keyframes`
  from { opacity: 0; transform: translateY(12px) scale(0.96); }
  to { opacity: 1; transform: none; }
`;
const leave = keyframes`
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translateY(8px) scale(0.98); }
`;
// A band of light sweeping down the model view, as if it were being scanned.
const sweep = keyframes`
  from { transform: translateY(-100%); }
  to { transform: translateY(250%); }
`;
// The scan line inside the icon, top to bottom and back.
const iconScan = keyframes`
  0%, 100% { transform: translateY(-9px); opacity: 0.4; }
  50% { transform: translateY(9px); opacity: 1; }
`;
const pop = keyframes`
  0% { transform: scale(0.4); opacity: 0; }
  60% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(1); }
`;
const still = { "@media (prefers-reduced-motion: reduce)": { animation: "none" } } as const;

type Props = {
  quality: PrintQuality | null;
  outcome: QualityOutcome;
};

/** Sits over the model view while its printability check runs, and briefly shows the verdict. */
export default function QualityScanOverlay({ quality, outcome }: Props) {
  const { t } = useTranslation("models");
  const scanning = quality?.status === "checking";
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!outcome) return;
    const fade = setTimeout(() => setLeaving(true), LINGER_MS);
    const remove = setTimeout(() => setGone(true), LINGER_MS + 250);
    return () => {
      clearTimeout(fade);
      clearTimeout(remove);
    };
  }, [outcome]);

  if (gone || !quality || (!scanning && !outcome)) return null;

  const total = quality.files.length;
  const done = quality.files.filter((file) => file.status !== "checking" && file.status !== "unchecked").length;
  const label = scanning
    ? t("detail.quality.scanning")
    : outcome === "good"
      ? t("detail.quality.doneGood")
      : t("detail.quality.doneIssues");

  return (
    <>
      {scanning && (
        <Box aria-hidden sx={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 1 }}>
          <Box
            sx={(theme) => ({
              height: "40%",
              background: `linear-gradient(to bottom, transparent, ${alpha(theme.palette.primary.main, 0.18)} 70%, ${alpha(theme.palette.primary.main, 0.55)} 99%, transparent)`,
              animation: `${sweep} 2.2s cubic-bezier(0.45, 0, 0.55, 1) infinite`,
              "@media (prefers-reduced-motion: reduce)": { display: "none" },
            })}
          />
        </Box>
      )}
      <Paper
        elevation={6}
        component="output"
        aria-live="polite"
        sx={{
          display: "block",
          position: "absolute",
          right: 12,
          bottom: 12,
          zIndex: 2,
          width: 236,
          px: 1.5,
          py: 1.25,
          borderRadius: "12px",
          bgcolor: "rgba(0, 0, 0, 0.7)",
          backdropFilter: "blur(8px)",
          color: "#fff",
          animation: `${leaving ? leave : enter} 220ms ease-out both`,
          ...still,
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box
            sx={{ position: "relative", width: 28, height: 28, flexShrink: 0, display: "grid", placeItems: "center" }}
          >
            {scanning ? (
              <>
                <ViewInArRoundedIcon sx={{ fontSize: 26, opacity: 0.9 }} />
                <Box
                  sx={(theme) => ({
                    position: "absolute",
                    left: 1,
                    right: 1,
                    top: "50%",
                    height: 2,
                    borderRadius: 1,
                    bgcolor: theme.palette.primary.light,
                    boxShadow: `0 0 8px ${theme.palette.primary.light}`,
                    animation: `${iconScan} 1.4s ease-in-out infinite`,
                    ...still,
                  })}
                />
              </>
            ) : outcome === "good" ? (
              <CheckCircleRoundedIcon
                sx={{ fontSize: 26, color: "success.light", animation: `${pop} 320ms ease-out both`, ...still }}
              />
            ) : (
              <WarningAmberRoundedIcon
                sx={{ fontSize: 26, color: "warning.light", animation: `${pop} 320ms ease-out both`, ...still }}
              />
            )}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {label}
            </Typography>
            {scanning && total > 1 && (
              <Typography variant="caption" sx={{ opacity: 0.75 }}>
                {t("detail.quality.scanningFiles", { done, total })}
              </Typography>
            )}
          </Box>
        </Stack>
        {scanning && (
          <LinearProgress
            variant={total > 1 ? "determinate" : "indeterminate"}
            value={total > 1 ? (done / total) * 100 : undefined}
            aria-label={label}
            sx={{ mt: 1, height: 3, borderRadius: 2, bgcolor: "rgba(255, 255, 255, 0.15)" }}
          />
        )}
      </Paper>
    </>
  );
}
