import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { UnauthorizedError } from "../../api/client";
import { widgetsApi, type CustomWidget } from "../../api/widgets";
import Segmented from "../../components/controls/Segmented";

type Part = "metadata" | "script" | "html";

// A working starting point: a clock showing the time in a place the user picks.
const STARTER_METADATA = `{
  "name": "World clock",
  "description": "The time in another city.",
  "icon": "🕒",
  "size": { "w": 3, "h": 2, "minW": 2, "minH": 2 },
  "settings": [
    { "key": "zone", "type": "text", "label": "Time zone", "default": "America/New_York" },
    { "key": "label", "type": "text", "label": "Label", "default": "New York" }
  ]
}
`;

const STARTER_SCRIPT = `export default function mount(thingport) {
  const { root, settings, theme } = thingport;
  root.innerHTML = \`
    <div style="height:100%;display:flex;flex-direction:column;justify-content:center;padding:16px;font-family:\${theme.fontFamily}">
      <div class="time" style="font-size:36px;font-weight:600;color:\${theme.text}"></div>
      <div style="color:\${theme.textSecondary}">\${settings.label}</div>
    </div>\`;
  const time = root.querySelector(".time");
  const tick = () => {
    time.textContent = new Date().toLocaleTimeString([], { timeZone: settings.zone, hour: "2-digit", minute: "2-digit" });
  };
  tick();
  const timer = setInterval(tick, 10_000);
  return () => clearInterval(timer);
}
`;

type Props = {
  open: boolean;
  /** The widget to edit; null makes a new one. */
  widget: CustomWidget | null;
  onClose: () => void;
  onSaved: (widget: CustomWidget) => void;
  onUnauthorized?: () => void;
};

/** Writes one of the user's own widgets: its metadata (JSON or YAML), script and optional HTML. */
export default function WidgetEditorDialog({ open, widget, onClose, onSaved, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [part, setPart] = useState<Part>("metadata");
  const [slug, setSlug] = useState("");
  const [metadata, setMetadata] = useState("");
  const [script, setScript] = useState("");
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPart("metadata");
    setError(null);
    setSlug(widget?.source === "own" ? widget.slug : widget ? `${widget.slug}-copy` : "world-clock");
    setMetadata(widget ? JSON.stringify(widget.manifest, null, 2) : STARTER_METADATA);
    setScript(widget?.script ?? STARTER_SCRIPT);
    setHtml(widget?.html ?? "");
  }, [open, widget]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await widgetsApi.save({ slug: slug.trim(), metadata, script, html: html.trim() ? html : null }));
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const code = { fontFamily: "monospace", fontSize: 13 };
  const editors: Record<Part, { value: string; set: (value: string) => void; rows: number; label: string }> = {
    metadata: { value: metadata, set: setMetadata, rows: 16, label: t("dashboard.custom.editor.metadata") },
    script: { value: script, set: setScript, rows: 18, label: t("dashboard.custom.editor.script") },
    html: { value: html, set: setHtml, rows: 12, label: t("dashboard.custom.editor.html") },
  };
  const editor = editors[part];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {widget?.source === "own" ? t("dashboard.custom.editor.editTitle") : t("dashboard.custom.editor.newTitle")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Alert severity="warning" variant="outlined">
            {t("dashboard.custom.editor.trust")}
          </Alert>
          <TextField
            size="small"
            label={t("dashboard.custom.editor.slug")}
            helperText={t("dashboard.custom.editor.slugHelp")}
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
            disabled={widget?.source === "own"}
            slotProps={{ htmlInput: { maxLength: 40, spellCheck: false } }}
          />
          <Box>
            <Segmented
              label={t("dashboard.custom.editor.part")}
              value={part}
              onChange={setPart}
              options={[
                { value: "metadata", label: t("dashboard.custom.editor.metadata") },
                { value: "script", label: t("dashboard.custom.editor.script") },
                { value: "html", label: t("dashboard.custom.editor.html") },
              ]}
            />
          </Box>
          <TextField
            key={part}
            multiline
            fullWidth
            minRows={editor.rows}
            maxRows={editor.rows + 10}
            value={editor.value}
            onChange={(event) => editor.set(event.target.value)}
            placeholder={part === "html" ? t("dashboard.custom.editor.htmlPlaceholder") : undefined}
            slotProps={{ htmlInput: { "aria-label": editor.label, spellCheck: false, style: code } }}
          />
          {error && (
            <Alert severity="error" sx={{ whiteSpace: "pre-wrap" }}>
              {error}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t("dashboard.custom.editor.cancel")}</Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving || !slug.trim() || !script.trim()}>
          {t("dashboard.custom.editor.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
