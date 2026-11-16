import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import { UnauthorizedError } from "../../api/client";
import {
  SEND_PLACEHOLDERS,
  sendTargetsApi,
  type SendHow,
  type SendOutcome,
  type SendPlacement,
  type SendTarget,
  type SendTargetInput,
} from "../../api/sendTargets";
import Segmented from "../controls/Segmented";
import HelpTip from "../HelpTip";
import TagInput from "../TagInput";
import { newLocalId } from "../../utils/localId";
import { SEND_KINDS, kindOfHow, type SendKind } from "./sendKinds";
import { useSendReason } from "./useSendReason";

type Draft = {
  name: string;
  placement: SendPlacement;
  fileTypes: string[];
  how: SendHow;
  /** A key typed in; empty leaves the stored one. */
  apiKey: string;
  clearKey: boolean;
};

type PresetHow = Extract<SendHow, { type: "preset" }>;
type LinkHow = Extract<SendHow, { type: "link" }>;
type RequestHow = Extract<SendHow, { type: "request" }>;

const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 } as const;

/** A new destination of a kind, filled in as far as it can be. */
export function newHow(kind: SendKind): SendHow {
  if (kind === "link") return { type: "link", url: "", open: "new" };
  if (kind === "request")
    return { type: "request", method: "POST", url: "", body: "multipart", fileField: "file", fields: [], headers: [] };
  return { type: "preset", preset: kind, address: "", start: false };
}

function draftOf(target: SendTarget | null, kind: SendKind, name: string): Draft {
  if (target)
    return {
      name: target.name,
      placement: target.placement,
      fileTypes: target.file_types,
      how: target.how,
      apiKey: "",
      clearKey: false,
    };
  return {
    name,
    placement: "menu",
    fileTypes: SEND_KINDS[kind].fileTypes,
    how: newHow(kind),
    apiKey: "",
    clearKey: false,
  };
}

/** What's saved: file endings as the backend keeps them, and a secret only when one was typed or removed. */
export function inputOf(draft: Draft): SendTargetInput {
  const fileTypes = [...new Set(draft.fileTypes.map((type) => type.trim().toLowerCase().replace(/^\.+/, "")))].filter(
    Boolean,
  );
  let how = draft.how;
  if (how.type === "request") {
    how = {
      ...how,
      fields: how.fields.filter((field) => field.name.trim()),
      headers: how.headers
        .filter((header) => header.name.trim())
        .map((header) => (header.secret && !header.value ? { name: header.name, secret: true } : header)),
      thenOpen: how.thenOpen?.trim() || undefined,
    };
  }
  if (how.type === "link") how = { ...how, tab: how.open === "named" ? how.tab?.trim() || "thingport" : undefined };
  return {
    name: draft.name.trim(),
    placement: draft.placement,
    fileTypes,
    how,
    ...(draft.apiKey ? { apiKey: draft.apiKey } : draft.clearKey ? { apiKey: null } : {}),
  };
}

type Props = {
  /** The one being edited, or null for a new one of `kind`. */
  target: SendTarget | null;
  kind: SendKind;
  defaultName: string;
  onSaved: (target: SendTarget) => void;
  onCancel: () => void;
  onUnauthorized?: () => void;
};

/** A destination's settings, opened in place on its row. A saved one's placement is the row's own toggle. */
export default function SendTargetEditor({ target, kind, defaultName, onSaved, onCancel, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const reasonText = useSendReason();
  const [draft, setDraft] = useState<Draft>(() => draftOf(target, kind, defaultName));
  const [saving, setSaving] = useState(false);
  // Kept from changes while a save goes, so what's saved is what's shown when the editor closes on it.
  const fieldsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fieldsRef.current?.toggleAttribute("inert", saving);
  }, [saving]);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  // What a test came to, shown while the settings are still the ones it tested.
  const [tested, setTested] = useState<{ outcome: SendOutcome; of: Draft } | null>(null);
  // Keys for the rows of form fields and headers, which have no ids of their own.
  const [rowIds, setRowIds] = useState(() => ({
    fields: draft.how.type === "request" ? draft.how.fields.map(() => newLocalId()) : [],
    headers: draft.how.type === "request" ? draft.how.headers.map(() => newLocalId()) : [],
  }));
  const info = SEND_KINDS[kindOfHow(draft.how)];
  const how = draft.how;
  const k = (key: string) => t(`configuration.sendTo.fields.${key}`);
  // Each changes its own kind's settings only, so a draft never mixes two kinds'.
  const setPreset = (next: Partial<Omit<PresetHow, "type">>) =>
    setDraft((d) => (d.how.type === "preset" ? { ...d, how: { ...d.how, ...next } } : d));
  const setLink = (next: Partial<Omit<LinkHow, "type">>) =>
    setDraft((d) => (d.how.type === "link" ? { ...d, how: { ...d.how, ...next } } : d));
  const setRequest = (next: Partial<Omit<RequestHow, "type">>) =>
    setDraft((d) => (d.how.type === "request" ? { ...d, how: { ...d.how, ...next } } : d));
  const input = () => inputOf({ ...draft, placement: target?.placement ?? draft.placement });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // A saved one's placement is left out, so a toggle of it while this saves isn't undone.
      const { placement: _placement, ...settings } = input();
      onSaved(target ? await sendTargetsApi.update(target.id, settings) : await sendTargetsApi.create(input()));
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    const of = draft;
    setTesting(true);
    setTested(null);
    setError(null);
    try {
      setTested({ outcome: await sendTargetsApi.test(target?.id ?? null, input()), of });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const placeholderChips = (onPick: (name: string) => void) => (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.75 }}>
      {SEND_PLACEHOLDERS.map((name) => (
        <Chip
          key={name}
          size="small"
          label={`{${name}}`}
          onClick={() => onPick(`{${name}}`)}
          sx={{ ...mono, fontSize: 11, height: 22 }}
        />
      ))}
    </Box>
  );

  const label = (text: string, help?: string) => (
    <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
      {text}
      {help && <HelpTip text={help} />}
    </Typography>
  );

  return (
    <Stack spacing={1.75} sx={{ pt: 0.5 }}>
      <Stack
        ref={fieldsRef}
        spacing={1.75}
        sx={{
          opacity: saving ? 0.6 : 1,
          transition: "opacity 150ms",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        }}
      >
        <TextField
          size="small"
          label={k("name")}
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          inputProps={{ maxLength: 60 }}
        />

        {how.type === "preset" && (
          <>
            <TextField
              size="small"
              label={info.group === "webhooks" ? k("webhook") : k("address")}
              placeholder={info.example}
              value={how.address}
              onChange={(e) => setPreset({ address: e.target.value })}
              InputProps={{ sx: mono }}
            />
            {info.apiKey && (
              <Box>
                <TextField
                  size="small"
                  fullWidth
                  type="password"
                  autoComplete="off"
                  label={k("apiKey")}
                  value={draft.apiKey}
                  onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value, clearKey: false }))}
                  placeholder={target?.secrets.api_key && !draft.clearKey ? k("stored") : undefined}
                  helperText={
                    target?.secrets.api_key && !draft.clearKey
                      ? k("apiKeyStored")
                      : info.apiKey === "optional"
                        ? k("apiKeyOptional")
                        : undefined
                  }
                />
                {target?.secrets.api_key && !draft.clearKey && (
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => setDraft((d) => ({ ...d, apiKey: "", clearKey: true }))}
                    sx={{ mt: 0.25, color: "text.secondary" }}
                  >
                    {k("apiKeyRemove")}
                  </Button>
                )}
              </Box>
            )}
            {info.group === "printers" && (
              <Box>
                {label(k("after"))}
                <Segmented
                  label={k("after")}
                  value={how.start ? "print" : "upload"}
                  onChange={(value) => setPreset({ start: value === "print" })}
                  options={[
                    { value: "upload", label: k("justUpload") },
                    { value: "print", label: k("startPrinting") },
                  ]}
                  fullWidth
                />
              </Box>
            )}
          </>
        )}

        {how.type === "link" && (
          <>
            <Box>
              <TextField
                size="small"
                fullWidth
                label={k("url")}
                placeholder={info.example}
                value={how.url}
                onChange={(e) => setLink({ url: e.target.value })}
                InputProps={{ sx: mono }}
              />
              {placeholderChips((name) => setLink({ url: `${how.url}${name}` }))}
            </Box>
            <Box>
              {label(k("opens"), k("opensHelp"))}
              <Segmented
                label={k("opens")}
                value={how.open}
                onChange={(open) => setLink({ open })}
                options={[
                  { value: "new", label: k("newTab") },
                  { value: "named", label: k("namedTab") },
                  { value: "same", label: k("sameTab") },
                ]}
                fullWidth
              />
            </Box>
            {how.open === "named" && (
              <TextField
                size="small"
                label={k("tabName")}
                placeholder="thingport"
                value={how.tab ?? ""}
                onChange={(e) => setLink({ tab: e.target.value })}
              />
            )}
          </>
        )}

        {how.type === "request" && (
          <>
            <Box>
              <Stack direction="row" spacing={1}>
                <TextField
                  select
                  size="small"
                  label={k("method")}
                  value={how.method}
                  onChange={(e) => setRequest({ method: e.target.value as RequestHow["method"] })}
                  sx={{ width: 104, flexShrink: 0 }}
                >
                  <MenuItem value="POST">POST</MenuItem>
                  <MenuItem value="PUT">PUT</MenuItem>
                </TextField>
                <TextField
                  size="small"
                  fullWidth
                  label={k("url")}
                  placeholder={info.example}
                  value={how.url}
                  onChange={(e) => setRequest({ url: e.target.value })}
                  InputProps={{ sx: mono }}
                />
              </Stack>
              {placeholderChips((name) => setRequest({ url: `${how.url}${name}` }))}
            </Box>
            <Box>
              {label(k("send"), k("sendHelp"))}
              <Segmented
                label={k("send")}
                value={how.body}
                onChange={(body) => setRequest({ body })}
                options={[
                  { value: "multipart", label: k("multipart") },
                  { value: "raw", label: k("raw") },
                  { value: "json", label: k("json") },
                ]}
                fullWidth
              />
            </Box>
            {how.body === "multipart" && (
              <Box>
                {label(k("formFields"))}
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField
                      size="small"
                      label={k("fileField")}
                      value={how.fileField}
                      onChange={(e) => setRequest({ fileField: e.target.value })}
                      sx={{ width: 160 }}
                      InputProps={{ sx: mono }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {k("fileFieldHint")}
                    </Typography>
                  </Stack>
                  {how.fields.map((field, index) => (
                    <Stack key={rowIds.fields[index]} direction="row" spacing={1} alignItems="center">
                      <TextField
                        size="small"
                        label={k("fieldName")}
                        value={field.name}
                        onChange={(e) =>
                          setRequest({
                            fields: how.fields.map((f, i) => (i === index ? { ...f, name: e.target.value } : f)),
                          })
                        }
                        sx={{ width: 160 }}
                        InputProps={{ sx: mono }}
                      />
                      <TextField
                        size="small"
                        fullWidth
                        label={k("fieldValue")}
                        value={field.value}
                        onChange={(e) =>
                          setRequest({
                            fields: how.fields.map((f, i) => (i === index ? { ...f, value: e.target.value } : f)),
                          })
                        }
                        InputProps={{ sx: mono }}
                      />
                      <Tooltip title={k("remove")}>
                        <IconButton
                          size="small"
                          aria-label={k("remove")}
                          onClick={() => {
                            setRequest({ fields: how.fields.filter((_, i) => i !== index) });
                            setRowIds((ids) => ({ ...ids, fields: ids.fields.filter((_, i) => i !== index) }));
                          }}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  ))}
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => {
                      setRequest({ fields: [...how.fields, { name: "", value: "" }] });
                      setRowIds((ids) => ({ ...ids, fields: [...ids.fields, newLocalId()] }));
                    }}
                    sx={{ alignSelf: "flex-start" }}
                  >
                    {k("addField")}
                  </Button>
                </Stack>
              </Box>
            )}
            <Box>
              {label(k("headers"), k("headersHelp"))}
              <Stack spacing={1}>
                {how.headers.map((header, index) => {
                  const stored = header.secret && Boolean(target?.secrets.headers.includes(header.name));
                  const change = (next: Partial<typeof header>) =>
                    setRequest({ headers: how.headers.map((h, i) => (i === index ? { ...h, ...next } : h)) });
                  return (
                    <Stack key={rowIds.headers[index]} direction="row" spacing={1} alignItems="center">
                      <TextField
                        size="small"
                        label={k("headerName")}
                        value={header.name}
                        onChange={(e) => change({ name: e.target.value })}
                        sx={{ width: 160 }}
                        InputProps={{ sx: mono }}
                      />
                      <TextField
                        size="small"
                        fullWidth
                        type={header.secret ? "password" : "text"}
                        autoComplete="off"
                        label={k("headerValue")}
                        value={header.value ?? ""}
                        placeholder={stored ? k("stored") : undefined}
                        onChange={(e) => change({ value: e.target.value })}
                        InputProps={{ sx: mono }}
                      />
                      <Tooltip title={k("secretHelp")}>
                        <Stack direction="row" alignItems="center" sx={{ flexShrink: 0 }}>
                          <Switch
                            size="small"
                            checked={header.secret}
                            onChange={(e) => change({ secret: e.target.checked })}
                            inputProps={{ "aria-label": k("secret") }}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {k("secret")}
                          </Typography>
                        </Stack>
                      </Tooltip>
                      <Tooltip title={k("remove")}>
                        <IconButton
                          size="small"
                          aria-label={k("remove")}
                          onClick={() => {
                            setRequest({ headers: how.headers.filter((_, i) => i !== index) });
                            setRowIds((ids) => ({ ...ids, headers: ids.headers.filter((_, i) => i !== index) }));
                          }}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  );
                })}
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => {
                    setRequest({ headers: [...how.headers, { name: "", secret: false, value: "" }] });
                    setRowIds((ids) => ({ ...ids, headers: [...ids.headers, newLocalId()] }));
                  }}
                  sx={{ alignSelf: "flex-start" }}
                >
                  {k("addHeader")}
                </Button>
              </Stack>
            </Box>
            <TextField
              size="small"
              label={k("thenOpen")}
              placeholder="http://printer.local"
              helperText={k("thenOpenHelp")}
              value={how.thenOpen ?? ""}
              onChange={(e) => setRequest({ thenOpen: e.target.value })}
              InputProps={{ sx: mono }}
            />
          </>
        )}

        <Box>
          {label(k("fileTypes"), k("fileTypesHelp"))}
          <TagInput
            value={draft.fileTypes}
            onChange={(fileTypes) => setDraft((d) => ({ ...d, fileTypes }))}
            placeholder={k("anyFile")}
          />
        </Box>

        {!target && (
          <Box>
            {label(k("showAs"))}
            <Segmented
              label={k("showAs")}
              value={draft.placement}
              onChange={(placement) => setDraft((d) => ({ ...d, placement }))}
              options={[
                { value: "button", label: t("configuration.sendTo.placement.button") },
                { value: "menu", label: t("configuration.sendTo.placement.menu") },
              ]}
              fullWidth
            />
          </Box>
        )}
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        {how.type !== "link" && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => void test()}
            disabled={testing || saving || !draft.name.trim()}
            startIcon={testing ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {t("configuration.sendTo.test")}
          </Button>
        )}
        {tested?.of === draft && (
          <Chip
            size="small"
            color={tested.outcome.ok ? "success" : "error"}
            variant="outlined"
            label={
              tested.outcome.ok
                ? t("configuration.sendTo.testOk", { status: tested.outcome.status })
                : reasonText(tested.outcome)
            }
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Button color="inherit" onClick={onCancel} disabled={saving}>
          {t("common:cancel")}
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving || !draft.name.trim()}>
          {t("common:save")}
        </Button>
      </Stack>
    </Stack>
  );
}
