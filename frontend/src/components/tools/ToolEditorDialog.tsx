import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CloseIcon from "@mui/icons-material/Close";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import ReplayIcon from "@mui/icons-material/Replay";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import { UnauthorizedError } from "../../api/client";
import { toolsApi, type Tool } from "../../api/tools";
import { readUser } from "../../utils/auth";
import Segmented from "../controls/Segmented";
import HelpTip from "../HelpTip";
import AiToolGuide from "./AiToolGuide";
import ToolDetailsForm, { fromManifest, problems, toManifest, type ToolDraft } from "./ToolDetailsForm";
import ToolIcon from "./ToolIcon";
import ToolRunner from "./ToolRunner";
import LabelsPanel, { FALLBACK_LANGUAGE, labelProblem, labelsOf, type LabelDrafts } from "../LabelsPanel";
import { STARTER_HTML, STARTER_MANIFEST, STARTER_SCRIPT } from "./toolStarter";
import type { RunnableTool } from "./toolSdk";

// Loaded with the editor only, so the Tools page doesn't carry CodeMirror.
const CodeEditor = lazy(() => import("../CodeEditor"));

type Part = "details" | "script" | "html" | "labels" | "preview";

// What a tool's script can reach, beside the script: the starter shows each in use.
const SDK: { name: string; key: string }[] = [
  { name: "root, selector", key: "root" },
  { name: "theme", key: "theme" },
  { name: "size, onResize(fn)", key: "size" },
  { name: "storage.get / set / remove / keys", key: "storage" },
  { name: "collections.list / get / create", key: "collections" },
  { name: "collections.models / add / remove", key: "collectionModels" },
  { name: "collections.pick({ title })", key: "pick" },
  { name: "models.list / search / get", key: "models" },
  { name: "models.file(id, fileId?)", key: "file" },
  { name: "models.create({ …, files })", key: "create" },
  { name: "models.addFiles / addImages / replaceFile / update", key: "edit" },
  { name: "models.open(id)", key: "open" },
  { name: "toolModels()", key: "toolModels" },
  { name: "fetch(url, init)", key: "fetch" },
  { name: "api(path, init)", key: "api" },
  { name: "download({ name, data })", key: "download" },
  { name: "ui.toast / confirm / close", key: "ui" },
  { name: "t(key, vars)", key: "translate" },
  { name: "language, languages", key: "language" },
  { name: "library(name), libraries", key: "library" },
];

// A cheap fingerprint of the code, so the preview runs it again only when it changed.
function fingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

type Props = {
  open: boolean;
  /** The tool to edit; null makes a new one. */
  tool: Tool | null;
  onClose: () => void;
  onSaved: (tool: Tool) => void;
  onUnauthorized?: () => void;
};

/** Makes or edits one of the user's own tools: its details from a form, its script and HTML with CSS in a code editor,
 *  and the tool running on a tab of its own. */
export default function ToolEditorDialog({ open, tool, onClose, ...rest }: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      slotProps={{
        paper: {
          sx: {
            width: 1180,
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
      {/* Remounted per opening, so it starts from the tool it was opened for. */}
      {open && <Editor key={tool?.id ?? "new"} tool={tool} onClose={onClose} {...rest} />}
    </Dialog>
  );
}

function Editor({ tool, onClose, onSaved, onUnauthorized }: Omit<Props, "open">) {
  const { t } = useTranslation("app");
  const [part, setPart] = useState<Part>("details");
  const [draft, setDraft] = useState<ToolDraft>(() =>
    tool
      ? fromManifest(tool.manifest, tool.slug)
      : { ...fromManifest({ ...STARTER_MANIFEST, author: readUser()?.display_name }, "cube-maker"), slugEdited: false },
  );
  const [script, setScript] = useState(tool?.script ?? STARTER_SCRIPT);
  const [html, setHtml] = useState(tool?.html ?? STARTER_HTML);
  // Each language's file as text, so a half-typed one can sit there without being thrown away.
  const [labels, setLabels] = useState<LabelDrafts>(() =>
    Object.fromEntries(
      Object.entries(tool?.locales ?? {}).map(([code, words]) => [code, JSON.stringify(words, null, 2)]),
    ),
  );
  const [labelCode, setLabelCode] = useState(FALLBACK_LANGUAGE);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reference, setReference] = useState(true);
  const [run, setRun] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const aiButton = useRef<HTMLButtonElement>(null);

  const errors = useMemo(() => problems(draft), [draft]);
  const badLabels = useMemo(() => Object.keys(labels).filter((code) => labelProblem(labels[code])), [labels]);
  const manifest = useMemo(() => toManifest(draft), [draft]);
  const invalid = Object.keys(errors).length > 0 || !script.trim() || badLabels.length > 0;

  // The preview: built when its tab opens, and again on "Run again".
  const preview = useMemo((): RunnableTool | null => {
    if (part !== "preview") return null;
    return {
      id: tool?.id ?? null,
      slug: draft.slug,
      source: "own",
      manifest,
      script,
      html: html.trim() ? html : null,
      locales: labelsOf(labels),
      sha: `draft-${fingerprint(`${script}\0${html}\0${JSON.stringify(labels)}\0${run}`)}`,
    };
    // Only what it runs; the details it shows come along with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part, script, html, labels, run, tool?.id]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await toolsApi.save({
          slug: draft.slug.trim(),
          metadata: JSON.stringify({ ...manifest, locales: Object.keys(labelsOf(labels)) }),
          script,
          html: html.trim() ? html : null,
          locales: labelsOf(labels),
        }),
      );
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const detailErrors = Object.keys(errors).length > 0;

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
          <ToolIcon iconUrl={manifest.iconUrl} size={20} />
        </Box>
        <Typography
          variant="body2"
          fontWeight={600}
          component="h2"
          noWrap
          sx={{ flex: 1, color: (muiTheme) => muiTheme.thingport.headingText }}
        >
          {tool ? t("tools.editor.editTitle") : t("tools.editor.newTitle")}
          {manifest.name && (
            <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>
              {` · ${manifest.name}`}
            </Box>
          )}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label={t("tools.editor.cancel")}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ px: 2.5, pt: 1.75, pb: 1.25, flexShrink: 0, display: "flex", alignItems: "center", gap: 1 }}>
        <Segmented
          label={t("tools.editor.part")}
          value={part}
          onChange={setPart}
          options={[
            { value: "details", label: detailErrors ? `${t("tools.editor.details")} •` : t("tools.editor.details") },
            { value: "script", label: t("tools.editor.script") },
            { value: "html", label: t("tools.editor.html") },
            {
              value: "labels",
              label: badLabels.length ? `${t("labelsPanel.tab")} •` : t("labelsPanel.tab"),
            },
            { value: "preview", label: t("tools.editor.preview") },
          ]}
        />
        {!tool && (
          <>
            <Typography variant="body2" color="text.secondary">
              {t("tools.ai.or")}
            </Typography>
            <Button
              ref={aiButton}
              size="small"
              variant="outlined"
              startIcon={<AutoAwesomeOutlinedIcon fontSize="small" />}
              onClick={() => setAiOpen(true)}
            >
              {t("tools.ai.open")}
            </Button>
          </>
        )}
        <Box sx={{ flex: 1 }} />
        {part === "script" && (
          <Tooltip title={reference ? t("tools.editor.hideReference") : t("tools.editor.showReference")}>
            <IconButton
              size="small"
              aria-pressed={reference}
              aria-label={t("tools.editor.reference")}
              onClick={() => setReference((value) => !value)}
              color={reference ? "primary" : "default"}
            >
              <MenuBookOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {part === "preview" && (
          <>
            <HelpTip text={tool ? t("tools.editor.previewHelpSaved") : t("tools.editor.previewHelp")} />
            <Tooltip title={t("tools.editor.rerun")}>
              <IconButton size="small" aria-label={t("tools.editor.rerun")} onClick={() => setRun((n) => n + 1)}>
                <ReplayIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        {part === "details" && (
          <Box sx={{ flex: 1, overflowY: "auto", px: 2.5, pt: 1, pb: 2.5 }}>
            <Box sx={{ maxWidth: 720 }}>
              <ToolDetailsForm
                draft={draft}
                errors={errors}
                slugLocked={Boolean(tool)}
                onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
              />
            </Box>
          </Box>
        )}
        {part === "labels" && (
          <Box sx={{ flex: 1, minHeight: 0, mx: 2.5, mb: 2 }}>
            <LabelsPanel
              drafts={labels}
              onChange={setLabels}
              code={labelCode}
              onCode={setLabelCode}
              help={t("tools.editor.labels.help")}
              empty={t("tools.editor.labels.empty")}
            />
          </Box>
        )}
        {(part === "script" || part === "html") && (
          <Box sx={{ flex: 1, minWidth: 0, display: "flex", gap: 1.5, mx: 2.5, mb: 2 }}>
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
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
                    label={t("tools.editor.script")}
                    value={script}
                    onChange={setScript}
                  />
                ) : (
                  <CodeEditor
                    key="html"
                    language="html"
                    label={t("tools.editor.html")}
                    placeholder={t("tools.editor.htmlPlaceholder")}
                    value={html}
                    onChange={setHtml}
                  />
                )}
              </Suspense>
            </Box>
            {part === "script" && reference && <Reference />}
          </Box>
        )}
        {part === "preview" && preview && (
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              mx: 2.5,
              mb: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: (muiTheme) => muiTheme.thingport.pageBackground,
              borderRadius: "10px",
              border: 1,
              borderColor: "divider",
              overflow: "hidden",
            }}
          >
            {/* The tool at the size its window opens at, or what fits of it. */}
            <Box
              sx={{
                width: manifest.window.width,
                height: manifest.window.height,
                maxWidth: "100%",
                maxHeight: "100%",
                bgcolor: "background.paper",
                boxShadow: 3,
                borderRadius: "8px",
                overflow: "hidden",
              }}
            >
              <ToolRunner
                key={preview.sha}
                tool={preview}
                onClose={() => setPart("details")}
                onUnauthorized={onUnauthorized}
              />
            </Box>
          </Box>
        )}
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
          {t("tools.editor.trust")}
        </Typography>
        <Button onClick={onClose}>{t("tools.editor.cancel")}</Button>
        <Tooltip title={invalid ? t("tools.editor.fixFirst") : ""}>
          <span>
            <Button variant="contained" onClick={() => void save()} disabled={saving || invalid}>
              {t("tools.editor.save")}
            </Button>
          </span>
        </Tooltip>
      </Box>
      {aiOpen && (
        <AiToolGuide
          onClose={() => {
            setAiOpen(false);
            // Once the editor is reachable again.
            requestAnimationFrame(() => aiButton.current?.focus());
          }}
        />
      )}
    </>
  );
}

/** The SDK at a glance, beside the script. */
function Reference() {
  const { t } = useTranslation("app");
  return (
    <Box
      component="aside"
      aria-label={t("tools.editor.reference")}
      sx={{
        width: 280,
        flexShrink: 0,
        display: { xs: "none", md: "block" },
        overflowY: "auto",
        border: 1,
        borderColor: "divider",
        borderRadius: "10px",
        p: 1.5,
      }}
    >
      <Typography
        variant="caption"
        component="h3"
        sx={{ fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "text.secondary" }}
      >
        {t("tools.editor.reference")}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, mb: 1.25 }}>
        {t("tools.editor.referenceIntro")}
      </Typography>
      <Box component="dl" sx={{ m: 0, display: "grid", gap: 1 }}>
        {SDK.map((entry) => (
          <Box key={entry.key}>
            <Box
              component="dt"
              sx={{ fontFamily: "monospace", fontSize: 12, color: "primary.main", wordBreak: "break-word" }}
            >
              thingport.{entry.name}
            </Box>
            <Box component="dd" sx={{ m: 0, fontSize: 12, color: "text.secondary" }}>
              {t(`tools.editor.sdk.${entry.key}`)}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
