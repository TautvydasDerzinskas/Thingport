import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { keyframes } from "@mui/material/styles";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { categoriesApi, resetIsNoop, type CategoryResetPreview } from "../../api/categories";
import { UnauthorizedError } from "../../api/client";
import { ListRowSkeletons } from "../../components/ListSkeleton";
import { SectionLabel } from "../../components/Layout/ConfigurationDialog/parts";

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
`;

type Props = {
  open: boolean;
  onClose: () => void;
  /** Resets; reports its own failure, then rejects to keep the dialog open. */
  onConfirm: () => Promise<void>;
  onUnauthorized?: () => void;
};

type Tone = "success" | "warning" | "error";

function Stat({ count, label, tone }: { count: number; label: string; tone?: Tone }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        px: 1.5,
        py: 1,
        borderRadius: 1,
        border: 1,
        borderColor: "divider",
        opacity: count ? 1 : 0.55,
      }}
    >
      <Typography variant="h6" sx={{ lineHeight: 1.2, color: count && tone ? `${tone}.main` : "text.primary" }}>
        {count}
      </Typography>
      <Typography variant="caption" color="text.secondary" noWrap component="div">
        {label}
      </Typography>
    </Box>
  );
}

/** A category path with its ancestors dimmed, so the category itself stands out. */
function PathRow({ path, trailing }: { path: string[]; trailing?: ReactNode }) {
  const name = path[path.length - 1];
  const parents = path.slice(0, -1);
  return (
    <Stack direction="row" alignItems="baseline" spacing={1} sx={{ px: 1.25, py: 0.5 }}>
      <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }} title={path.join(" › ")}>
        {parents.length > 0 && (
          <Box component="span" sx={{ color: "text.secondary" }}>
            {parents.join(" › ")} ›{" "}
          </Box>
        )}
        {name}
      </Typography>
      {trailing}
    </Stack>
  );
}

function PathList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <SectionLabel>{label}</SectionLabel>
      <Box
        sx={{
          maxHeight: 168,
          overflowY: "auto",
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          py: 0.5,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

/** Shows what a reset to the starter categories would add, restore and delete, and what happens to the models, before
 *  it's run. */
export default function CategoryResetDialog({ open, onClose, onConfirm, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const [preview, setPreview] = useState<CategoryResetPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  // Fetched on every open: models may have moved since the dialog was last shown.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setPreview(null);
    setError(null);
    categoriesApi
      .previewReset()
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setError(t("models:categories.reset.previewFailed"));
      });
    return () => {
      active = false;
    };
  }, [open, onUnauthorized, t]);

  const confirm = async () => {
    setResetting(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // onConfirm has reported it; staying open keeps the preview for a retry.
    } finally {
      setResetting(false);
    }
  };

  const noop = preview !== null && resetIsNoop(preview);
  const lostModels = preview?.models_uncategorized ?? 0;

  return (
    <Dialog open={open} onClose={() => !resetting && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{t("models:categories.reset.title")}</DialogTitle>
      <DialogContent>
        {!preview && !error && <ListRowSkeletons count={4} lead={null} trailing />}
        {error && <Alert severity="error">{error}</Alert>}
        {preview && (
          <Stack
            spacing={2}
            sx={{
              animation: `${fadeIn} 200ms ease-out`,
              "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            }}
          >
            {noop ? (
              <Alert severity="success">{t("models:categories.reset.noop")}</Alert>
            ) : (
              <>
                <Stack direction="row" spacing={1}>
                  <Stat count={preview.added.length} label={t("models:categories.reset.added")} tone="success" />
                  <Stat count={preview.restored.length} label={t("models:categories.reset.restored")} tone="warning" />
                  <Stat count={preview.removed.length} label={t("models:categories.reset.removed")} tone="error" />
                </Stack>

                {(lostModels > 0 || preview.models_moved > 0 || preview.models_renamed > 0) && (
                  <Stack spacing={0.75}>
                    {lostModels > 0 && (
                      <Alert severity="warning" sx={{ py: 0 }}>
                        {t("models:categories.reset.modelsUncategorized", { count: lostModels })}
                      </Alert>
                    )}
                    {preview.models_moved > 0 && (
                      <Alert severity="info" sx={{ py: 0 }}>
                        {t("models:categories.reset.modelsMoved", { count: preview.models_moved })}
                      </Alert>
                    )}
                    {preview.models_renamed > 0 && (
                      <Alert severity="info" sx={{ py: 0 }}>
                        {t("models:categories.reset.modelsRenamed", { count: preview.models_renamed })}
                      </Alert>
                    )}
                  </Stack>
                )}

                {preview.removed.length > 0 && (
                  <PathList label={t("models:categories.reset.removed")}>
                    {preview.removed.map((r) => (
                      <PathRow
                        key={r.path.join("\u0000")}
                        path={r.path}
                        trailing={
                          r.models > 0 && (
                            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                              {t("models:categories.reset.modelCount", { count: r.models })}
                            </Typography>
                          )
                        }
                      />
                    ))}
                  </PathList>
                )}
                {preview.added.length > 0 && (
                  <PathList label={t("models:categories.reset.added")}>
                    {preview.added.map((path) => (
                      <PathRow key={path.join("\u0000")} path={path} />
                    ))}
                  </PathList>
                )}
                {preview.restored.length > 0 && (
                  <PathList label={t("models:categories.reset.restored")}>
                    {preview.restored.map((path) => (
                      <PathRow key={path.join("\u0000")} path={path} />
                    ))}
                  </PathList>
                )}
                <Typography variant="caption" color="text.secondary">
                  {t("models:categories.reset.foldersKept")}
                </Typography>
              </>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={resetting}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={() => void confirm()}
          disabled={!preview || noop || resetting}
          startIcon={resetting ? <CircularProgress size={14} color="inherit" /> : <RestartAltIcon fontSize="small" />}
        >
          {t("models:categories.manager.reset")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
