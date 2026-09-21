import { alpha, createTheme, darken, type Theme, type ThemeOptions } from "@mui/material/styles";
import type { ResolvedTheme } from "./constants/settingsOptions";

export type { ResolvedTheme };

export const THEME_IDS: ResolvedTheme[] = ["light", "dark"];

const BODY_FONT_STACK =
  '"Open Sans", "system-ui", "Segoe UI", Roboto, Oxygen, Ubuntu, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif';
/** The brand/display face used for h5/h6 (page and section titles) -- kept as one exported
 *  constant so every usage stays in sync. */
export const DISPLAY_FONT_STACK = '"Thingport", sans-serif';

/**
 * Extra design tokens MUI's Theme doesn't model natively: the page background (a plain color
 * for light/dark, a layered radial-gradient CSS value for the neon/purple/blue themes) and the
 * three.js model material colors used by ModelViewer's paletteForTheme().
 */
declare module "@mui/material/styles" {
  interface Theme {
    thingport: {
      pageBackground: string;
      modelColor: string;
      modelEmissive: string;
      /** A separate accent used for things that shouldn't compete with the primary green
       *  (e.g. an attention/alert-style label) -- not one of MUI's error/warning palette
       *  roles, just a second brand-adjacent color for cases that call for it. */
      altText: string;
      /** Unselected nav-row label/icon color for the Sidebar rail and the Models page's
       *  Categories box -- narrower than text.secondary (which is used all over for ordinary
       *  muted text) so recoloring nav rows can't leak into unrelated UI. */
      navInactiveText: string;
      /** Selected nav row background (Sidebar rail rows, Categories box rows) -- a `background`
       *  (not `bgcolor`) value since dark mode's is a left-to-right gradient, not a flat color;
       *  light mode's is still just a flat tint expressed the same way. */
      selectedNavBackground: string;
      /** Selected nav row label/icon color -- the brand accent in dark mode, unchanged
       *  (inherited) text color in light mode. */
      selectedNavText: string;
      /** Heading/emphasis text (dashboard stat numbers and pane headers, a model card's title,
       *  the model detail page's "Description"/"Tags" headlines, etc.) -- plain white in dark
       *  mode for contrast against those panes' backgrounds, unchanged (text.primary) in light. */
      headingText: string;
    };
  }
  interface ThemeOptions {
    thingport: {
      pageBackground: string;
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

// Values ported 1:1 from the original CSS custom properties so the visual identity of each
// theme carries over even though the implementation is now an MUI theme object.
const THEME_DEFS: Record<ResolvedTheme, ThemeDef> = {
  light: {
    mode: "light",
    pageBackground: "#f7f7f7",
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
    // Matches the pre-existing collapsed-rail icon treatment (selected -> primary.main).
    selectedNavText: "#00b800",
    headingText: "#1f1f1f", // == text above; unused in light mode's actual styling either way
  },
  dark: {
    mode: "dark",
    pageBackground: "#181f39",
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
      MuiButton: { styleOverrides: { root: { borderRadius: 8 } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 6 } } },
      MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: d.panelStrong, color: d.text } } },
      // A success toast (see ToastProvider) should always read as "this worked" in the brand
      // green (#00b800) with white text -- e.g. favoriting a model -- not MUI's own default
      // success palette, in either theme.
      MuiAlert: {
        styleOverrides: {
          filledSuccess: { backgroundColor: d.accent, color: d.accentContrast },
          // Dark mode only: MUI's default standard/outlined alerts use fixed near-black tints
          // (darken(color, 0.9)) that read as muddy black boxes on this theme's navy panels. A
          // translucent tint of the severity color instead lets the panel show through, with a
          // matching hairline border and light text. Success uses the brand green, like the
          // success toast above. Filled alerts (toasts) keep their own solid styling.
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
      // Dark mode is deliberately square everywhere -- corners, chips, avatars, the back-to-top
      // FAB, all of it. `sx`-set radii (the vast majority of them: cards, panels, the info box,
      // etc.) beat theme.shape.borderRadius and component styleOverrides alike, so nothing short
      // of an !important global rule reaches all of them; MuiCssBaseline's styleOverrides is
      // exactly the escape hatch for page-level CSS the theme needs to own like this.
      ...(d.mode === "dark"
        ? { MuiCssBaseline: { styleOverrides: "*, *::before, *::after { border-radius: 0 !important; }" } }
        : {}),
    },
    thingport: {
      pageBackground: d.pageBackground,
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

/** textSubtle isn't part of MUI's palette shape; components that need it read this directly. */
export function subtleTextColor(id: ResolvedTheme): string {
  return THEME_DEFS[id].textSubtle;
}

/** accentSoft (a translucent tint of the accent color) isn't part of MUI's palette shape either. */
export function accentSoftColor(id: ResolvedTheme): string {
  return THEME_DEFS[id].accentSoft;
}

/** The one `borderColor` every container-edge/column-divider border in the app should use: the
 *  theme's divider color (`palette.divider`, i.e. `theme.thingport.border`/`borderStrong`'s light-
 *  mode value) in light mode, invisible in dark mode -- dark mode's panels already contrast against
 *  the page background on their own, so an explicit border there reads as an unwanted extra line
 *  rather than a separator. Shared by Sidebar, CategoriesPanel, ModelSidePanel, and AuthorPage's
 *  profile-column divider so all four can never drift from each other; use as
 *  `sx={{ borderColor: dividerBorderColor, ... }}`. */
export function dividerBorderColor(theme: Theme): string {
  return theme.palette.mode === "dark" ? "transparent" : "divider";
}
