import type { Theme } from "@mui/material/styles";
import type { SdkTheme } from "./types";

// Thingport's colours, as a widget's or a tool's script gets them.
//
// They come twice over: as an object on `thingport.theme`, for a script that computes with them, and as CSS
// variables on the element the script draws into, so a stylesheet in the HTML can use `var(--tp-accent)` without
// the script copying anything across. Copying them by hand is where a widget or tool usually stops looking like
// the rest of Thingport, so neither has to.

export type { SdkTheme };

/** The theme as a script sees it. */
export function sdkTheme(theme: Theme): SdkTheme {
  return {
    mode: theme.palette.mode,
    primary: theme.palette.primary.main,
    primaryContrast: theme.palette.primary.contrastText,
    background: theme.thingport.pageBackground,
    paper: theme.palette.background.paper,
    text: theme.palette.text.primary,
    textSecondary: theme.palette.text.secondary,
    divider: theme.palette.divider,
    error: theme.palette.error.main,
    warning: theme.palette.warning.main,
    success: theme.palette.success.main,
    fontFamily: String(theme.typography.fontFamily),
  };
}

/** Each colour's CSS variable, so the names are in one place: scripts/sync-sdk-docs.mjs reads them from here for the
 *  reference. */
export const THEME_VARIABLES: Record<keyof SdkTheme, string | null> = {
  mode: null, // not a colour: a script reads it from `theme.mode`
  primary: "--tp-accent",
  primaryContrast: "--tp-accent-ink",
  background: "--tp-background",
  paper: "--tp-paper",
  text: "--tp-text",
  textSecondary: "--tp-text-muted",
  divider: "--tp-divider",
  error: "--tp-error",
  warning: "--tp-warning",
  success: "--tp-success",
  fontFamily: "--tp-font",
};

/** Writes the theme onto the element a script draws into, as the `--tp-*` variables. */
export function setThemeVariables(element: HTMLElement, theme: SdkTheme): void {
  for (const [name, variable] of Object.entries(THEME_VARIABLES)) {
    if (variable) element.style.setProperty(variable, theme[name as keyof SdkTheme]);
  }
}
