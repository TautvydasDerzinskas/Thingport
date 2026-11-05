import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";
import { UnauthorizedError } from "../../api/client";
import { type Collection, collectionsApi, type CollectionMembership } from "../../api/collections";
import NewCollectionField from "../../components/NewCollectionField";
import { freshChipSx } from "../../components/controls/MixedStateChip";

type Props = {
  open: boolean;
  onClose: () => void;
  printId: string;
  onUnauthorized?: () => void;
  /** Toggling this collection off also fires onRemovedFromCollection so the card leaves the grid. */
  collectionId?: string;
  onRemovedFromCollection?: () => void;
  /** How many collections hold the model, each time that's loaded or changed. */
  onCountChange?: (count: number) => void;
};

/** Each chip click toggles membership immediately; there's no save step. */
export default function AddToCollectionModal({
  open,
  onClose,
  printId,
  onUnauthorized,
  collectionId,
  onRemovedFromCollection,
  onCountChange,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const [collections, setCollections] = useState<CollectionMembership[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // A write landing after closing would report a stale count, and either copy could list the old membership.
  const busy = pendingIds.length > 0 || creating;

  useEffect(() => {
    if (!open) return;
    // Answering after closing, it could overwrite a newer count from the page's other dialog.
    let cancelled = false;
    setError(null);
    setCollections(null);
    collectionsApi
      .listForPrint(printId)
      .then((list) => {
        if (!cancelled) setCollections(list);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          onUnauthorized?.();
          return;
        }
        setError(err instanceof Error ? err.message : t("models:detail.addToCollectionLoadFailed"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, printId]);

  useEffect(() => {
    if (collections) onCountChange?.(collections.filter((c) => c.in_collection).length);
  }, [collections, onCountChange]);

  const setMembership = async (collection: CollectionMembership, nextIn: boolean) => {
    setPendingIds((prev) => [...prev, collection.id]);
    setError(null);
    try {
      if (nextIn) {
        await collectionsApi.addItem(collection.id, printId);
      } else {
        await collectionsApi.removeItem(collection.id, printId);
      }
      setCollections(
        (prev) => prev?.map((c) => (c.id === collection.id ? { ...c, in_collection: nextIn } : c)) ?? prev,
      );
      if (collection.id === collectionId && !nextIn) onRemovedFromCollection?.();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      setError(err instanceof Error ? err.message : t("models:detail.addToCollectionFailed"));
    } finally {
      setPendingIds((prev) => prev.filter((id) => id !== collection.id));
    }
  };

  const toggle = (collection: CollectionMembership) => {
    if (pendingIds.length === 0) void setMembership(collection, !collection.in_collection);
  };

  // There's no save step here either, so the model goes straight in. Listed first: if that fails, it still exists.
  const addCreated = (made: Collection) => {
    const row = { id: made.id, name: made.name, in_collection: false };
    setCollections((prev) => [row, ...(prev ?? [])]);
    setCreatedId(made.id);
    listRef.current?.scrollTo({ top: 0 });
    void setMembership(row, true);
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t("models:detail.addToCollectionTitle")}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        )}
        {collections === null && !error && (
          <Stack alignItems="center" sx={{ py: 3 }}>
            <CircularProgress size={24} />
          </Stack>
        )}
        {collections?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("models:detail.addToCollectionEmpty")}
          </Typography>
        )}
        {collections && collections.length > 0 && (
          <Stack ref={listRef} direction="row" flexWrap="wrap" gap={1} sx={{ maxHeight: 280, overflowY: "auto" }}>
            {collections.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                clickable
                disabled={pendingIds.includes(c.id)}
                onClick={() => toggle(c)}
                color={c.in_collection ? "primary" : "default"}
                variant={c.in_collection ? "filled" : "outlined"}
                icon={
                  pendingIds.includes(c.id) ? (
                    <CircularProgress size={14} color="inherit" />
                  ) : c.in_collection ? (
                    <CheckIcon fontSize="small" />
                  ) : undefined
                }
                sx={c.id === createdId ? freshChipSx : undefined}
              />
            ))}
          </Stack>
        )}
        <NewCollectionField
          onCreated={addCreated}
          disabled={collections === null}
          focused={collections?.length === 0}
          onCreatingChange={setCreating}
          onUnauthorized={onUnauthorized}
          sx={{ mt: 2 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t("common:close")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
