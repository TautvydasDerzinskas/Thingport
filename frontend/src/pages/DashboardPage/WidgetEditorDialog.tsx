import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import { UnauthorizedError } from "../../api/client";
import { widgetsApi, type CustomWidget, type WidgetManifest } from "../../api/widgets";
import Segmented from "../../components/controls/Segmented";
import { readUser } from "../../utils/auth";
import { WidgetIcon } from "./CustomWidgetCard";
import DetailsForm from "./widgetEditor/DetailsForm";
import SettingsEditor from "./widgetEditor/SettingsEditor";
import WidgetPreview from "./widgetEditor/WidgetPreview";
import { fromManifest, problems, toManifest, type Draft } from "./widgetEditor/draft";

// Loaded with the editor only, so the dashboard doesn't carry CodeMirror.
const CodeEditor = lazy(() => import("../../components/CodeEditor"));

type Part = "details" | "settings" | "script" | "html";

// A working starting point: a clock showing the time in a place the user picks.
const STARTER: WidgetManifest = {
  name: "World clock",
  description: "The time in another city.",
  icon: "🕒",
  version: "1.0.0",
  size: { w: 3, h: 2, minW: 2, minH: 2 },
  settings: [
    { key: "zone", type: "text", label: "Time zone", default: "America/New_York" },
    { key: "label", type: "text", label: "Label", default: "New York" },
  ],
  hosts: [],
};

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

/** Makes or edits one of the user's own widgets: its details and settings from a form, its script and HTML in a code
 *  editor, and the widget running beside them at its minimum size. */
export default function WidgetEditorDialog({ open, widget, onClose, ...rest }: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      slotProps={{
        paper: {
          sx: {
            width: 1240,
            maxWidth: "calc(100% - 32px)",
            height: { xs: "calc(100% - 32px)", md: 780 },
            maxHeight: "calc(100% - 32px)",
            m: 2,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          },
        },
      }}
    >
      {/* Remounted per opening, so it starts from the widget it was opened for. */}
      {open && <Editor key={widget?.id ?? "new"} widget={widget} onClose={onClose} {...rest} />}
    </Dialog>
  );
}

function Editor({ widget, onClose, onSaved, onUnauthorized }: Omit<Props, "open">) {
  const { t } = useTranslation("app");
  const own = widget?.source === "own";
  const [part, setPart] = useState<Part>("details");
  const [draft, setDraft] = useState<Draft>(() => {
    if (!widget) {
      const starter = fromManifest({ ...STARTER, author: readUser()?.display_name }, "world-clock");
      return { ...starter, slugEdited: false };
    }
    // A community widget is copied to the user's own, under a name of its own.
    return fromManifest(widget.manifest, own ? widget.slug : `${widget.slug}-copy`.slice(0, 40));
  });
  const [script, setScript] = useState(widget?.script ?? STARTER_SCRIPT);
  const [html, setHtml] = useState(widget?.html ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const errors = useMemo(() => problems(draft), [draft]);
  const manifest = useMemo(() => toManifest(draft), [draft]);
  const settingErrors = Object.keys(errors).some((field) => field.startsWith("settings."));
  const detailErrors = Object.keys(errors).some((field) => !field.startsWith("settings."));
  const invalid = Object.keys(errors).length > 0 || !script.trim();

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await widgetsApi.save({
          slug: draft.slug.trim(),
          metadata: JSON.stringify(manifest),
          script,
          html: html.trim() ? html : null,
        }),
      );
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // A dot on a tab that has something to fix.
  const flagged = (label: string, flag: boolean) => (flag ? `${label} •` : label);

  return (
    <>
      <Box
        sx={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: 2,
          py: 1.25,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box sx={{ display: "flex", color: "primary.main" }}>
          <WidgetIcon icon={manifest.icon} iconUrl={manifest.iconUrl} size={20} />
        </Box>
        <Typography
          variant="body2"
          fontWeight={600}
          component="h2"
          noWrap
          sx={{ flex: 1, color: (muiTheme) => muiTheme.thingport.headingText }}
        >
          {own ? t("dashboard.custom.editor.editTitle") : t("dashboard.custom.editor.newTitle")}
          {manifest.name && (
            <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>
              {` · ${manifest.name}`}
            </Box>
          )}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label={t("dashboard.custom.editor.cancel")}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: { xs: "column-reverse", md: "row" } }}>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Box sx={{ px: 2.5, pt: 1.75, pb: 1.25, flexShrink: 0 }}>
            <Segmented
              label={t("dashboard.custom.editor.part")}
              value={part}
              onChange={setPart}
              options={[
                { value: "details", label: flagged(t("dashboard.custom.editor.details"), detailErrors) },
                {
                  value: "settings",
                  label: flagged(
                    t("dashboard.custom.editor.settingsCount", { count: draft.settings.length }),
                    settingErrors,
                  ),
                },
                { value: "script", label: t("dashboard.custom.editor.script") },
                { value: "html", label: t("dashboard.custom.editor.html") },
              ]}
            />
          </Box>
          {part === "details" || part === "settings" ? (
            <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 2.5, pt: 1, pb: 2.5 }}>
              {part === "details" ? (
                <DetailsForm
                  draft={draft}
                  errors={errors}
                  slugLocked={own}
                  onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
                />
              ) : (
                <SettingsEditor
                  settings={draft.settings}
                  errors={errors}
                  onChange={(settings) => setDraft((current) => ({ ...current, settings }))}
                />
              )}
            </Box>
          ) : (
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                mx: 2.5,
                mb: 2,
                border: 1,
                borderColor: "divider",
                borderRadius: "10px",
                overflow: "hidden",
              }}
            >
              <Suspense fallback={<Skeleton variant="rectangular" sx={{ height: "100%" }} />}>
                {part === "script" ? (
                  <CodeEditor
                    key="script"
                    language="javascript"
                    label={t("dashboard.custom.editor.script")}
                    value={script}
                    onChange={setScript}
                  />
                ) : (
                  <CodeEditor
                    key="html"
                    language="html"
                    label={t("dashboard.custom.editor.html")}
                    placeholder={t("dashboard.custom.editor.htmlPlaceholder")}
                    value={html}
                    onChange={setHtml}
                  />
                )}
              </Suspense>
            </Box>
          )}
        </Box>

        <Box
          sx={{
            width: { xs: "100%", md: 460 },
            height: { xs: 260, md: "auto" },
            flexShrink: 0,
            borderStyle: "solid",
            borderColor: "divider",
            borderWidth: { xs: "0 0 1px 0", md: "0 0 0 1px" },
            bgcolor: (muiTheme) => muiTheme.thingport.pageBackground,
          }}
        >
          <WidgetPreview manifest={manifest} script={script} html={html} widgetId={own ? widget!.id : null} />
        </Box>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mx: 2, mt: 1.5, whiteSpace: "pre-wrap" }}>
          {error}
        </Alert>
      )}
      <Box
        sx={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1.25,
          borderTop: 1,
          borderColor: "divider",
        }}
      >
        <ShieldOutlinedIcon fontSize="small" sx={{ color: "warning.main" }} />
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
          {t("dashboard.custom.editor.trust")}
        </Typography>
        <Button onClick={onClose}>{t("dashboard.custom.editor.cancel")}</Button>
        <Tooltip title={invalid ? t("dashboard.custom.editor.fixFirst") : ""}>
          <span>
            <Button variant="contained" onClick={() => void save()} disabled={saving || invalid}>
              {t("dashboard.custom.editor.save")}
            </Button>
          </span>
        </Tooltip>
      </Box>
    </>
  );
}
