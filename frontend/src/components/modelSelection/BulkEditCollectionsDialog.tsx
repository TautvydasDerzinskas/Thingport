import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Skeleton from "@mui/material/Skeleton";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { type Collection, collectionsApi } from "../../api/collections";
import { useToast } from "../ToastProvider";
import HelpTip from "../HelpTip";
import NewCollectionField from "../NewCollectionField";
import MixedStateChip, { type MixedState, nextMixedState, startMixedState } from "../controls/MixedStateChip";

type Props = {
  open: boolean;
  onClose: () => void;
  printIds: string[];
  /** The collection the grid shows, if any: models taken out of it leave the grid. */
  collectionId?: string;
  onRemovedFromCollection?: (ids: string[]) => void;
  onUnauthorized?: () => void;
};

type Row = { id: string; name: string; has: number; state: MixedState; fresh?: boolean };

/** The selected models' collections, each made to hold all of them, none of them, or left as it is. */
export default function BulkEditCollectionsDialog({
  open,
  onClose,
  printIds,
  collectionId,
  onRemovedFromCollection,
  onUnauthorized,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const showToast = useToast();
  const total = printIds.length;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const failed = (err: unknown, fallback: string) => {
    if (err instanceof UnauthorizedError) {
      onUnauthorized?.();
      return;
    }
    console.error(err);
    setError(fallback);
  };

  const load = () =>
    collectionsApi
      .listForPrints(printIds)
      .then((all) =>
        setRows(
          // The ones holding any of the models first; the rest keep their newest-first order.
          all
            .map((c) => ({ id: c.id, name: c.name, has: c.count, state: startMixedState(c.count, total) }))
            .toSorted((a, b) => b.has - a.has),
        ),
      )
      .catch((err) => failed(err, t("models:detail.addToCollectionLoadFailed")));

  useEffect(() => {
    if (!open) return;
    setError(null);
    setRows(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const add = (rows ?? []).filter((row) => row.state === "all" && row.has < total);
  const remove = (rows ?? []).filter((row) => row.state === "none" && row.has > 0);
  const dirty = add.length > 0 || remove.length > 0;

  const cycle = (id: string) =>
    setRows(
      (prev) =>
        prev?.map((row) => (row.id === id ? { ...row, state: nextMixedState(row.state, row.has, total) } : row)) ??
        null,
    );

  // Already made, and picked for the models: they go in with the rest on save.
  const addCreated = (made: Collection) => {
    setRows((prev) => prev && [{ id: made.id, name: made.name, has: 0, state: "all", fresh: true }, ...prev]);
    listRef.current?.scrollTo({ top: 0 });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    let done = 0;
    try {
      for (const row of add) {
        await collectionsApi.addItems(row.id, printIds);
        done++;
      }
      for (const row of remove) {
        await collectionsApi.removeItems(row.id, printIds);
        if (row.id === collectionId) onRemovedFromCollection?.(printIds);
        done++;
      }
      showToast({ message: t("models:selection.collectionsUpdated", { count: done }) });
      onClose();
    } catch (err) {
      failed(err, t("models:selection.collectionsFailed"));
      // Some may have gone through before the failure, so show where things stand now.
      if (done) void load();
    } finally {
      setSaving(false);
    }
  };

  const summary = [
    add.length ? t("models:selection.summaryAddTo", { count: add.length }) : null,
    remove.length ? t("models:selection.summaryRemoveFrom", { count: remove.length }) : null,
  ].filter(Boolean);

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {t("models:selection.editCollectionsTitle", { count: total })}
        <HelpTip text={t("models:selection.editCollectionsHelp")} />
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        )}
        {rows === null && !error && (
          <Stack direction="row" flexWrap="wrap" gap={0.75}>
            {[72, 96, 64, 88].map((width) => (
              <Skeleton key={width} variant="rounded" width={width} height={24} sx={{ borderRadius: 3 }} />
            ))}
          </Stack>
        )}
        {rows?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("models:detail.addToCollectionEmpty")}
          </Typography>
        )}
        {rows && rows.length > 0 && (
          <Stack ref={listRef} direction="row" flexWrap="wrap" gap={0.75} sx={{ maxHeight: 280, overflowY: "auto" }}>
            {rows.map((row) => (
              <MixedStateChip
                key={row.id}
                label={row.name}
                has={row.has}
                total={total}
                state={row.state}
                fresh={row.fresh}
                disabled={saving}
                onClick={() => cycle(row.id)}
                someLabel={t("models:selection.onSome", { name: row.name, count: row.has, total })}
              />
            ))}
          </Stack>
        )}
        <NewCollectionField
          onCreated={addCreated}
          disabled={rows === null || saving}
          focused={rows?.length === 0}
          onUnauthorized={onUnauthorized}
          sx={{ mt: 2 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={saving || !dirty}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {dirty ? summary.join(" · ") : t("models:selection.apply")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
