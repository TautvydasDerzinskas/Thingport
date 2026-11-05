import { useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import type { Collection, CollectionInput } from "../../api/collections";
import TagInput from "../../components/TagInput";
import Segmented from "../../components/controls/Segmented";
import HelpTip from "../../components/HelpTip";
import { useSocialStatus } from "../../hooks/useSocialStatus";

type Visibility = "private" | "public";

type Props = {
  collection?: Collection | null;
  onClose: () => void;
  onSubmit: (input: CollectionInput) => Promise<void>;
};

/** Edit mode is create mode prefilled from `collection`. */
export default function CollectionFormModal({ collection, onClose, onSubmit }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const [name, setName] = useState(collection?.name || "");
  const [description, setDescription] = useState(collection?.description || "");
  const [tags, setTags] = useState<string[]>(collection?.tags || []);
  // Private until its owner says otherwise. Offered only while social features are on: off, nobody else sees it anyway.
  const social = useSocialStatus();
  const [visibility, setVisibility] = useState<Visibility>(collection?.is_public ? "public" : "private");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(collection);
  const trimmedName = name.trim();

  const handleSubmit = async () => {
    if (!trimmedName || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: trimmedName,
        description: description.trim() || null,
        tags,
        ...(social?.enabled ? { is_public: visibility === "public" } : {}),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("models:collections.form.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {isEdit ? t("models:collections.form.editTitle") : t("models:collections.form.createTitle")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t("models:collections.form.nameLabel")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            fullWidth
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            required
          />
          <TextField
            label={t("models:collections.form.descriptionLabel")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving}
            fullWidth
            multiline
            minRows={3}
          />
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              {t("models:collections.form.tagsLabel")}
            </Typography>
            <TagInput
              value={tags}
              onChange={setTags}
              placeholder={t("models:collections.form.tagsPlaceholder") ?? undefined}
            />
          </Stack>
          {social?.enabled && (
            <Stack spacing={0.5} alignItems="flex-start">
              <Typography variant="body2" color="text.secondary">
                {t("models:collections.form.visibilityLabel")}
                <HelpTip text={t("models:collections.form.visibilityHelp")} />
              </Typography>
              <Segmented
                value={visibility}
                onChange={setVisibility}
                label={t("models:collections.form.visibilityLabel")}
                disabled={saving}
                options={[
                  { value: "private", label: t("models:collections.form.private") },
                  { value: "public", label: t("models:collections.form.public") },
                ]}
              />
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={saving || !trimmedName}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {isEdit ? t("common:save") : t("models:collections.form.create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
