import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { aiCategorizationApi, type AiRunCounts, type AiRunScope } from "../../api/aiCategorization";
import type { Print } from "../../api/prints";
import { useToast } from "../../components/ToastProvider";
import { ListRowSkeletons } from "../../components/ListSkeleton";
import HelpTip from "../../components/HelpTip";
import { useAiRun } from "../../components/Layout/AiRunContext";

type Props = {
  onUnauthorized?: () => void;
  onPrintUpdated?: (print: Print) => void;
  /** Many models may have changed category after a bulk accept or reject. */
  onLibraryChanged?: () => void;
  /** Closes the manager once a run starts: its progress shows at the bottom of the app. */
  onRunStarted?: () => void;
};
const initialCounts: AiRunCounts = { uncategorized: 0, ai: 0, rule: 0, legacy: 0, manual: 0, folder: 0 };
// Models without a place, and models parked in folders, are what a run is for; re-checking a category is opt-in.
const initialScope: AiRunScope = {
  include_uncategorized: true,
  include_folders: true,
  include_ai: false,
  include_rule: false,
  include_manual: false,
};
const scopeOptions = [
  { key: "include_uncategorized", label: "uncategorized", count: (counts: AiRunCounts) => counts.uncategorized },
  { key: "include_folders", label: "folders", count: (counts: AiRunCounts) => counts.folder },
  { key: "include_ai", label: "ai", count: (counts: AiRunCounts) => counts.ai },
  { key: "include_rule", label: "rule", count: (counts: AiRunCounts) => counts.rule },
  { key: "include_manual", label: "manual", count: (counts: AiRunCounts) => counts.manual + counts.legacy },
] as const;

/** The AI section of the models manager: a library run above the pending suggestions. */
export default function AiCategorizationPanel({
  onUnauthorized,
  onPrintUpdated,
  onLibraryChanged,
  onRunStarted,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const showToast = useToast();
  const [counts, setCounts] = useState(initialCounts);
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [scope, setScope] = useState(initialScope);
  const [items, setItems] = useState<Print[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const { running, startRun } = useAiRun();

  const loadSuggestions = async (offset = 0, append = false) => {
    const result = await aiCategorizationApi.suggestions(50, offset);
    setItems((current) => (append ? [...current, ...result.items] : result.items));
    setTotal(result.total);
    if (!append) setSelected([]);
  };

  // Reloaded whenever a run stops, since a run adds suggestions.
  useEffect(() => {
    if (running) return;
    let active = true;
    setSuggestionsLoading(true);
    void aiCategorizationApi
      .suggestions(50, 0)
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setTotal(result.total);
        setSelected([]);
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (active) showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
      })
      .finally(() => {
        if (active) setSuggestionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [running, onUnauthorized, showToast]);

  // Counts on opening, and again after a run, which moves models between the groups.
  useEffect(() => {
    if (running) return;
    let active = true;
    void aiCategorizationApi
      .runState()
      .then((state) => {
        if (!active) return;
        setCounts(state.counts);
        setCountsLoaded(true);
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (active) showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
      });
    return () => {
      active = false;
    };
  }, [running, onUnauthorized, showToast]);

  const start = async () => {
    setBusy(true);
    try {
      await startRun(scope);
      onRunStarted?.();
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
        onLibraryChanged?.();
      }
      await loadSuggestions();
      // An accepted model leaves "without category" or its folder.
      setCounts((await aiCategorizationApi.runState()).counts);
      showToast({ message: t(`models:aiCategorization.${action}Done`, { count: ids.length }) });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const toggleScope = (key: keyof AiRunScope) => setScope((current) => ({ ...current, [key]: !current[key] }));
  const selectedCount = scopeOptions.reduce((sum, option) => sum + (scope[option.key] ? option.count(counts) : 0), 0);
  // An empty group has nothing to pick; a hidden one adds nothing to the run either.
  const visibleOptions = scopeOptions.filter((option) => option.count(counts) > 0);

  return (
    <>
      <Stack spacing={1.5} sx={{ mb: 2.5 }}>
        <Typography variant="body2" fontWeight={600}>
          {t("models:aiCategorization.scopeTitle")}
        </Typography>
        {countsLoaded && !visibleOptions.length && (
          <Typography variant="body2" color="text.secondary">
            {t("models:aiCategorization.nothingToCategorize")}
          </Typography>
        )}
        <Stack direction="row" flexWrap="wrap" useFlexGap columnGap={2.5} rowGap={0.5}>
          {visibleOptions.map((option) => (
            <FormControlLabel
              key={option.key}
              sx={{ mr: 0 }}
              control={
                <Checkbox
                  size="small"
                  checked={scope[option.key]}
                  onChange={() => toggleScope(option.key)}
                  disabled={running}
                />
              }
              label={
                <>
                  {t(`models:aiCategorization.scope.${option.label}`, { count: option.count(counts) })}
                  <HelpTip text={t(`models:aiCategorization.scope.${option.label}Help`)} />
                </>
              }
            />
          ))}
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Button
            size="small"
            variant="contained"
            startIcon={busy ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
            onClick={() => void start()}
            disabled={busy || running || selectedCount === 0}
          >
            {t("models:aiCategorization.start")}
          </Button>
          {running && (
            <Typography variant="caption" color="text.secondary">
              {t("models:aiCategorization.runInProgress")}
            </Typography>
          )}
        </Stack>
      </Stack>
      <Divider sx={{ mb: 2 }} />
      <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
        {t("models:aiCategorization.suggestionsTitle", { count: total })}
      </Typography>
      <Box>
        {suggestionsLoading && !items.length ? (
          <ListRowSkeletons count={3} lead="rounded" leadSize={24} twoLines trailing />
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
      </Box>
    </>
  );
}
