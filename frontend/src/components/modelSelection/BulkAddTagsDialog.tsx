import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import { UnauthorizedError } from "../../api/client";
import { type Print, printsApi } from "../../api/prints";
import { useToast } from "../ToastProvider";
import TagInput from "../TagInput";

type Props = {
  open: boolean;
  onClose: () => void;
  printIds: string[];
  onUpdated: (prints: Print[]) => void;
  onUnauthorized?: () => void;
};

/** Adds tags to every selected model, keeping the ones each already has. */
export default function BulkAddTagsDialog({ open, onClose, printIds, onUpdated, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const showToast = useToast();
  const [tags, setTags] = useState<string[]>([]);
  const [existing, setExisting] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTags([]);
    setError(null);
    setExisting(null);
    printsApi
      .listTags()
      .then(setExisting)
      // Suggestions only: typing a tag still works without them.
      .catch(() => setExisting([]));
  }, [open]);

  const picked = new Set(tags.map((tag) => tag.toLowerCase()));
  const suggestions = (existing ?? []).filter((tag) => !picked.has(tag.toLowerCase()));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await printsApi.bulkAddTags(printIds, tags);
      onUpdated(result.prints);
      showToast({ message: t("models:selection.tagsAdded", { count: result.changed }) });
      onClose();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      setError(err instanceof Error ? err.message : t("models:selection.addTagsFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t("models:selection.addTagsTitle", { count: printIds.length })}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        )}
        <TagInput value={tags} onChange={setTags} placeholder={t("models:selection.addTagsPlaceholder")} />
        {existing === null && (
          <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1.5 }}>
            {[64, 88, 56, 72].map((width) => (
              <Skeleton key={width} variant="rounded" width={width} height={24} sx={{ borderRadius: 3 }} />
            ))}
          </Stack>
        )}
        {suggestions.length > 0 && (
          <>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5, mb: 0.75 }}>
              {t("models:selection.existingTags")}
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ maxHeight: 168, overflowY: "auto" }}>
              {suggestions.map((tag) => (
                <Chip
                  key={tag}
                  size="small"
                  variant="outlined"
                  icon={<AddIcon fontSize="small" />}
                  label={tag}
                  onClick={() => setTags([...tags, tag])}
                />
              ))}
            </Stack>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={saving || tags.length === 0}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {t("models:selection.addTags")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
