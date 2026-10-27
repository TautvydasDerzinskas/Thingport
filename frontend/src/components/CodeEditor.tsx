import { useEffect, useRef } from "react";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { tags } from "@lezer/highlight";

// JSON is highlighted by the JavaScript grammar, which reads it exactly: no separate mode to carry. OpenSCAD is
// close enough to be read by it too -- the same comments, numbers, strings and brackets -- and its own grammar
// would be another dependency for a panel that only ever shows a script, never edits one.
export type CodeLanguage = "javascript" | "html" | "json" | "scad";

type Props = {
  value: string;
  onChange: (value: string) => void;
  language: CodeLanguage;
  /** Its accessible name. */
  label: string;
  placeholder?: string;
  /** Shown but not editable, for code the reader owns nowhere else: the cursor and selection still work. */
  readOnly?: boolean;
};

/** The editor's look, from the app theme so it follows light and dark and the accent. */
function themeOf(theme: Theme) {
  const { palette } = theme;
  const mono = '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  return [
    EditorView.theme(
      {
        "&": { height: "100%", fontSize: "13px", color: palette.text.primary, backgroundColor: "transparent" },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": { fontFamily: mono, lineHeight: 1.6 },
        ".cm-content": { caretColor: palette.primary.main, padding: "10px 0" },
        ".cm-cursor": { borderLeftColor: palette.primary.main },
        ".cm-gutters": { backgroundColor: "transparent", color: palette.text.disabled, border: "none" },
        ".cm-activeLineGutter": { backgroundColor: "transparent", color: palette.text.secondary },
        ".cm-activeLine": { backgroundColor: palette.action.hover },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
          backgroundColor: `${alpha(palette.primary.main, 0.25)} !important`,
        },
        ".cm-matchingBracket": { backgroundColor: palette.action.selected, outline: "none" },
        ".cm-placeholder": { color: palette.text.disabled },
        ".cm-tooltip": {
          backgroundColor: palette.background.paper,
          border: `1px solid ${palette.divider}`,
          borderRadius: "8px",
        },
        ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
          backgroundColor: palette.action.selected,
          color: palette.text.primary,
        },
        ".cm-foldPlaceholder": { backgroundColor: palette.action.hover, border: "none", color: palette.text.secondary },
      },
      { dark: palette.mode === "dark" },
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        {
          tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword],
          color: palette.primary.main,
        },
        { tag: [tags.string, tags.special(tags.string), tags.attributeValue], color: palette.success.main },
        { tag: [tags.number, tags.bool, tags.null, tags.atom], color: palette.warning.main },
        { tag: [tags.comment, tags.blockComment, tags.lineComment], color: palette.text.disabled, fontStyle: "italic" },
        { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: palette.info.main },
        { tag: [tags.tagName, tags.angleBracket], color: palette.error.main },
        { tag: tags.attributeName, color: palette.warning.main },
        { tag: [tags.propertyName, tags.definition(tags.variableName)], color: palette.text.primary },
        { tag: [tags.className, tags.typeName], color: palette.info.main },
        { tag: tags.invalid, color: palette.error.main },
      ]),
    ),
  ];
}

/** A code editor with highlighting, line numbers, bracket matching and completion. Tab indents; Escape then Tab
 *  leaves it, as CodeMirror does for keyboard users. */
export default function CodeEditor({ value, onChange, language, label, placeholder, readOnly }: Props) {
  const muiTheme = useTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeSlot = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          language === "html" ? html() : javascript(),
          themeSlot.current.of(themeOf(muiTheme)),
          ...(readOnly ? [EditorState.readOnly.of(true)] : []),
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
          ...(placeholder ? [placeholderText(placeholder)] : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The language, label and read-only-ness are fixed for an editor's life; value and theme are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeSlot.current.reconfigure(themeOf(muiTheme)) });
  }, [muiTheme]);

  // A value set from outside, such as another widget opened in the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <Box ref={hostRef} sx={{ height: "100%", minHeight: 0, overflow: "hidden" }} />;
}
