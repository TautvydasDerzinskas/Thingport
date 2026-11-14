import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { printsApi, type FillGapsResult, type Print, type SourceGap } from "../../api/prints";
import { importProviderInfo } from "../../constants/importProviders";
import { useToast } from "../../components/ToastProvider";

type Props = {
  open: boolean;
  print: Print;
  gaps: SourceGap[];
  onClose: () => void;
  onUpdated: (print: Print) => void;
  onUnauthorized?: () => void;
};

/** "Fetch missing details": fills the model's empty fields and images from its source. Only
 *  offered while there's a gap, and never touches anything the user filled in. */
export default function FillGapsDialog({ open, print, gaps, onClose, onUpdated, onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["models", "common"]);
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const providerLabel = importProviderInfo(print.source_provider)?.label ?? t("models:detail.fillGapsSource");
  // "Title, description", or 标题、描述: listed in the reader's language, with no "and".
  const listOf = (list: SourceGap[]) =>
    new Intl.ListFormat(i18n.language, { type: "conjunction", style: "narrow" }).format(
      list.map((gap) => t(`models:detail.gap.${gap}`)),
    );

  const summaryOf = (result: FillGapsResult): string => {
    const remaining = result.remaining.length
      ? t("models:detail.fillGapsRemaining", { remaining: listOf(result.remaining) })
      : "";
    if (!result.filled.length) return t("models:detail.fillGapsNothing");
    return [t("models:detail.fillGapsDone", { filled: listOf(result.filled) }), remaining].filter(Boolean).join(" ");
  };

  const submit = async () => {
    setBusy(true);
    try {
      const result = await printsApi.fillGaps(print.id);
      onUpdated(await printsApi.get(print.id));
      showToast({ message: summaryOf(result) });
      onClose();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      showToast({ message: err instanceof Error ? err.message : t("models:detail.fillGapsFailed") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t("models:detail.fillGapsTitle", { provider: providerLabel })}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t("models:detail.fillGapsHint", { provider: providerLabel })}
        </Typography>
        <Typography variant="body2" sx={{ "&::first-letter": { textTransform: "uppercase" } }}>
          {listOf(gaps)}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={busy}
          startIcon={busy ? <CircularProgress size={14} /> : undefined}
        >
          {t("models:detail.fillGapsSubmit")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
