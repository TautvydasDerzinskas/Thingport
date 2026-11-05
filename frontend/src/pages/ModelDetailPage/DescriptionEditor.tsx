import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import TitleIcon from "@mui/icons-material/Title";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import CodeIcon from "@mui/icons-material/Code";
import InsertLinkIcon from "@mui/icons-material/InsertLink";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import MarkdownDescription from "../../components/MarkdownDescription";
import { dividerBorderColor } from "../../theme";
import {
  applyEdit,
  insertImage,
  insertLink,
  toggleInline,
  toggleLines,
  type MarkdownEdit,
  type Selection,
} from "../../utils/markdownEdits";

type Builder = (current: string, sel: Selection) => MarkdownEdit;

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

/** The description field: Markdown source with a formatting toolbar, and a tab to preview it as
 *  the detail page shows it. */
export default function DescriptionEditor({ value, onChange, disabled }: Props) {
  const { t } = useTranslation("models");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const apply = (build: Builder) => {
    const textarea = inputRef.current;
    if (!textarea || disabled) return;
    const edit = build(textarea.value, { start: textarea.selectionStart, end: textarea.selectionEnd });
    const expected = applyEdit(textarea.value, edit);
    textarea.focus();
    textarea.setSelectionRange(edit.start, edit.end);
    // Through the browser's own editing, so ⌘Z undoes it like typing; it fires the change event.
    const applied = edit.insert
      ? document.execCommand("insertText", false, edit.insert)
      : document.execCommand("delete", false);
    if (!applied || textarea.value !== expected) onChange(expected);
    const select = () => textarea.setSelectionRange(edit.select.start, edit.select.end);
    select();
    // The fallback path re-renders before the new text is in place.
    requestAnimationFrame(select);
  };

  const placeholders = { text: t("edit.toolbar.linkText"), url: "https://" };
  const actions: { key: string; label: string; icon: ReactNode; edit: Builder; dividerBefore?: boolean }[] = [
    {
      key: "bold",
      label: `${t("edit.toolbar.bold")} (${MOD}B)`,
      icon: <FormatBoldIcon fontSize="small" />,
      edit: (v, s) => toggleInline(v, s, "bold", t("edit.toolbar.boldText")),
    },
    {
      key: "italic",
      label: `${t("edit.toolbar.italic")} (${MOD}I)`,
      icon: <FormatItalicIcon fontSize="small" />,
      edit: (v, s) => toggleInline(v, s, "italic", t("edit.toolbar.italicText")),
    },
    {
      key: "heading",
      label: t("edit.toolbar.heading"),
      icon: <TitleIcon fontSize="small" />,
      edit: (v, s) => toggleLines(v, s, "heading"),
    },
    {
      key: "bullet",
      label: t("edit.toolbar.bulletList"),
      icon: <FormatListBulletedIcon fontSize="small" />,
      edit: (v, s) => toggleLines(v, s, "bullet"),
      dividerBefore: true,
    },
    {
      key: "numbered",
      label: t("edit.toolbar.numberedList"),
      icon: <FormatListNumberedIcon fontSize="small" />,
      edit: (v, s) => toggleLines(v, s, "numbered"),
    },
    {
      key: "quote",
      label: t("edit.toolbar.quote"),
      icon: <FormatQuoteIcon fontSize="small" />,
      edit: (v, s) => toggleLines(v, s, "quote"),
    },
    {
      key: "code",
      label: t("edit.toolbar.code"),
      icon: <CodeIcon fontSize="small" />,
      edit: (v, s) => toggleInline(v, s, "code", t("edit.toolbar.codeText")),
    },
    {
      key: "link",
      label: `${t("edit.toolbar.link")} (${MOD}K)`,
      icon: <InsertLinkIcon fontSize="small" />,
      edit: (v, s) => insertLink(v, s, placeholders),
      dividerBefore: true,
    },
    {
      key: "image",
      label: t("edit.toolbar.image"),
      icon: <ImageOutlinedIcon fontSize="small" />,
      edit: (v, s) => insertImage(v, s, { ...placeholders, text: t("edit.toolbar.imageText") }),
    },
  ];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const key = { b: "bold", i: "italic", k: "link" }[e.key.toLowerCase()];
    const action = key && actions.find((a) => a.key === key);
    if (!action) return;
    e.preventDefault();
    apply(action.edit);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
        <Typography variant="body2" color="text.secondary">
          {t("detail.description")}
        </Typography>
        <Tabs value={tab} onChange={(_e, next) => setTab(next)} sx={{ minHeight: 32 }}>
          <Tab value="write" label={t("edit.descriptionWrite")} sx={{ minHeight: 32, py: 0.5 }} />
          <Tab value="preview" label={t("edit.descriptionPreview")} sx={{ minHeight: 32, py: 0.5 }} />
        </Tabs>
      </Box>
      {tab === "write" ? (
        <>
          <Box
            role="toolbar"
            aria-label={t("edit.toolbar.label")}
            sx={{ mt: 1, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.25 }}
          >
            {actions.map((action) => [
              action.dividerBefore && (
                <Divider key={`${action.key}-divider`} orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.75 }} />
              ),
              <Tooltip key={action.key} title={action.label}>
                <span>
                  <IconButton
                    size="small"
                    aria-label={action.label}
                    disabled={disabled}
                    // Keeps the textarea's selection: a focused button would take it.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => apply(action.edit)}
                  >
                    {action.icon}
                  </IconButton>
                </span>
              </Tooltip>,
            ])}
          </Box>
          <TextField
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            inputRef={inputRef}
            disabled={disabled}
            fullWidth
            multiline
            minRows={6}
            maxRows={20}
            placeholder={t("edit.descriptionPlaceholder")}
            helperText={t("edit.descriptionMarkdownHint")}
            inputProps={{ "aria-label": t("detail.description") }}
            sx={{ mt: 0.5, "& textarea": { fontFamily: "monospace", fontSize: "0.85rem" } }}
          />
        </>
      ) : (
        <Box
          sx={{
            mt: 1,
            p: 1.5,
            minHeight: 140,
            maxHeight: 480,
            overflowY: "auto",
            border: "1px solid",
            borderColor: dividerBorderColor,
            borderRadius: "4px",
          }}
        >
          {value.trim() ? (
            <MarkdownDescription markdown={value} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("detail.noDescription")}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
