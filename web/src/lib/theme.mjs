// The site is light unless the visitor picks dark with the header's toggle, on its own pages and the docs alike. No
// imports, as ThemeToggle.astro's script takes this to the browser.

/** Where the visitor's choice is kept: "dark", or nothing for light. */
export const THEME_KEY = "thingport-theme";

/** The browser's own colour around the page (theme-color), each theme's --bg in tokens.css. */
export const THEME_COLORS = { light: "#f7f7f7", dark: "#181f39" };
