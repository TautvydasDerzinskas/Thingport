// @ts-check
// Code blocks (Expressive Code, through Starlight) in the docs and on the blog, framed like the site's panels: its
// borders and radius (square in dark mode), its code background, and no shadow. Colours and type are tokens from
// tokens.css, which both kinds of page load (the blog doesn't load Starlight's own tokens).
import { defineEcConfig } from "@astrojs/starlight/expressive-code";

export default defineEcConfig({
  // Light first, as everywhere on the site; Starlight switches them on data-theme.
  themes: ["github-light", "github-dark"],
  // The header's toggle picks the theme, not the visitor's OS.
  useDarkModeMediaQuery: false,
  styleOverrides: {
    borderColor: "var(--border)",
    borderRadius: "var(--radius-sm)",
    codeBackground: "var(--code-bg)",
    // Starlight's defaults for these read its own tokens; these are the values they had in the docs.
    codeFontFamily: "var(--font-mono)",
    codeFontSize: "0.875rem",
    codeLineHeight: "1.65",
    uiFontFamily: "var(--font-body)",
    focusBorder: "var(--link)",
    frames: {
      frameBoxShadowCssValue: "none",
      editorTabBarBackground: "var(--code-bar-bg)",
      editorTabBarBorderBottomColor: "var(--border)",
      editorActiveTabBackground: "var(--code-bg)",
      editorActiveTabForeground: "var(--heading)",
      editorActiveTabIndicatorTopColor: "var(--accent)",
      editorActiveTabIndicatorBottomColor: "transparent",
      terminalBackground: "var(--code-bg)",
      terminalTitlebarBackground: "var(--code-bar-bg)",
      terminalTitlebarForeground: "var(--text-muted)",
      terminalTitlebarBorderBottomColor: "var(--border)",
      terminalTitlebarDotsForeground: "var(--code-dots)",
      inlineButtonForeground: "var(--text-muted)",
      inlineButtonBackground: "var(--text-muted)",
      inlineButtonBorder: "var(--border)",
      inlineButtonBorderOpacity: "1",
      tooltipSuccessBackground: "var(--button)",
      tooltipSuccessForeground: "var(--button-text)",
    },
  },
});
