import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import DownloadIcon from "@mui/icons-material/Download";
import { UnauthorizedError } from "../api/client";
import { type DownloadZipFilter, printsApi } from "../api/prints";
import { formatFileSize } from "../utils/fileSize";
import { saveResponseToDisk } from "../utils/downloadResponse";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Which prints this covers -- see DownloadZipFilter. Combined with `filename` this is sent
   *  as-is to both POST /download/zip/summary (on open) and POST /download/zip (on confirm). */
  filter: DownloadZipFilter;
  filename: string;
  /** Dialog title -- callers phrase this themselves (e.g. "Download collection as zip", or
   *  "Download tag \"foo\" as zip") since only they know which context this is. */
  title: string;
  onUnauthorized?: () => void;
};

/** The "are you sure?" step shown before any group zip download (a whole collection, or every
 *  model carrying a tag) -- shows how many models are included and an approximate combined file
 *  size *before* committing to building the zip, fetched via POST /download/zip/summary (model
 *  count + a sum of stored Plate/PrintFile sizes -- an upper bound on the real zip, since DEFLATE
 *  only ever shrinks, but cheap enough to compute without generating anything). If a future
 *  filter type can't size itself this cheaply, `size_bytes` can come back as 0/omitted and this
 *  just shows the model count alone -- see the summary rendering below. */
export default function DownloadZipConfirmDialog({ open, onClose, filter, filename, title, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState<number | null>(null);
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setSummaryError(null);
    setCount(null);
    setSizeBytes(null);
    setDownloadError(null);
    (async () => {
      try {
        const summary = await printsApi.downloadZipSummary(filter);
        if (cancelled) return;
        setCount(summary.count);
        setSizeBytes(summary.size_bytes || null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          onUnauthorized?.();
          return;
        }
        setSummaryError(t("models:downloadZip.summaryFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // filter/filename are provided fresh by the caller on every open (a new object literal each
    // render), so keying only on `open` avoids re-fetching the summary on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await printsApi.downloadZip({ ...filter, filename });
      await saveResponseToDisk(res, filename);
      onClose();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      setDownloadError(err instanceof Error ? err.message : t("models:downloadZip.failed"));
    } finally {
      setDownloading(false);
    }
  };

  const busy = loading || downloading;
  const empty = count === 0;

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          {loading && (
            <Stack direction="row" alignItems="center" spacing={1} sx={{ color: "text.secondary" }}>
              <CircularProgress size={16} />
              <Typography variant="body2">{t("models:downloadZip.loading")}</Typography>
            </Stack>
          )}
          {!loading && summaryError && <Alert severity="error">{summaryError}</Alert>}
          {!loading && !summaryError && empty && <Alert severity="info">{t("models:downloadZip.empty")}</Alert>}
          {!loading && !summaryError && !empty && count !== null && (
            <Typography variant="body2">
              {sizeBytes
                ? t("models:downloadZip.summary", { count, size: formatFileSize(sizeBytes) })
                : t("models:downloadZip.summaryNoSize", { count })}
            </Typography>
          )}
          {downloadError && <Alert severity="error">{downloadError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t("common:cancel")}</Button>
        <Button
          variant="contained"
          onClick={handleDownload}
          disabled={busy || empty || Boolean(summaryError)}
          startIcon={downloading ? <CircularProgress size={14} color="inherit" /> : <DownloadIcon fontSize="small" />}
        >
          {downloading ? t("models:downloadZip.downloading") : t("common:download")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
