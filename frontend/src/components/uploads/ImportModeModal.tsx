import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ButtonBase from "@mui/material/ButtonBase";
import Alert from "@mui/material/Alert";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";

export type ImportMode = "separate" | "multiplate";

type ImportModePromptConfig = {
  label: string;
  count: number;
  /** "folders": an uploaded folder tree, where the choice is per folder rather than for the whole set. */
  variant?: "files" | "folders";
  onChoose: (mode: ImportMode) => Promise<void>;
};

type ImportModePromptState = {
  config: ImportModePromptConfig;
};

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

/**
 * For a flat multi-file selection: import each file as its own print, or all as plates of one.
 * For a folder tree: each file as its own print, or each folder of model files as one print.
 */
export function useImportModePrompt() {
  const { t } = useTranslation("app");
  const [state, setState] = useState<ImportModePromptState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveRef = useRef<(() => void) | null>(null);

  const close = () => {
    setState(null);
    setBusy(false);
    setError(null);
    if (resolveRef.current) {
      resolveRef.current();
      resolveRef.current = null;
    }
  };

  const prompt = (config: ImportModePromptConfig) => {
    // Not `state`: a prompt that waited its turn is from an older render.
    if (resolveRef.current) {
      return Promise.resolve();
    }
    setBusy(false);
    setError(null);
    setState({ config });
    return new Promise<void>((resolve) => {
      resolveRef.current = resolve;
    });
  };

  const choose = async (mode: ImportMode) => {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      await state.config.onChoose(mode);
      close();
    } catch (err) {
      setError(errorMessage(err, t("importMode.importError")));
      setBusy(false);
    }
  };

  const modal = state ? (
    <ImportModeModal
      label={state.config.label}
      count={state.config.count}
      variant={state.config.variant ?? "files"}
      busy={busy}
      error={error}
      onChoose={choose}
      onClose={close}
    />
  ) : null;

  return { prompt, modal, isOpen: Boolean(state) };
}

function ImportModeModal({
  label,
  count,
  variant,
  busy,
  error,
  onChoose,
  onClose,
}: {
  label: string;
  count: number;
  variant: "files" | "folders";
  busy: boolean;
  error: string | null;
  onChoose: (mode: ImportMode) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("app");
  const text = variant === "folders" ? "importMode.folders" : "importMode";
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
        <Box>
          <Typography variant="h6" component="div">
            {t(`${text}.title`, { count })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} disabled={busy} aria-label={t("importMode.close") ?? undefined}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2">{t(`${text}.prompt`)}</Typography>
          <Stack spacing={1.5}>
            <ButtonBase
              onClick={() => onChoose("separate")}
              disabled={busy}
              sx={{
                textAlign: "left",
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "background.paper",
                p: 1.5,
                display: "block",
                "&:hover": { boxShadow: 1 },
              }}
            >
              <Typography variant="subtitle2">{t(`${text}.separateTitle`)}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t(`${text}.separateDesc`)}
              </Typography>
            </ButtonBase>
            <ButtonBase
              onClick={() => onChoose("multiplate")}
              disabled={busy}
              sx={{
                textAlign: "left",
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "background.paper",
                p: 1.5,
                display: "block",
                "&:hover": { boxShadow: 1 },
              }}
            >
              <Typography variant="subtitle2">{t(`${text}.multiplateTitle`)}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t(`${text}.multiplateDesc`)}
              </Typography>
            </ButtonBase>
          </Stack>
          {busy && (
            <Typography variant="body2" color="text.secondary">
              {t("importMode.importing")}
            </Typography>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
