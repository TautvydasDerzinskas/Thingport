import { useEffect, useState } from "react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@mui/material/styles";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import RemoveIcon from "@mui/icons-material/Remove";
import { UnauthorizedError } from "../../api/client";
import { type Print, printsApi } from "../../api/prints";
import { useToast } from "../ToastProvider";
import HelpTip from "../HelpTip";

type Props = {
  open: boolean;
  onClose: () => void;
  prints: Print[];
  onUpdated: (prints: Print[]) => void;
  onUnauthorized?: () => void;
};

/** Whether a tag ends up on all of the models, none of them, or stays on just the ones that have it. */
type TagState = "all" | "some" | "none";

type Row = { tag: string; has: number; state: TagState };

const tagKey = (tag: string) => tag.trim().replace(/\s+/g, " ").toLowerCase();

const appear = keyframes`
  from { opacity: 0; transform: scale(0.85); }
  to { opacity: 1; transform: scale(1); }
`;

function initialRows(prints: Print[]): Row[] {
  const counts = new Map<string, Row>();
  for (const print of prints) {
    for (const tag of new Set(print.tags.map(tagKey))) {
      if (!tag) continue;
      const row = counts.get(tag);
      if (row) row.has++;
      else counts.set(tag, { tag: print.tags.find((own) => tagKey(own) === tag)!, has: 1, state: "all" });
    }
  }
  return [...counts.values()]
    .map((row) => ({ ...row, state: row.has === prints.length ? ("all" as const) : ("some" as const) }))
    .toSorted((a, b) => b.has - a.has || a.tag.localeCompare(b.tag));
}

/** A tag only some have can go back to "some"; any other only flips between all and none. */
function nextState(row: Row, total: number): TagState {
  const mixed = row.has > 0 && row.has < total;
  if (row.state === "all") return "none";
  if (row.state === "none") return mixed ? "some" : "all";
  return "all";
}

const startState = (row: Row, total: number): TagState => (row.has === total ? "all" : row.has ? "some" : "none");

/** Tags of the selected models, each put on all of them, taken off all of them, or left as it is. */
export default function BulkEditTagsDialog({ open, onClose, prints, onUpdated, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const showToast = useToast();
  const total = prints.length;
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState("");
  const [existing, setExisting] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows(initialRows(prints));
    setDraft("");
    setError(null);
    setExisting(null);
    printsApi
      .listTags()
      .then(setExisting)
      // Suggestions only: typing a tag still works without them.
      .catch(() => setExisting([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const keys = new Set(rows.map((row) => tagKey(row.tag)));
  const suggestions = (existing ?? []).filter((tag) => !keys.has(tagKey(tag)));
  const add = rows.filter((row) => row.state === "all" && row.has < total).map((row) => row.tag);
  const remove = rows.filter((row) => row.state === "none" && row.has > 0).map((row) => row.tag);
  const dirty = add.length > 0 || remove.length > 0;

  const putOnAll = (raw: string) => {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (!tag) return;
    setRows((prev) =>
      prev.some((row) => tagKey(row.tag) === tagKey(tag))
        ? prev.map((row) => (tagKey(row.tag) === tagKey(tag) ? { ...row, state: "all" } : row))
        : [...prev, { tag, has: 0, state: "all" }],
    );
  };

  const cycle = (key: string) =>
    setRows((prev) => prev.map((row) => (tagKey(row.tag) === key ? { ...row, state: nextState(row, total) } : row)));

  const onDraftKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      putOnAll(draft);
      setDraft("");
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await printsApi.bulkEditTags(
        prints.map((print) => print.id),
        { add, remove },
      );
      onUpdated(result.prints);
      showToast({ message: t("models:selection.tagsUpdated", { count: result.changed }) });
      onClose();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      setError(err instanceof Error ? err.message : t("models:selection.tagsFailed"));
    } finally {
      setSaving(false);
    }
  };

  const summary = [
    add.length ? t("models:selection.summaryAdd", { count: add.length }) : null,
    remove.length ? t("models:selection.summaryRemove", { count: remove.length }) : null,
  ].filter(Boolean);

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t("models:selection.editTagsTitle", { count: total })}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        )}
        <TextField
          size="small"
          fullWidth
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onDraftKeyDown}
          placeholder={t("models:selection.addTagsPlaceholder")}
          slotProps={{ htmlInput: { "aria-label": t("models:selection.addTagsPlaceholder") } }}
          sx={{ mt: 0.5 }}
        />

        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2, mb: 0.75 }}>
          {t("models:selection.selectedTags")}
          <HelpTip text={t("models:selection.selectedTagsHelp")} />
        </Typography>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("models:selection.noTags")}
          </Typography>
        ) : (
          <Stack direction="row" flexWrap="wrap" gap={0.75}>
            {rows.map((row) => {
              const key = tagKey(row.tag);
              const removing = row.state === "none" && row.has > 0;
              return (
                <Chip
                  key={key}
                  size="small"
                  clickable
                  onClick={() => cycle(key)}
                  aria-pressed={row.state === "all" ? "true" : row.state === "some" ? "mixed" : "false"}
                  aria-label={
                    row.state === "some"
                      ? t("models:selection.tagOnSome", { tag: row.tag, count: row.has, total })
                      : undefined
                  }
                  color={row.state === "all" ? "primary" : "default"}
                  variant={row.state === "all" ? "filled" : "outlined"}
                  icon={
                    row.state === "all" ? (
                      <CheckIcon fontSize="small" />
                    ) : row.state === "some" ? (
                      <RemoveIcon fontSize="small" />
                    ) : undefined
                  }
                  label={
                    row.state === "some" ? (
                      <>
                        {row.tag}
                        <Box component="span" sx={{ ml: 0.75, color: "text.secondary", fontSize: "0.7rem" }}>
                          {row.has}/{total}
                        </Box>
                      </>
                    ) : (
                      row.tag
                    )
                  }
                  sx={{
                    // A tag changed from where it started stands out from the ones left alone.
                    fontWeight: row.state !== startState(row, total) ? 600 : undefined,
                    ...(removing && { textDecoration: "line-through", color: "text.disabled" }),
                    ...(row.has === 0 && {
                      animation: `${appear} 180ms ease-out`,
                      "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                    }),
                  }}
                />
              );
            })}
          </Stack>
        )}

        {existing === null && (
          <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 2 }}>
            {[64, 88, 56, 72].map((width) => (
              <Skeleton key={width} variant="rounded" width={width} height={24} sx={{ borderRadius: 3 }} />
            ))}
          </Stack>
        )}
        {suggestions.length > 0 && (
          <>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2, mb: 0.75 }}>
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
                  onClick={() => putOnAll(tag)}
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
          disabled={saving || !dirty}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {dirty ? summary.join(" · ") : t("models:selection.applyTags")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
