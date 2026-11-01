import React, { useRef, useState } from "react";
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
import type { ImportCollectionEntry } from "../../../api/imports";
import CollectionEntryList from "./CollectionEntryList";

export type CollectionPromptConfig = {
  label: string;
  loadEntries: () => Promise<{
    title: string | null;
    total: number;
    truncated: boolean;
    entries: ImportCollectionEntry[];
  }>;
  onImportSelected: (designIds: string[]) => Promise<void>;
};

type CollectionPromptState = {
  config: CollectionPromptConfig;
};

type PromptStage = "loading" | "select" | "error";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

export function useCollectionImportPrompt() {
  const { t } = useTranslation("app");
  const [state, setState] = useState<CollectionPromptState | null>(null);
  const [stage, setStage] = useState<PromptStage>("loading");
  const [collectionTitle, setCollectionTitle] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [entries, setEntries] = useState<ImportCollectionEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveRef = useRef<(() => void) | null>(null);

  const reset = () => {
    setStage("loading");
    setCollectionTitle(null);
    setTotal(0);
    setTruncated(false);
    setEntries([]);
    setSelected(new Set());
    setBusy(false);
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

  const load = async (config: CollectionPromptConfig) => {
    try {
      const result = await config.loadEntries();
      setCollectionTitle(result.title);
      setTotal(result.total);
      setTruncated(result.truncated);
      setEntries(result.entries);
      setSelected(new Set(result.entries.filter((entry) => !entry.already_imported).map((entry) => entry.design_id)));
      setStage("select");
    } catch (err) {
      setError(errorMessage(err, t("collectionImport.loadError")));
      setStage("error");
    }
  };

  const prompt = (config: CollectionPromptConfig) => {
    // Not `state`: a prompt that waited its turn is from an older render.
    if (resolveRef.current) {
      return Promise.resolve();
    }
    reset();
    setState({ config });
    void load(config);
    return new Promise<void>((resolve) => {
      resolveRef.current = resolve;
    });
  };

  const importSelected = async () => {
    if (!state) return;
    const selectedIds = Array.from(selected);
    if (!selectedIds.length) {
      setError(t("collectionImport.selectAtLeastOne"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await state.config.onImportSelected(selectedIds);
      close();
    } catch (err) {
      setError(errorMessage(err, t("collectionImport.importError")));
      setBusy(false);
    }
  };

  const toggleEntry = (designId: string) => {
    const entry = entries.find((e) => e.design_id === designId);
    if (entry?.already_imported) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(designId)) next.delete(designId);
      else next.add(designId);
      return next;
    });
  };

  const selectableEntries = entries.filter((entry) => !entry.already_imported);

  const selectAll = () => {
    setSelected(new Set(selectableEntries.map((entry) => entry.design_id)));
  };

  const clearAll = () => {
    setSelected(new Set());
  };

  const selectedCount = selected.size;
  const allSelected = selectableEntries.length > 0 && selectedCount === selectableEntries.length;

  const modal = state ? (
    <CollectionImportModalView
      label={state.config.label}
      stage={stage}
      collectionTitle={collectionTitle}
      total={total}
      truncated={truncated}
      entries={entries}
      selected={selected}
      selectedCount={selectedCount}
      allSelected={allSelected}
      busy={busy}
      error={error}
      onClose={close}
      onImportSelected={importSelected}
      onToggleEntry={toggleEntry}
      onSelectAll={selectAll}
      onClearAll={clearAll}
    />
  ) : null;

  return { prompt, modal, isOpen: Boolean(state) };
}

export function CollectionImportModalView({
  label,
  stage,
  collectionTitle,
  total,
  truncated,
  entries,
  selected,
  selectedCount,
  allSelected,
  busy,
  error,
  onClose,
  onImportSelected,
  onToggleEntry,
  onSelectAll,
  onClearAll,
}: {
  label: string;
  stage: PromptStage;
  collectionTitle: string | null;
  total: number;
  truncated: boolean;
  entries: ImportCollectionEntry[];
  selected: Set<string>;
  selectedCount: number;
  allSelected: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onImportSelected: () => void;
  onToggleEntry: (designId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const { t } = useTranslation("app");

  const dismiss = (_event: unknown, reason: "backdropClick" | "escapeKeyDown") => {
    // The double click that sent the link can land its second half out here, as this comes up over the import dialog.
    if (reason === "backdropClick" && stage === "loading") return;
    onClose();
  };

  return (
    <Dialog open onClose={busy ? undefined : dismiss} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
        <Box>
          <Typography variant="h6" component="div">
            {collectionTitle || t("collectionImport.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
        </Box>
        <IconButton
          size="small"
          onClick={onClose}
          disabled={busy}
          aria-label={t("collectionImport.close") ?? undefined}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {stage === "loading" && (
            <Stack alignItems="center" spacing={1.5} sx={{ py: 4 }}>
              <CircularProgress size={28} />
              <Typography variant="body2" color="text.secondary">
                {t("collectionImport.loading")}
              </Typography>
            </Stack>
          )}

          {stage === "select" && (
            <Stack spacing={1.5}>
              {truncated && (
                <Alert severity="info">
                  {t("collectionImport.truncatedNotice", { loaded: entries.length, total })}
                </Alert>
              )}
              <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                <Typography variant="body2" color="text.secondary">
                  {t("collectionImport.selectedCount", { selected: selectedCount, total: entries.length })}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" variant="outlined" onClick={onSelectAll} disabled={busy || allSelected}>
                    {t("collectionImport.selectAll")}
                  </Button>
                  <Button size="small" variant="outlined" onClick={onClearAll} disabled={busy || selectedCount === 0}>
                    {t("collectionImport.clear")}
                  </Button>
                </Stack>
              </Stack>

              <CollectionEntryList
                entries={entries}
                selected={selected}
                busy={busy}
                noEntriesLabel={t("collectionImport.noEntries")}
                onToggleEntry={onToggleEntry}
              />

              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <Button
                  variant="contained"
                  onClick={onImportSelected}
                  disabled={busy || selectedCount === 0}
                  startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                  {busy ? t("collectionImport.importing") : t("collectionImport.importSelected")}
                </Button>
                <Button variant="outlined" onClick={onClose} disabled={busy}>
                  {t("collectionImport.cancel")}
                </Button>
              </Stack>
            </Stack>
          )}

          {stage === "error" && (
            <Stack spacing={1.5}>
              <Alert severity="error">{error}</Alert>
              <Button variant="outlined" onClick={onClose} sx={{ alignSelf: "flex-start" }}>
                {t("collectionImport.close")}
              </Button>
            </Stack>
          )}

          {stage === "select" && error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
