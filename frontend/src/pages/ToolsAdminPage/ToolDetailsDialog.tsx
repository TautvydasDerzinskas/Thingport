import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DownloadIcon from "@mui/icons-material/Download";
import LaunchIcon from "@mui/icons-material/Launch";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import { printsApi } from "../../api/prints";
import type { AdminTool } from "../../api/tools";
import Screenshots from "../../components/Screenshots";
import ToolIcon from "../../components/tools/ToolIcon";

type Props = {
  tool: AdminTool | null;
  busy: boolean;
  onClose: () => void;
  onInstall: () => void;
  onImportModels: () => void;
  onRetry: () => void;
  onUninstall: () => void;
  /** Opens the admin's own copy; absent where the tool isn't installed or isn't theirs to open. */
  onOpen?: () => void;
};

/** What a tool is, what came with it and what can be done to it: the tile's double-click. */
export default function ToolDetailsDialog({
  tool,
  busy,
  onClose,
  onInstall,
  onImportModels,
  onRetry,
  onUninstall,
  onOpen,
}: Props) {
  const { t } = useTranslation("app");
  if (!tool) return null;
  const { manifest, installed } = tool;
  const models = installed?.models ?? null;
  const missing = models ? models.total - models.ready : 0;
  const brings = manifest.collection?.models.length ?? 0;

  const status = !installed
    ? { label: t("adminSettings.tools.repo.notInstalled"), color: "default" as const }
    : !tool.inRepo
      ? { label: t("adminSettings.tools.repo.gone"), color: "warning" as const }
      : installed.updateAvailable
        ? {
            label:
              installed.version === manifest.version
                ? t("adminSettings.tools.repo.updateAvailable")
                : t("adminSettings.tools.repo.updateTo", { version: manifest.version }),
            color: "info" as const,
          }
        : {
            label: t("adminSettings.tools.repo.installedVersion", { version: installed.version }),
            color: "success" as const,
          };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box
            sx={{
              width: 44,
              height: 44,
              flexShrink: 0,
              borderRadius: "12px",
              border: 1,
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "primary.main",
            }}
          >
            <ToolIcon iconUrl={manifest.iconUrl} size={26} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontSize: "1.05rem", lineHeight: 1.3 }}>
              {manifest.name}
            </Typography>
            <Chip size="small" variant="outlined" color={status.color} label={status.label} sx={{ mt: 0.5 }} />
          </Box>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={1.5}>
          {manifest.description && <Typography variant="body2">{manifest.description}</Typography>}
          <Typography variant="caption" color="text.secondary">
            {[
              manifest.author && t("adminSettings.tools.repo.by", { name: manifest.author }),
              brings > 0 && t("adminSettings.tools.repo.brings", { count: brings }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </Typography>

          <Screenshots
            name={manifest.name}
            screenshots={manifest.screenshots ?? []}
            urlFor={(shot) => printsApi.fileUrl(`/admin/tools/${encodeURIComponent(tool.slug)}/screenshots/${shot}`)}
          />

          {models && !models.imported && (
            // Installed without them: the tool runs, but what it needs them for waits until they are here.
            <Stack spacing={0.75}>
              <Typography variant="body2" color="warning.main">
                {t("adminSettings.tools.repo.modelsSkipped", { count: models.total })}
              </Typography>
              <Box>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <DownloadIcon fontSize="small" />}
                  disabled={busy}
                  onClick={onImportModels}
                >
                  {t("adminSettings.tools.repo.importModels")}
                </Button>
              </Box>
            </Stack>
          )}

          {models && models.imported && (missing > 0 || models.fetching) && (
            <Box aria-live="polite">
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  {models.fetching
                    ? t("adminSettings.tools.repo.fetching", { ready: models.ready, total: models.total })
                    : t("adminSettings.tools.repo.missing", { count: missing, total: models.total })}
                </Typography>
                {!models.fetching && (
                  <Button size="small" startIcon={<DownloadIcon fontSize="small" />} onClick={onRetry}>
                    {t("adminSettings.tools.repo.retry")}
                  </Button>
                )}
              </Stack>
              <LinearProgress
                variant="determinate"
                value={models.total ? (models.ready / models.total) * 100 : 0}
                sx={{ mt: 0.5, borderRadius: 1, height: 6 }}
              />
              {!models.fetching && models.failed.length > 0 && (
                <Typography variant="caption" color="error" component="div" sx={{ mt: 0.5 }}>
                  {t("adminSettings.tools.repo.lastError", { error: models.failed[0].reason })}
                </Typography>
              )}
            </Box>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1.5, gap: 1 }}>
        {installed && (
          <Button
            size="small"
            color="error"
            startIcon={<DeleteOutlineIcon fontSize="small" />}
            disabled={busy}
            onClick={onUninstall}
            sx={{ mr: "auto" }}
          >
            {t("adminSettings.tools.repo.uninstall")}
          </Button>
        )}
        {onOpen && (
          <Button size="small" startIcon={<LaunchIcon fontSize="small" />} onClick={onOpen}>
            {t("adminSettings.tools.repo.open")}
          </Button>
        )}
        <Button size="small" onClick={onClose}>
          {t("common:close")}
        </Button>
        {(!installed || (installed.updateAvailable && tool.inRepo)) && (
          <Button
            size="small"
            variant="contained"
            startIcon={
              busy ? (
                <CircularProgress size={14} color="inherit" />
              ) : installed ? (
                <SystemUpdateAltIcon fontSize="small" />
              ) : (
                <DownloadIcon fontSize="small" />
              )
            }
            disabled={busy || !tool.inRepo}
            onClick={onInstall}
          >
            {installed ? t("adminSettings.tools.repo.update") : t("adminSettings.tools.repo.install")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
