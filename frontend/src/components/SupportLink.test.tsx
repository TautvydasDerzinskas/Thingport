import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@mui/material/styles";
import { describe, expect, it, vi } from "vitest";
import { SUPPORT_WAYS } from "../constants/website";
import en from "../i18n/locales/en.json";
import { buildTheme } from "../theme";
import SupportLink, { SupportDialog } from "./SupportLink";

// The real one renders into a portal, which needs a DOM.
vi.mock("@mui/material/Dialog", () => ({
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <dialog open>{children}</dialog> : null,
}));

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", defaultNS: "app", resources: { en: { app: en.app, common: en.common } } });

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={buildTheme("light")}>{node}</ThemeProvider>
    </I18nextProvider>,
  );

describe("SupportLink", () => {
  it("is a button opening a dialog, short or with the ask, and shows no dialog until clicked", () => {
    const short = wrap(<SupportLink />);
    expect(short).toContain("Love Thingport?");
    expect(short).not.toContain("Show your support");
    expect(short).toContain('aria-haspopup="dialog"');
    expect(short).not.toContain("<dialog");
    expect(wrap(<SupportLink long />)).toContain("Love Thingport? Show your support");
  });
});

describe("SupportDialog", () => {
  const html = wrap(<SupportDialog open onClose={() => undefined} />);

  it("opens each way's own site in a new tab, saying so to screen readers", () => {
    for (const way of SUPPORT_WAYS) {
      expect(html).toContain(`href="${way.url}"`);
      expect(html).toContain(way.name);
    }
    expect(html.match(/target="_blank"/g)).toHaveLength(SUPPORT_WAYS.length);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(SUPPORT_WAYS.length);
    expect(html.split(en.app.support.newTab).length - 1).toBe(SUPPORT_WAYS.length);
  });

  it("says what each way is, and can be put off", () => {
    expect(html).toContain(en.app.support.coffee);
    expect(html).toContain(en.app.support.sponsors);
    expect(html).toContain(en.app.support.later);
  });
});
