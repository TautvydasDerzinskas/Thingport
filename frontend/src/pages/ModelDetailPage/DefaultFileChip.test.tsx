import i18next from "i18next";
import { ThemeProvider } from "@mui/material/styles";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { buildTheme } from "../../theme";
import en from "../../i18n/locales/en.json";
import DefaultFileChip, { defaultFirst } from "./DefaultFileChip";

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", defaultNS: "models", resources: { en: { models: en.models } } });

type Item = { id: number; d?: boolean };
const isDef = (n: Item) => n.d === true;

describe("defaultFirst", () => {
  it("moves the default to the top and keeps the rest in order", () => {
    const items: Item[] = [{ id: 1 }, { id: 2 }, { id: 3, d: true }, { id: 4 }];
    expect(defaultFirst(items, isDef).map((i) => i.id)).toEqual([3, 1, 2, 4]);
  });

  it("keeps the order without a default", () => {
    const items: Item[] = [{ id: 1 }, { id: 2 }];
    expect(defaultFirst(items, isDef).map((i) => i.id)).toEqual([1, 2]);
  });

  it("keeps the relative order of several defaults", () => {
    const items: Item[] = [{ id: 1 }, { id: 2, d: true }, { id: 3 }, { id: 4, d: true }];
    expect(defaultFirst(items, isDef).map((i) => i.id)).toEqual([2, 4, 1, 3]);
  });

  it("handles one file and an empty list, without touching the input", () => {
    const one = [{ id: 1, d: true }];
    expect(defaultFirst(one, isDef)).toEqual(one);
    expect(defaultFirst(one, isDef)).not.toBe(one);
    expect(defaultFirst<Item>([], isDef)).toEqual([]);
  });
});

describe("DefaultFileChip", () => {
  it("shows the translated label", () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={buildTheme("light")}>
          <DefaultFileChip />
        </ThemeProvider>
      </I18nextProvider>,
    );
    expect(html).toContain(en.models.detail.defaultFile);
  });
});
