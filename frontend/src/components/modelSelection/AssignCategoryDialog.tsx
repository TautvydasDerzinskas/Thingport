import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import { UnauthorizedError } from "../../api/client";
import { type Category, categoriesApi } from "../../api/categories";
import { type Print, printsApi } from "../../api/prints";
import { translateCategoryDisplay } from "../../utils/translateCategoryDisplay";
import CategoryPicker from "../CategoryPicker";
import { useToast } from "../ToastProvider";

type Props = {
  open: boolean;
  onClose: () => void;
  /** The models to change: the selected ones that can be. */
  prints: Print[];
  /** Selected models left out because they can't be changed. */
  skipped: number;
  onAssigned: (prints: Print[]) => void;
  onUnauthorized?: () => void;
};

/** Gives the selected uploads one category, warning first that it takes them out of the folder structure. */
export default function AssignCategoryDialog({ open, onClose, prints, skipped, onAssigned, onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["models", "common"]);
  const showToast = useToast();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Handed over once the dialog has gone: models leaving the grid would change what it says as it fades out.
  const assigned = useRef<Print[]>([]);
  const count = prints.length;
  const replaced = prints.filter((print) => print.category_kind === "category").length;
  const notes = [
    ...(replaced > 0 ? [t("models:assignCategory.replaces", { count: replaced })] : []),
    ...(skipped > 0 ? [t("models:selection.skipped", { count: skipped })] : []),
  ];

  const failed = (err: unknown, fallback: string) => {
    if (err instanceof UnauthorizedError) {
      onUnauthorized?.();
      return;
    }
    console.error(err);
    setError(err instanceof Error && err.message ? err.message : fallback);
  };

  // Fresh each open: categories may have changed since.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setCategories(null);
    setCategoryId("");
    setError(null);
    categoriesApi
      .list()
      .then((all) => live && setCategories(all.filter((category) => category.kind === "category")))
      .catch((err: unknown) => {
        if (!live) return;
        setCategories([]);
        failed(err, t("models:assignCategory.loadFailed"));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const assign = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await printsApi.bulkAssignCategory(
        prints.map((print) => print.id),
        categoryId,
      );
      assigned.current = result.prints;
      const chosen = categories?.find((category) => category.id === categoryId);
      const left = skipped + result.skipped;
      const parts = [
        result.prints.length
          ? t("models:assignCategory.done", {
              count: result.prints.length,
              name: chosen ? translateCategoryDisplay(chosen, i18n).name : "",
            })
          : null,
        left ? t("models:selection.skipped", { count: left }) : null,
        result.failed ? t("models:assignCategory.partlyFailed", { count: result.failed }) : null,
      ].filter(Boolean);
      showToast({ message: parts.join(" "), severity: result.failed ? "warning" : "success" });
      onClose();
    } catch (err) {
      failed(err, t("models:assignCategory.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      slotProps={{
        transition: {
          onExited: () => {
            if (assigned.current.length) onAssigned(assigned.current);
            assigned.current = [];
          },
        },
      }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <CategoryOutlinedIcon color="primary" />
        {t("models:assignCategory.title", { count })}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          {categories === null ? (
            <Skeleton variant="rounded" height={56} />
          ) : categories.length > 0 ? (
            <CategoryPicker
              categories={categories}
              value={categoryId}
              onChange={setCategoryId}
              label={t("models:assignCategory.category")}
              disabled={saving}
            />
          ) : (
            !error && (
              <Typography variant="body2" color="text.secondary">
                {t("models:assignCategory.empty")}
              </Typography>
            )
          )}
          <Alert severity="warning" sx={{ py: 0.25 }}>
            {t("models:assignCategory.folderWarning")}
          </Alert>
          {notes.length > 0 && (
            <Alert severity="info" sx={{ py: 0.25 }}>
              {notes.join(" ")}
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={() => void assign()}
          disabled={saving || !categoryId}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {t("models:assignCategory.action")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
