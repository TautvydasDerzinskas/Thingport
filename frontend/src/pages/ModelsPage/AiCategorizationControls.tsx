import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { aiCategorizationApi, type AiRun, type AiRunCounts, type AiRunScope } from "../../api/aiCategorization";
import type { Print } from "../../api/prints";
import { useToast } from "../../components/ToastProvider";

type Props = { onUnauthorized?: () => void; onPrintUpdated?: (print: Print) => void };
const initialCounts: AiRunCounts = { uncategorized: 0, ai: 0, rule: 0, legacy: 0, manual: 0, folder: 0 };
const initialScope: AiRunScope = { include_ai: false, include_rule: false, include_legacy: false };

export default function AiCategorizationControls({ onUnauthorized, onPrintUpdated }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const showToast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [counts, setCounts] = useState(initialCounts);
  const [run, setRun] = useState<AiRun | null>(null);
  const [scope, setScope] = useState(initialScope);
  const [items, setItems] = useState<Print[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const loadRun = async () => {
    const state = await aiCategorizationApi.runState();
    setCounts(state.counts);
    setRun(state.run);
  };
  const loadSuggestions = async (offset = 0, append = false) => {
    const result = await aiCategorizationApi.suggestions(50, offset);
    setItems((current) => (append ? [...current, ...result.items] : result.items));
    setTotal(result.total);
    if (!append) setSelected([]);
  };

  useEffect(() => {
    let active = true;
    void aiCategorizationApi
      .status()
      .then(async (status) => {
        if (active) setEnabled(status.enabled);
        if (active && status.enabled) {
          const suggestions = await aiCategorizationApi.suggestions(1, 0);
          if (active) setTotal(suggestions.total);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      });
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  useEffect(() => {
    if (!runOpen) return;
    let active = true;
    const refresh = async () => {
      try {
        const state = await aiCategorizationApi.runState();
        if (active) {
          setCounts(state.counts);
          setRun(state.run);
        }
      } catch (err) {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [runOpen, onUnauthorized]);

  const openRun = async () => {
    setRunOpen(true);
    setBusy(true);
    try {
      await loadRun();
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const openSuggestions = async () => {
    setSuggestionsOpen(true);
    setBusy(true);
    try {
      await loadSuggestions();
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    try {
      const result = await aiCategorizationApi.startRun(scope);
      setRun(result.run);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      const result = await aiCategorizationApi.cancelRun();
      setRun(result.run);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const actOnItems = async (action: "accept" | "reject", ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      if (ids.length === 1) {
        const result =
          action === "accept" ? await aiCategorizationApi.accept(ids[0]) : await aiCategorizationApi.reject(ids[0]);
        onPrintUpdated?.(result.print);
      } else {
        await aiCategorizationApi.bulk(action, ids);
      }
      await loadSuggestions();
      showToast({ message: t(`models:aiCategorization.${action}Done`, { count: ids.length }) });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) return null;
  const toggleScope = (key: keyof AiRunScope) => setScope((current) => ({ ...current, [key]: !current[key] }));

  return (
    <>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button size="small" variant="outlined" startIcon={<AutoAwesomeIcon />} onClick={() => void openRun()}>
          {t("models:aiCategorization.runAll")}
        </Button>
        <Button size="small" variant="outlined" onClick={() => void openSuggestions()}>
          {t("models:aiCategorization.pending", { count: total })}
        </Button>
      </Stack>
      <Dialog open={runOpen} onClose={() => setRunOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t("models:aiCategorization.runTitle")}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Typography variant="body2">
              {t("models:aiCategorization.countUncategorized", { count: counts.uncategorized })}
            </Typography>
            <FormControlLabel
              control={<Checkbox checked={scope.include_ai} onChange={() => toggleScope("include_ai")} />}
              label={t("models:aiCategorization.includeAi", { count: counts.ai })}
            />
            <FormControlLabel
              control={<Checkbox checked={scope.include_rule} onChange={() => toggleScope("include_rule")} />}
              label={t("models:aiCategorization.includeRule", { count: counts.rule })}
            />
            <FormControlLabel
              control={<Checkbox checked={scope.include_legacy} onChange={() => toggleScope("include_legacy")} />}
              label={t("models:aiCategorization.includeLegacy", { count: counts.legacy })}
            />
            <Typography variant="caption" color="text.secondary">
              {t("models:aiCategorization.skipped", { manual: counts.manual, folder: counts.folder })}
            </Typography>
            {run?.running && (
              <>
                <Typography variant="body2">
                  {t("models:aiCategorization.progress", {
                    done: run.done,
                    total: run.total,
                    applied: run.applied,
                    suggested: run.suggested,
                    failed: run.failed,
                  })}
                </Typography>
                <LinearProgress
                  variant={run.total ? "determinate" : "indeterminate"}
                  value={run.total ? (run.done / run.total) * 100 : 0}
                />
              </>
            )}
            {run && !run.running && run.finished_at && (
              <Typography variant="body2">
                {t("models:aiCategorization.finished", {
                  applied: run.applied,
                  suggested: run.suggested,
                  failed: run.failed,
                })}
              </Typography>
            )}
            {run?.last_error && (
              <Typography variant="caption" color="error">
                {run.last_error}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRunOpen(false)}>{t("common:close")}</Button>
          {run?.running ? (
            <Button color="error" onClick={() => void cancel()} disabled={busy}>
              {t("models:aiCategorization.cancel")}
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={() => void start()}
              disabled={
                busy ||
                counts.uncategorized +
                  (scope.include_ai ? counts.ai : 0) +
                  (scope.include_rule ? counts.rule : 0) +
                  (scope.include_legacy ? counts.legacy : 0) ===
                  0
              }
            >
              {busy ? <CircularProgress size={18} /> : t("models:aiCategorization.start")}
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <Dialog open={suggestionsOpen} onClose={() => setSuggestionsOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{t("models:aiCategorization.suggestionsTitle", { count: total })}</DialogTitle>
        <DialogContent>
          {busy && !items.length ? (
            <CircularProgress size={22} />
          ) : items.length ? (
            <>
              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <Button
                  size="small"
                  onClick={() => setSelected(selected.length === items.length ? [] : items.map((item) => item.id))}
                >
                  {selected.length === items.length
                    ? t("models:aiCategorization.deselectAll")
                    : t("models:aiCategorization.selectAll")}
                </Button>
                <Button
                  size="small"
                  startIcon={<CheckIcon />}
                  onClick={() => void actOnItems("accept", selected)}
                  disabled={!selected.length || busy}
                >
                  {t("models:aiCategorization.acceptSelected")}
                </Button>
                <Button
                  size="small"
                  startIcon={<CloseIcon />}
                  onClick={() => void actOnItems("reject", selected)}
                  disabled={!selected.length || busy}
                >
                  {t("models:aiCategorization.rejectSelected")}
                </Button>
              </Stack>
              <List dense>
                {items.map((item) => (
                  // The actions sit in the row rather than in secondaryAction: that one is absolutely
                  // positioned over a fixed padding, and two buttons overlap a long reason.
                  <ListItem
                    key={item.id}
                    divider
                    alignItems="flex-start"
                    sx={{ gap: 1, flexWrap: { xs: "wrap", sm: "nowrap" } }}
                  >
                    <Checkbox
                      checked={selected.includes(item.id)}
                      onChange={() =>
                        setSelected((ids) =>
                          ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id],
                        )
                      }
                    />
                    <ListItemText
                      sx={{ flex: "1 1 0", minWidth: 0 }}
                      primary={item.title || item.name}
                      secondary={
                        item.ai_suggestion && (
                          <>
                            <Typography component="span" variant="body2" fontWeight={600} sx={{ display: "block" }}>
                              {`${item.ai_suggestion.category_path} · ${Math.round(item.ai_suggestion.confidence * 100)}%`}
                            </Typography>
                            {item.ai_suggestion.reason}
                          </>
                        )
                      }
                    />
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{
                        flexShrink: 0,
                        pt: 0.5,
                        // On a phone the actions take their own line instead of squeezing the reason.
                        flexBasis: { xs: "100%", sm: "auto" },
                        justifyContent: "flex-end",
                      }}
                    >
                      <Button size="small" onClick={() => void actOnItems("accept", [item.id])} disabled={busy}>
                        {t("models:aiCategorization.accept")}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => void actOnItems("reject", [item.id])}
                        disabled={busy}
                      >
                        {t("models:aiCategorization.reject")}
                      </Button>
                    </Stack>
                  </ListItem>
                ))}
              </List>
              {total > items.length && (
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="caption" color="text.secondary">
                    {t("models:aiCategorization.firstPage", { shown: items.length, total })}
                  </Typography>
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() =>
                      void (async () => {
                        setBusy(true);
                        try {
                          await loadSuggestions(items.length, true);
                        } catch (err) {
                          if (err instanceof UnauthorizedError) onUnauthorized?.();
                          else
                            showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
                        } finally {
                          setBusy(false);
                        }
                      })()
                    }
                  >
                    {t("models:aiCategorization.loadMore")}
                  </Button>
                </Stack>
              )}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("models:aiCategorization.noSuggestions")}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSuggestionsOpen(false)}>{t("common:close")}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
