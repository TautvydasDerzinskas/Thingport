import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import { startingSelection, type ZipEntry } from "../../../utils/zipUtils";
import ZipEntryList from "./ZipEntryList";

export type ZipPromptConfig = {
  label: string;
  onImportAsZip: () => Promise<void>;
  loadEntries: () => Promise<ZipEntry[]>;
  onImportSelected: (entries: string[]) => Promise<void>;
};

type ZipPromptState = {
  config: ZipPromptConfig;
};

type PromptStage = "choice" | "select";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

export function useZipImportPrompt() {
  const { t } = useTranslation("app");
  const [state, setState] = useState<ZipPromptState | null>(null);
  const [stage, setStage] = useState<PromptStage>("choice");
  const [entries, setEntries] = useState<ZipEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Reading a link's zip can take seconds, with nothing else on screen to say so.
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveRef = useRef<(() => void) | null>(null);

  const reset = () => {
    setStage("choice");
    setEntries([]);
    setSelected(new Set());
    setBusy(false);
    setReading(false);
    setError(null);
  };

  const close = () => {
    setState(null);
    reset();
    if (resolveRef.current) {
      resolveRef.current();
      resolveRef.current = null;
    }
  };

  const prompt = (config: ZipPromptConfig) => {
    // Not `state`: a prompt that waited its turn is from an older render.
    if (resolveRef.current) {
      return Promise.resolve();
    }
    reset();
    setState({ config });
    return new Promise<void>((resolve) => {
      resolveRef.current = resolve;
    });
  };

  const loadEntries = async () => {
    if (!state) return;
    setBusy(true);
    setReading(true);
    setError(null);
    try {
      const list = await state.config.loadEntries();
      setEntries(list);
      setSelected(startingSelection(list));
      setStage("select");
    } catch (err) {
      setError(errorMessage(err, t("zipImport.readError")));
    } finally {
      setBusy(false);
      setReading(false);
    }
  };

  const importAsZip = async () => {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      await state.config.onImportAsZip();
      close();
    } catch (err) {
      setError(errorMessage(err, t("zipImport.importError")));
      setBusy(false);
    }
  };

  const importSelected = async () => {
    if (!state) return;
    const selectedEntries = Array.from(selected);
    if (!selectedEntries.length) {
      setError(t("zipImport.selectAtLeastOne"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await state.config.onImportSelected(selectedEntries);
      close();
    } catch (err) {
      setError(errorMessage(err, t("zipImport.importError")));
      setBusy(false);
    }
  };

  const toggleEntry = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(entries.map((entry) => entry.path)));
  };

  const clearAll = () => {
    setSelected(new Set());
  };

  const selectedCount = selected.size;
  const allSelected = entries.length > 0 && selectedCount === entries.length;

  const modal = state ? (
    <ZipImportModal
      label={state.config.label}
      stage={stage}
      entries={entries}
      selected={selected}
      selectedCount={selectedCount}
      allSelected={allSelected}
      busy={busy}
      reading={reading}
      error={error}
      onClose={close}
      onImportAsZip={importAsZip}
      onLoadEntries={loadEntries}
      onImportSelected={importSelected}
      onToggleEntry={toggleEntry}
      onSelectAll={selectAll}
      onClearAll={clearAll}
    />
  ) : null;

  return { prompt, modal, isOpen: Boolean(state) };
}

export function ZipImportModal({
  label,
  stage,
  entries,
  selected,
  selectedCount,
  allSelected,
  busy,
  reading,
  error,
  onClose,
  onImportAsZip,
  onLoadEntries,
  onImportSelected,
  onToggleEntry,
  onSelectAll,
  onClearAll,
}: {
  label: string;
  stage: PromptStage;
  entries: ZipEntry[];
  selected: Set<string>;
  selectedCount: number;
  allSelected: boolean;
  busy: boolean;
  reading: boolean;
  error: string | null;
  onClose: () => void;
  onImportAsZip: () => void;
  onLoadEntries: () => void;
  onImportSelected: () => void;
  onToggleEntry: (path: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const { t } = useTranslation("app");
  const entryCount = entries.length;
  const title = useMemo(
    () => (stage === "choice" ? t("zipImport.title") : t("zipImport.chooseFilesTitle")),
    [stage, t],
  );

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
        <Box>
          <Typography variant="h6" component="div">
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} disabled={busy} aria-label={t("zipImport.close") ?? undefined}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {stage === "choice" && (
            <Stack spacing={2}>
              <Typography variant="body2">{t("zipImport.prompt")}</Typography>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <Button variant="contained" onClick={onImportAsZip} disabled={busy}>
                  {t("zipImport.importAsZip")}
                </Button>
                <Button
                  variant="outlined"
                  onClick={onLoadEntries}
                  disabled={busy}
                  aria-busy={reading}
                  startIcon={reading ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                  {t(reading ? "zipImport.reading" : "zipImport.importAndUnzip")}
                </Button>
              </Stack>
            </Stack>
          )}

          {stage === "select" && (
            <Stack spacing={1.5}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                <Typography variant="body2" color="text.secondary">
                  {t("zipImport.selectedCount", { selected: selectedCount, total: entryCount })}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" variant="outlined" onClick={onSelectAll} disabled={busy || allSelected}>
                    {t("zipImport.selectAll")}
                  </Button>
                  <Button size="small" variant="outlined" onClick={onClearAll} disabled={busy || selectedCount === 0}>
                    {t("zipImport.clear")}
                  </Button>
                </Stack>
              </Stack>

              <ZipEntryList
                entries={entries}
                selected={selected}
                busy={busy}
                noFilesLabel={t("zipImport.noFiles")}
                onToggleEntry={onToggleEntry}
              />

              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <Button variant="contained" onClick={onImportSelected} disabled={busy || selectedCount === 0}>
                  {t("zipImport.importSelected")}
                </Button>
                <Button variant="outlined" onClick={onClose} disabled={busy}>
                  {t("zipImport.cancel")}
                </Button>
              </Stack>
            </Stack>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
