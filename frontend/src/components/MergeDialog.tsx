import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, keyframes } from "@mui/material/styles";
import CallMergeIcon from "@mui/icons-material/CallMerge";
import CheckIcon from "@mui/icons-material/Check";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import SyncDisabledIcon from "@mui/icons-material/SyncDisabled";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { UnauthorizedError } from "../api/client";
import HelpTip from "./HelpTip";
import RollingNumber from "./RollingNumber";
import { SectionLabel } from "./Layout/ConfigurationDialog/parts";

export type MergeItem = {
  key: string;
  name: string;
  /** Models in it, or with it. */
  count: number;
  /** A small square picture of it. */
  thumbnail: ReactNode;
  bookmarked: boolean;
  /** Collections only: the provider it syncs with, whose sync stops if it's merged away. */
  syncProvider?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  kind: "collection" | "tag";
  items: MergeItem[];
  /** Every model in any of `items`, once: the merged one's count, whichever is kept. */
  loadPreview: () => Promise<{ models: number }>;
  /** Runs the merge; throws to keep the dialog open with the error. */
  onMerge: (primary: MergeItem, others: MergeItem[]) => Promise<void>;
  onUnauthorized?: () => void;
};

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: none; }
`;
const motion = { "@media (prefers-reduced-motion: reduce)": { animation: "none", transition: "none" } } as const;

/** The one with the most models: merging into it moves the fewest. */
const defaultPrimary = (items: MergeItem[]) =>
  items.reduce((best, item) => (item.count > best.count ? item : best), items[0])?.key ?? "";

/** Merges several collections or tags into one the user picks, showing what each will become and what the merged one
 *  will hold before anything changes. */
export default function MergeDialog({ open, onClose, kind, items, loadPreview, onMerge, onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["models", "common"]);
  const [primaryKey, setPrimaryKey] = useState("");
  const [union, setUnion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  // Fresh each open: the selection, and the models in it, may have changed since.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPrimaryKey(defaultPrimary(items));
    setUnion(null);
    setError(null);
    loadPreview()
      .then((preview) => live && setUnion(preview.models))
      .catch((err: unknown) => {
        if (!live) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setError(err instanceof Error ? err.message : t("models:merge.previewFailed"));
      });
    return () => {
      live = false;
    };
    // Only on opening: `items` and `loadPreview` are rebuilt by every render of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const primary = items.find((item) => item.key === primaryKey) ?? items[0];
  const others = useMemo(() => items.filter((item) => item !== primary), [items, primary]);
  if (!primary) return null;

  const list = (names: string[]) => {
    const quoted = names.map((name) => t("models:merge.quoted", { name }));
    const shown =
      quoted.length > 3 ? [...quoted.slice(0, 2), t("models:merge.andMore", { count: quoted.length - 2 })] : quoted;
    return new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(shown);
  };
  const otherNames = list(others.map((item) => item.name));
  const added = union === null ? null : Math.max(0, union - primary.count);
  const bookmarkMoves = !primary.bookmarked && others.some((item) => item.bookmarked);
  const syncsLost = others.filter((item) => item.syncProvider);
  const k = kind === "collection" ? "collections" : "tags";

  const merge = async () => {
    setMerging(true);
    setError(null);
    try {
      await onMerge(primary, others);
      onClose();
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("models:merge.failed"));
    } finally {
      setMerging(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !merging && onClose()} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <CallMergeIcon color="primary" />
        {t(`models:merge.${k}.title`, { count: items.length })}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          <Box>
            <SectionLabel>
              {t("models:merge.keep")}
              <HelpTip text={t(`models:merge.${k}.keepHelp`)} />
            </SectionLabel>
            <Stack spacing={0.75} sx={{ maxHeight: 280, overflowY: "auto", p: "2px", m: "-2px" }}>
              {items.map((item) => {
                const kept = item === primary;
                return (
                  <ButtonBase
                    key={item.key}
                    aria-pressed={kept}
                    disabled={merging}
                    onClick={() => setPrimaryKey(item.key)}
                    sx={(theme) => ({
                      display: "flex",
                      alignItems: "center",
                      gap: 1.25,
                      p: 0.75,
                      pr: 1,
                      borderRadius: "10px",
                      border: 1,
                      textAlign: "left",
                      borderColor: kept ? "primary.main" : "divider",
                      bgcolor: kept ? alpha(theme.palette.primary.main, 0.08) : "transparent",
                      boxShadow: kept ? `inset 0 0 0 1px ${theme.palette.primary.main}` : "none",
                      transition: "border-color 150ms, background-color 150ms, box-shadow 150ms",
                      "&:hover": { borderColor: kept ? "primary.main" : "text.disabled" },
                      "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
                      ...motion,
                    })}
                  >
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        flexShrink: 0,
                        borderRadius: "8px",
                        overflow: "hidden",
                        bgcolor: "action.hover",
                        // A card's "No preview" caption doesn't fit 40px; the empty square says as much.
                        "& .MuiTypography-root": { display: "none" },
                        // The ones going away fade back, so the kept one reads first.
                        opacity: kept ? 1 : 0.6,
                        filter: kept ? "none" : "grayscale(0.6)",
                        transition: "opacity 200ms, filter 200ms",
                        ...motion,
                      }}
                    >
                      {item.thumbnail}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={kept ? 700 : 500} noWrap title={item.name}>
                        {item.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="div" noWrap>
                        {t("models:collections.card.itemCount", { count: item.count })}
                        {item.syncProvider && ` · ${t("models:merge.syncsWith", { provider: item.syncProvider })}`}
                      </Typography>
                    </Box>
                    <StatusPill kept={kept} label={kept ? t("models:merge.kept") : t(`models:merge.${k}.goes`)} />
                  </ButtonBase>
                );
              })}
            </Stack>
          </Box>

          <Box>
            <SectionLabel>{t("models:merge.after")}</SectionLabel>
            <Box sx={{ border: 1, borderColor: "divider", borderRadius: "10px", p: 1.5 }}>
              <Stack direction="row" alignItems="baseline" spacing={1} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
                <Typography
                  key={primary.key}
                  variant="subtitle1"
                  fontWeight={700}
                  noWrap
                  sx={{ minWidth: 0, maxWidth: "100%", animation: `${fadeIn} 200ms ease-out`, ...motion }}
                  title={primary.name}
                >
                  {primary.name}
                </Typography>
                {union === null && !error ? (
                  <Skeleton width={120} />
                ) : (
                  union !== null && (
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                      <RollingNumber value={primary.count} /> →{" "}
                      <Box component="span" sx={{ color: "text.primary", fontWeight: 600 }}>
                        <RollingNumber value={union} />
                      </Box>{" "}
                      {t("models:merge.modelUnit", { count: union })}
                      {added !== null && added > 0 && (
                        <Box component="span" sx={{ color: "success.main", fontWeight: 600 }}>
                          {" · +"}
                          <RollingNumber value={added} /> {t("models:merge.new", { count: added })}
                        </Box>
                      )}
                    </Typography>
                  )
                )}
              </Stack>

              <Stack component="ul" spacing={0.75} sx={{ listStyle: "none", p: 0, m: 0, mt: 1.25 }}>
                <Outcome icon={<DeleteOutlineIcon fontSize="small" color="error" />}>
                  {t(`models:merge.${k}.othersGo`, { names: otherNames, count: others.length, name: primary.name })}
                </Outcome>
                <Outcome icon={<LockOutlinedIcon fontSize="small" color="action" />}>
                  {t(`models:merge.${k}.keepsOwn`, { name: primary.name })}
                </Outcome>
                {bookmarkMoves && (
                  <Outcome icon={<BookmarkBorderIcon fontSize="small" color="primary" />}>
                    {t("models:merge.bookmarkMoves", { name: primary.name })}
                  </Outcome>
                )}
              </Stack>
            </Box>
          </Box>

          {syncsLost.length > 0 && (
            <Alert severity="warning" icon={<SyncDisabledIcon fontSize="inherit" />} sx={{ py: 0.25 }}>
              {t("models:merge.collections.syncStops", {
                names: list(syncsLost.map((item) => item.name)),
                count: syncsLost.length,
              })}
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: "text.secondary" }}>
            <InfoOutlinedIcon sx={{ fontSize: 16 }} />
            <Typography variant="caption">{t("models:merge.cantUndo")}</Typography>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={merging}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={() => void merge()}
          disabled={merging || union === null}
          startIcon={merging ? <CircularProgress size={14} color="inherit" /> : <CallMergeIcon fontSize="small" />}
          sx={{ maxWidth: "70%" }}
        >
          <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("models:merge.mergeInto", { name: primary.name })}
          </Box>
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function StatusPill({ kept, label }: { kept: boolean; label: string }) {
  return (
    <Box
      key={String(kept)}
      component="span"
      sx={(theme) => ({
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        px: 1,
        py: 0.25,
        borderRadius: "999px",
        fontSize: "0.72rem",
        fontWeight: 600,
        whiteSpace: "nowrap",
        color: kept ? "primary.contrastText" : "error.main",
        bgcolor: kept ? "primary.main" : alpha(theme.palette.error.main, 0.1),
        animation: `${fadeIn} 180ms ease-out`,
        ...motion,
      })}
    >
      {kept ? <CheckIcon sx={{ fontSize: 14 }} /> : <DeleteOutlineIcon sx={{ fontSize: 14 }} />}
      {label}
    </Box>
  );
}

function Outcome({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Stack component="li" direction="row" spacing={1} alignItems="flex-start">
      <Box sx={{ display: "flex", mt: "1px" }}>{icon}</Box>
      <Typography variant="body2">{children}</Typography>
    </Stack>
  );
}
