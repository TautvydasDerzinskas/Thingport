import { alpha, createTheme, darken, type Theme, type ThemeOptions } from "@mui/material/styles";
import type { ResolvedTheme } from "./constants/settingsOptions";

export type { ResolvedTheme };

export const THEME_IDS: ResolvedTheme[] = ["light", "dark"];

const BODY_FONT_STACK =
  '"Open Sans", "system-ui", "Segoe UI", Roboto, Oxygen, Ubuntu, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif';
export const DISPLAY_FONT_STACK = '"Thingport", sans-serif';

/** Tokens MUI's Theme doesn't model: the page background and three.js material colors. */
declare module "@mui/material/styles" {
  interface Theme {
    thingport: {
      pageBackground: string;
      /** A second-level menu beside the sidebar: unlike both it and the page, so the tiers read apart. */
      subnavBackground: string;
      modelColor: string;
      modelEmissive: string;
      /** A secondary accent that doesn't compete with the primary green. */
      altText: string;
      /** Separate from text.secondary so recoloring nav rows can't leak into unrelated UI. */
      navInactiveText: string;
      /** A `background` value: dark mode's is a gradient. */
      selectedNavBackground: string;
      selectedNavText: string;
      /** White in dark mode, text.primary in light. */
      headingText: string;
    };
  }
  interface ThemeOptions {
    thingport: {
      pageBackground: string;
      subnavBackground: string;
      modelColor: string;
      modelEmissive: string;
      altText: string;
      navInactiveText: string;
      selectedNavBackground: string;
      selectedNavText: string;
      headingText: string;
    };
  }
}

type ThemeDef = {
  mode: "light" | "dark";
  pageBackground: string;
  subnavBackground: string;
  panel: string;
  panelStrong: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  accentLight: string;
  accentStrong: string;
  accentSoft: string;
  accentContrast: string;
  altText: string;
  modelColor: string;
  modelEmissive: string;
  navInactiveText: string;
  selectedNavBackground: string;
  selectedNavText: string;
  headingText: string;
};

const THEME_DEFS: Record<ResolvedTheme, ThemeDef> = {
  light: {
    mode: "light",
    pageBackground: "#f7f7f7",
    // A shade under the page, faintly green: neither the white sidebar nor the content.
    subnavBackground: "#ecf1ec",
    panel: "#ffffff",
    panelStrong: "#ffffff",
    border: "#ebebeb",
    borderStrong: "#ebebeb",
    text: "#1f1f1f",
    textMuted: "#858585",
    textSubtle: "#858585",
    accent: "#00b800",
    accentLight: "#5be584",
    accentStrong: darken("#00b800", 0.15),
    accentSoft: alpha("#00b800", 0.16),
    accentContrast: "#ffffff",
    altText: "rgb(255, 114, 32)",
    modelColor: "#cbd5e1",
    modelEmissive: "#94a3b8",
    navInactiveText: "#858585",
    selectedNavBackground: alpha("#5be584", 0.2),
    selectedNavText: "#00b800",
    headingText: "#1f1f1f",
  },
  dark: {
    mode: "dark",
    pageBackground: "#181f39",
    // A step above the sidebar, which is a step above the page.
    subnavBackground: "#26315a",
    panel: "#1e2746",
    panelStrong: "#1e2746",
    border: "#333a54",
    borderStrong: "#333a54",
    text: "#828690",
    textMuted: "#828690",
    textSubtle: "#828690",
    accent: "#00b800",
    accentLight: "#5be584",
    accentStrong: darken("#00b800", 0.15),
    accentSoft: alpha("#00b800", 0.16),
    accentContrast: "#ffffff",
    altText: "rgb(255, 114, 32)",
    modelColor: "#e2e8f0",
    modelEmissive: "#475569",
    navInactiveText: "#969ba0",
    selectedNavBackground: "linear-gradient(to right, rgb(24, 31, 57) 0%, rgba(49, 206, 255, 0) 100%)",
    selectedNavText: "#00b800",
    headingText: "#ffffff",
  },
};

/** The veil behind modals and the open search. */
export function veilColor(mode: "light" | "dark"): string {
  return mode === "dark" ? "rgba(0, 0, 0, 0.5)" : "rgba(255, 255, 255, 0.6)";
}
export const VEIL_BLUR = "blur(1.5px)";

export function buildTheme(id: ResolvedTheme): Theme {
  const d = THEME_DEFS[id];
  const options: ThemeOptions = {
    palette: {
      mode: d.mode,
      background: { default: d.pageBackground, paper: d.panel },
      primary: { main: d.accent, light: d.accentLight, dark: d.accentStrong, contrastText: d.accentContrast },
      text: { primary: d.text, secondary: d.textMuted },
      divider: d.border,
      action: {
        selected: alpha(d.accentLight, 0.2),
        hover: alpha(d.accent, 0.08),
      },
    },
    shape: { borderRadius: d.mode === "dark" ? 0 : 10 },
    typography: {
      fontSize: 13,
      fontFamily: BODY_FONT_STACK,
      button: { textTransform: "none", fontWeight: 600 },
      h5: { fontFamily: DISPLAY_FONT_STACK, fontWeight: 500 },
      h6: { fontFamily: DISPLAY_FONT_STACK, fontWeight: 500 },
    },
    components: {
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none", backgroundColor: d.panel } } },
      MuiAppBar: { styleOverrides: { root: { backgroundColor: d.panelStrong, color: d.text } } },
      MuiDrawer: { styleOverrides: { paper: { backgroundColor: d.panelStrong, borderColor: d.border } } },
      // Menus and popovers have an invisible backdrop, which stays so.
      MuiBackdrop: {
        styleOverrides: {
          root: ({ ownerState }) =>
            ownerState.invisible ? {} : { backgroundColor: veilColor(d.mode), backdropFilter: VEIL_BLUR },
        },
      },
      MuiButton: { styleOverrides: { root: { borderRadius: 8 } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 6 } } },
      MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: d.panelStrong, color: d.text } } },
      // Success toasts always use the brand green, not MUI's success palette.
      MuiAlert: {
        styleOverrides: {
          filledSuccess: { backgroundColor: d.accent, color: d.accentContrast },
          // MUI's dark alerts are near-black boxes on navy panels; use a translucent severity tint instead.
          // Filled alerts (toasts) keep their own styling.
          ...(d.mode === "dark"
            ? {
                root: ({ ownerState, theme }) => {
                  if (ownerState.variant === "filled") return {};
                  const severity = ownerState.severity ?? "success";
                  const color = severity === "success" ? d.accent : theme.palette[severity].main;
                  return {
                    backgroundColor: alpha(color, ownerState.variant === "outlined" ? 0.04 : 0.1),
                    border: `1px solid ${alpha(color, ownerState.variant === "outlined" ? 0.6 : 0.35)}`,
                    color: alpha("#ffffff", 0.8),
                    "& .MuiAlert-icon": { color },
                    "& .MuiAlertTitle-root": { color: d.headingText },
                  };
                },
              }
            : {}),
        },
      },
      // Dark mode is square everywhere. `sx` radii beat theme overrides, so only a global !important
      // rule reaches them all.
      ...(d.mode === "dark"
        ? { MuiCssBaseline: { styleOverrides: "*, *::before, *::after { border-radius: 0 !important; }" } }
        : {}),
    },
    thingport: {
      pageBackground: d.pageBackground,
      subnavBackground: d.subnavBackground,
      modelColor: d.modelColor,
      modelEmissive: d.modelEmissive,
      altText: d.altText,
      navInactiveText: d.navInactiveText,
      selectedNavBackground: d.selectedNavBackground,
      selectedNavText: d.selectedNavText,
      headingText: d.headingText,
    },
  };
  return createTheme(options);
}

export function subtleTextColor(id: ResolvedTheme): string {
  return THEME_DEFS[id].textSubtle;
}

export function accentSoftColor(id: ResolvedTheme): string {
  return THEME_DEFS[id].accentSoft;
}

/** The border colour for container edges: the divider in light mode, invisible in dark mode where
 *  panels already contrast with the background. */
export function dividerBorderColor(theme: Theme): string {
  return theme.palette.mode === "dark" ? "transparent" : "divider";
}
