import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { UnauthorizedError } from "../../api/client";
import {
  AI_KINDS,
  aiConnectionsApi,
  CLAUDE_BASE_URL,
  REASONING_EFFORTS,
  type AiConnection,
  type AiConnectionInput,
  type AiKind,
  type ReasoningEffort,
} from "../../api/aiConnections";
import { useConfirm } from "../../components/ConfirmProvider";
import Segmented from "../../components/controls/Segmented";
import { AiLogo } from "./aiLogos";

type Props = {
  /** The AI to edit, or null to add one. */
  connection: AiConnection | null;
  onClose: () => void;
  /** After a save or delete; the list reloads. */
  onChanged: () => void;
  onUnauthorized?: () => void;
};

type Draft = Omit<AiConnectionInput, "api_key"> & { api_key: string };

const draftOf = (connection: AiConnection | null): Draft => ({
  kind: connection?.kind ?? "openai",
  base_url: connection?.base_url ?? "",
  model: connection?.model ?? "",
  api_key: "",
  timeout_ms: connection?.timeout_ms ?? 60000,
  concurrency: connection?.concurrency ?? 1,
  reasoning_effort: connection?.reasoning_effort ?? null,
});

/** Adds or edits one AI. Saving tests it first, as the backend only keeps an AI that answers. */
export default function AiConnectionDialog({ connection, onClose, onChanged, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft>(() => draftOf(connection));
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "delete" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const hasApiKey = Boolean(connection?.has_api_key);
  const claude = draft.kind === "anthropic";
  // Claude can't be asked anything, its models listed included, without a key.
  const keyAvailable = Boolean(draft.api_key) || (hasApiKey && !clearKey);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  // A blank key field keeps the saved key, unless it is about to be cleared.
  const keyPayload = clearKey ? { api_key: null } : draft.api_key ? { api_key: draft.api_key } : {};
  const fail = (err: unknown, fallback: string) => {
    if (err instanceof UnauthorizedError) onUnauthorized?.();
    else setError(err instanceof Error ? err.message : fallback);
  };

  // The provider's own list, refetched a moment after the URL or key stops changing; the field still takes any name.
  useEffect(() => {
    const baseUrl = draft.base_url.trim();
    if (!baseUrl || (draft.kind === "anthropic" && !draft.api_key && (!hasApiKey || clearKey))) {
      setModels([]);
      setModelsError(null);
      // A fetch it cancels can't say it's done.
      setModelsLoading(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setModelsLoading(true);
      void aiConnectionsApi
        .models({
          ...(connection ? { id: connection.id } : {}),
          kind: draft.kind,
          base_url: baseUrl,
          ...(clearKey ? { api_key: null } : draft.api_key ? { api_key: draft.api_key } : {}),
        })
        .then((result) => {
          if (!active) return;
          setModels(result.ok ? result.models : []);
          setModelsError(result.ok ? null : result.error);
        })
        .catch((err: unknown) => {
          if (err instanceof UnauthorizedError) onUnauthorized?.();
          else if (active) setModelsError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (active) setModelsLoading(false);
        });
    }, 600);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [connection, draft.kind, draft.base_url, draft.api_key, clearKey, hasApiKey, onUnauthorized]);

  // Claude has one address, filled in; switching away from it leaves the field for the other kind's own.
  const switchKind = (kind: AiKind) =>
    setDraft((current) => ({
      ...current,
      kind,
      base_url:
        kind === "anthropic" ? CLAUDE_BASE_URL : current.base_url.trim() === CLAUDE_BASE_URL ? "" : current.base_url,
      // Claude always thinks, so there's no "none" to ask it for.
      reasoning_effort: kind === "anthropic" && current.reasoning_effort === "none" ? "low" : current.reasoning_effort,
    }));

  const save = async () => {
    setBusy("save");
    setStatus(null);
    setError(null);
    const fields = {
      kind: draft.kind,
      base_url: draft.base_url.trim(),
      model: draft.model.trim(),
      timeout_ms: Number(draft.timeout_ms),
      concurrency: Number(draft.concurrency),
      reasoning_effort: draft.reasoning_effort,
    };
    try {
      if (connection) {
        // Only what changed: the backend tests the AI again when where or how it connects changes.
        const before = draftOf(connection);
        const changed = Object.fromEntries(
          Object.entries(fields).filter(([key, value]) => before[key as keyof Draft] !== value),
        );
        await aiConnectionsApi.update(connection.id, { ...changed, ...keyPayload });
      } else {
        await aiConnectionsApi.create({ ...fields, ...keyPayload });
      }
      onChanged();
      onClose();
    } catch (err) {
      fail(err, t("adminSettings.ai.connection.failed"));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    setStatus(null);
    setError(null);
    try {
      const result = await aiConnectionsApi.test({
        ...(connection ? { id: connection.id } : {}),
        kind: draft.kind,
        base_url: draft.base_url.trim(),
        model: draft.model.trim(),
        timeout_ms: Number(draft.timeout_ms),
        reasoning_effort: draft.reasoning_effort,
        ...keyPayload,
      });
      if (result.ok)
        setStatus(t("adminSettings.ai.connection.testSuccess", { model: result.model, latency: result.latency_ms }));
      else setError(result.error || t("adminSettings.ai.connection.testFailed"));
    } catch (err) {
      fail(err, t("adminSettings.ai.connection.testFailed"));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!connection) return;
    const ok = await confirm({
      title: t("adminSettings.ai.connection.deleteTitle", { model: connection.model }),
      message: connection.is_default
        ? t("adminSettings.ai.connection.deleteDefaultMessage")
        : t("adminSettings.ai.connection.deleteMessage"),
      confirmLabel: t("adminSettings.ai.connection.delete"),
      destructive: true,
    });
    if (!ok) return;
    setBusy("delete");
    setError(null);
    try {
      await aiConnectionsApi.remove(connection.id);
      onChanged();
      onClose();
    } catch (err) {
      fail(err, t("adminSettings.ai.connection.failed"));
    } finally {
      setBusy(null);
    }
  };

  const ready = Boolean(draft.base_url.trim() && draft.model.trim() && (!claude || keyAvailable));
  const showSavedKey = hasApiKey && !clearKey && !draft.api_key;
  const disabled = busy !== null;

  return (
    <Dialog open onClose={disabled ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <AiLogo model={draft.model} baseUrl={draft.base_url} size={24} />
          <span>
            {connection ? t("adminSettings.ai.connection.editTitle") : t("adminSettings.ai.connection.addTitle")}
          </span>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Segmented
            fullWidth
            disabled={disabled}
            label={t("adminSettings.ai.connection.kind")}
            value={draft.kind}
            options={AI_KINDS.map((kind) => ({ value: kind, label: t(`adminSettings.ai.connection.kinds.${kind}`) }))}
            onChange={switchKind}
          />
          <TextField
            label={t("adminSettings.ai.connection.baseUrl")}
            value={draft.base_url}
            onChange={(event) => update("base_url", event.target.value)}
            helperText={
              claude ? t("adminSettings.ai.connection.baseUrlHintClaude") : t("adminSettings.ai.connection.baseUrlHint")
            }
            disabled={disabled}
            fullWidth
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={!connection}
          />
          <Autocomplete
            freeSolo
            options={models}
            inputValue={draft.model}
            onInputChange={(_event, value) => update("model", value)}
            loading={modelsLoading}
            disabled={disabled}
            fullWidth
            renderInput={(params) => (
              <TextField
                {...params}
                label={t("adminSettings.ai.connection.model")}
                placeholder={claude ? "claude-haiku-5-5" : undefined}
                helperText={
                  modelsError
                    ? t("adminSettings.ai.connection.modelsUnavailable", { error: modelsError })
                    : models.length
                      ? t("adminSettings.ai.connection.modelsAvailable", { count: models.length })
                      : claude && !keyAvailable
                        ? t("adminSettings.ai.connection.modelsNeedKey")
                        : undefined
                }
              />
            )}
          />
          <TextField
            type="password"
            label={t("adminSettings.ai.connection.apiKey")}
            value={draft.api_key}
            onChange={(event) => {
              update("api_key", event.target.value);
              setClearKey(false);
            }}
            helperText={
              clearKey
                ? t("adminSettings.ai.connection.keyWillClear")
                : hasApiKey
                  ? t("adminSettings.ai.connection.keySet")
                  : claude
                    ? t("adminSettings.ai.connection.keyRequiredClaude")
                    : t("adminSettings.ai.connection.keyOptional")
            }
            disabled={disabled}
            autoComplete="new-password"
            fullWidth
            placeholder={showSavedKey ? "••••••••••••••••" : undefined}
            slotProps={{
              inputLabel: showSavedKey ? { shrink: true } : undefined,
              input: {
                endAdornment:
                  hasApiKey && !clearKey ? (
                    <InputAdornment position="end">
                      <Button
                        size="small"
                        color="error"
                        onClick={() => {
                          setClearKey(true);
                          update("api_key", "");
                        }}
                        disabled={disabled}
                      >
                        {t("adminSettings.ai.connection.clearKey")}
                      </Button>
                    </InputAdornment>
                  ) : undefined,
              },
            }}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              type="number"
              label={t("adminSettings.ai.connection.timeout")}
              value={draft.timeout_ms}
              inputProps={{ min: 1000, max: 300000, step: 1000 }}
              onChange={(event) => update("timeout_ms", Number(event.target.value))}
              disabled={disabled}
              fullWidth
            />
            <TextField
              type="number"
              label={t("adminSettings.ai.connection.concurrency")}
              value={draft.concurrency}
              inputProps={{ min: 1, max: 4, step: 1 }}
              onChange={(event) => update("concurrency", Number(event.target.value))}
              disabled={disabled}
              fullWidth
            />
          </Stack>
          {/* A select can't hold null, so "" stands for sending nothing. */}
          <TextField
            select
            label={
              claude ? t("adminSettings.ai.connection.effortClaude") : t("adminSettings.ai.connection.reasoningEffort")
            }
            value={draft.reasoning_effort ?? ""}
            onChange={(event) => update("reasoning_effort", (event.target.value || null) as ReasoningEffort | null)}
            helperText={
              claude
                ? t("adminSettings.ai.connection.effortClaudeHint")
                : t("adminSettings.ai.connection.reasoningEffortHint")
            }
            disabled={disabled}
            fullWidth
          >
            <MenuItem value="">
              {claude
                ? t("adminSettings.ai.connection.effortClaudeDefault")
                : t("adminSettings.ai.connection.reasoningEffortDefault")}
            </MenuItem>
            {REASONING_EFFORTS.filter((effort) => !claude || effort !== "none").map((effort) => (
              <MenuItem key={effort} value={effort}>
                {t(`adminSettings.ai.connection.reasoningEffortLevels.${effort}`)}
              </MenuItem>
            ))}
          </TextField>
          {status && <Alert severity="success">{status}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {connection && (
          <Button color="error" onClick={() => void remove()} disabled={disabled} sx={{ mr: "auto" }}>
            {t("adminSettings.ai.connection.delete")}
          </Button>
        )}
        <Button
          onClick={() => void test()}
          disabled={disabled || !ready}
          startIcon={busy === "test" ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {busy === "test" ? t("adminSettings.ai.connection.testing") : t("adminSettings.ai.connection.test")}
        </Button>
        <Button onClick={onClose} disabled={disabled}>
          {t("common:cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={disabled || !ready}
          startIcon={busy === "save" ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {busy === "save" ? t("adminSettings.ai.connection.saving") : t("adminSettings.ai.connection.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
