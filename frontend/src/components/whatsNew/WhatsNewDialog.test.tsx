import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@mui/material/styles";
import { describe, expect, it } from "vitest";
import type { ReleaseNoteItem, ReleaseNotes } from "../../api/releaseNotes";
import en from "../../i18n/locales/en.json";
import { buildTheme } from "../../theme";
import { WhatsNewContent } from "./WhatsNewDialog";

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", defaultNS: "app", resources: { en: { app: en.app, common: en.common } } });

const item = (title: string, highlight = false, kind: ReleaseNoteItem["kind"] = "feature"): ReleaseNoteItem => ({
  kind,
  title,
  description: null,
  scope: null,
  images: [],
  code: null,
  highlight,
  url: null,
});

const render = (extra: Partial<ReleaseNotes> = {}) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={buildTheme("light")}>
        <WhatsNewContent
          notes={{
            version: "1.7.0",
            source: "curated",
            title: "Open any 3MF file as if tailored for you",
            summary: null,
            items: [item("First", true), item("Second", true), item("Third")],
            releases_url: "https://github.com/o/r/releases",
            ...extra,
          }}
          onZoom={() => undefined}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );

describe("WhatsNewContent", () => {
  it("makes the first highlighted feature the top feature, and only that one", () => {
    const items = [item("Breaking", true, "breaking"), item("First", true), item("Second", true), item("Third")];
    const [, breaking, first, second] = render({ items }).split("<article");
    expect(breaking).toContain("Breaking");
    expect(first).toContain("First");
    expect(first).toContain(en.app.whatsNew.topFeature);
    expect(second).toContain("Second");
    for (const card of [breaking, second]) {
      expect(card).toContain(en.app.whatsNew.highlight);
      expect(card).not.toContain(en.app.whatsNew.topFeature);
    }
  });

  it("thanks each contributor with their GitHub picture, opening their profile in a new tab", () => {
    const html = render({ contributors: ["WEBzaytsev", "SeoliteQ"] });
    expect(html).toContain("Thanks to everyone who helped with 1.7.0");
    for (const login of ["WEBzaytsev", "SeoliteQ"]) {
      expect(html).toContain(`href="https://github.com/${login}"`);
      expect(html).toContain(`src="https://github.com/${login}.png?size=48"`);
      expect(html).toContain(`aria-label="${login} on GitHub (opens in a new tab)"`);
    }
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
  });

  it("leaves the thanks out when nobody is listed, or the backend doesn't list anyone", () => {
    expect(render({ contributors: [] })).not.toContain("Thanks to everyone");
    expect(render()).not.toContain("Thanks to everyone");
  });
});
