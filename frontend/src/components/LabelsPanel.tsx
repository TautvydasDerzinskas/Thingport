import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { SUPPORTED_LANGUAGES } from "../constants/languages";
import HelpTip from "./HelpTip";
import { useConfirm } from "./ConfirmProvider";

const CodeEditor = lazy(() => import("./CodeEditor"));

/** The language a widget or a tool falls back to, key by key, for anything another language hasn't got. */
export const FALLBACK_LANGUAGE = "en";

/** Each language's file as the person is typing it, which may not be valid JSON yet. */
export type LabelDrafts = Record<string, string>;

type Props = {
  drafts: LabelDrafts;
  onChange: (drafts: LabelDrafts) => void;
  /** Which language is open; kept outside so switching parts doesn't lose it. */
  code: string;
  onCode: (code: string) => void;
  /** What this is, in the caller's own words: a widget's labels and a tool's are explained differently. */
  help: string;
  /** What to say before there are any, which is also where the first language is added from. */
  empty: string;
};

/** What's wrong with a language's file, or null when it reads. */
export function labelProblem(text: string): "json" | "shape" | null {
  if (!text.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "json";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "shape";
  return Object.values(parsed as Record<string, unknown>).every((value) => typeof value === "string") ? null : "shape";
}

/** The drafts as the server takes them; anything that doesn't read is left out. */
export function labelsOf(drafts: LabelDrafts): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [code, text] of Object.entries(drafts)) {
    if (labelProblem(text) || !text.trim()) continue;
    const parsed = JSON.parse(text) as Record<string, string>;
    if (Object.keys(parsed).length) out[code] = parsed;
  }
  return out;
}

/**
 * The words a widget or a tool shows, one file per language, kept out of its script so they can be read, reviewed
 * and translated as text. The script asks for them by key through `thingport.t()`.
 */
export default function LabelsPanel({ drafts, onChange, code, onCode, help, empty }: Props) {
  const { t } = useTranslation("app");
  const confirm = useConfirm();
  const [adding, setAdding] = useState<HTMLElement | null>(null);

  const codes = useMemo(() => {
    const present = Object.keys(drafts);
    // English first, then as Thingport lists them, then anything the tool has that Thingport doesn't.
    const known = SUPPORTED_LANGUAGES.map((language) => language.code).filter((one) => present.includes(one));
    return [...new Set([...known, ...present])];
  }, [drafts]);

  const missing = SUPPORTED_LANGUAGES.filter((language) => !codes.includes(language.code));
  const open = codes.includes(code) ? code : (codes[0] ?? "");
  const text = drafts[open] ?? "";
  const problem = labelProblem(text);

  // The keys English has that this language hasn't: what's left to translate.
  const untranslated = useMemo(() => {
    if (open === FALLBACK_LANGUAGE || problem) return 0;
    const english = labelProblem(drafts[FALLBACK_LANGUAGE] ?? "") ? {} : labelsOf(drafts)[FALLBACK_LANGUAGE];
    const here = labelsOf(drafts)[open];
    if (!english || !here) return 0;
    return Object.keys(english).filter((key) => !(key in here)).length;
  }, [drafts, open, problem]);

  const add = (language: string) => {
    setAdding(null);
    // A new language starts from English's keys with the words blanked, so there's a list to work down.
    const english = labelsOf(drafts)[FALLBACK_LANGUAGE];
    const starter = english
      ? JSON.stringify(Object.fromEntries(Object.keys(english).map((key) => [key, ""])), null, 2)
      : '{\n  "hello": ""\n}';
    onChange({ ...drafts, [language]: starter });
    onCode(language);
  };

  const remove = async (language: string) => {
    const name = SUPPORTED_LANGUAGES.find((one) => one.code === language)?.label ?? language;
    const title = t("labelsPanel.removeTitle", { name });
    if (!(await confirm({ title, message: t("labelsPanel.removeBody"), destructive: true }))) return;
    const next = { ...drafts };
    delete next[language];
    onChange(next);
    onCode(Object.keys(next)[0] ?? FALLBACK_LANGUAGE);
  };

  if (!codes.length) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, alignItems: "flex-start", p: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: "62ch" }}>
          {empty}
        </Typography>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => add(FALLBACK_LANGUAGE)}>
          {t("labelsPanel.start")}
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minHeight: 0, height: "100%" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        {codes.map((one) => {
          const language = SUPPORTED_LANGUAGES.find((item) => item.code === one);
          return (
            <Chip
              key={one}
              size="small"
              label={language ? language.label : one}
              color={one === open ? "primary" : "default"}
              variant={one === open ? "filled" : "outlined"}
              onClick={() => onCode(one)}
              onDelete={one === FALLBACK_LANGUAGE ? undefined : () => void remove(one)}
              deleteIcon={<DeleteOutlineIcon />}
            />
          );
        })}
        {missing.length > 0 && (
          <Tooltip title={t("labelsPanel.add")}>
            <IconButton size="small" onClick={(event) => setAdding(event.currentTarget)}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Menu anchorEl={adding} open={Boolean(adding)} onClose={() => setAdding(null)}>
          {missing.map((language) => (
            <MenuItem key={language.code} onClick={() => add(language.code)}>
              {language.label}
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {language.code}
              </Typography>
            </MenuItem>
          ))}
        </Menu>
        <Box sx={{ flex: 1 }} />
        <HelpTip text={help} />
      </Box>

      {problem && <Alert severity="error">{t(`labelsPanel.${problem === "json" ? "badJson" : "badShape"}`)}</Alert>}
      {!problem && open === FALLBACK_LANGUAGE && (
        <Typography variant="caption" color="text.secondary">
          {t("labelsPanel.fallbackNote")}
        </Typography>
      )}
      {!problem && untranslated > 0 && (
        <Typography variant="caption" color="warning.main">
          {t("labelsPanel.untranslated", { count: untranslated })}
        </Typography>
      )}

      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Suspense fallback={<Skeleton variant="rounded" height="100%" />}>
          <CodeEditor
            key={open}
            language="json"
            label={t("labelsPanel.file", { code: open })}
            value={text}
            onChange={(next) => onChange({ ...drafts, [open]: next })}
          />
        </Suspense>
      </Box>
    </Box>
  );
}
