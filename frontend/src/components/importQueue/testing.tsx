import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { StaticRouter } from "react-router-dom/server";
import { ThemeProvider } from "@mui/material/styles";
import en from "../../i18n/locales/en.json";
import { buildTheme } from "../../theme";
import { ConfirmProvider } from "../ConfirmProvider";
import type { ImportQueueValue } from "./ImportQueueContext";
import { createQueueStore, initialQueueState } from "./queueStore";
import { indicatorState, toQueueJob, type QueueJob, type RawQueueJob } from "./queueView";

// What the queue's render tests share. There's no DOM in the test run, so a render is markup, and text is read from it.

const i18n = i18next.createInstance();
await i18n.init({
  lng: "en",
  defaultNS: "app",
  ns: ["app", "common"],
  resources: { en: { app: en.app, common: en.common } },
  interpolation: { escapeValue: false },
});

export const NOW = new Date(2026, 9, 31, 12, 0, 0).getTime();
export const MINUTE = 60_000;
export const ago = (ms: number) => new Date(NOW - ms).toISOString();

export function testJob(fields: Partial<RawQueueJob> = {}): QueueJob {
  return toQueueJob(
    {
      id: "j1",
      type: "LINKS",
      status: "QUEUED",
      source_url: "https://example.com/a",
      source_label: "Workshop bits",
      total: 8,
      can_start: false,
      can_pause: false,
      can_retry: false,
      can_delete: false,
      attention: false,
      created_at: ago(5 * MINUTE),
      queued_at: ago(5 * MINUTE),
      updated_at: ago(MINUTE),
      ...fields,
    },
    NOW,
  );
}

/** A queue with nothing in it and its dialog open, as `useImportQueue` would give it; the actions go nowhere. */
export function testQueue(overrides: Partial<ImportQueueValue> = {}): ImportQueueValue {
  return {
    ...initialQueueState("me"),
    ...createQueueStore({ viewerId: "me", isAdmin: true, isHidden: () => true }).actions,
    loading: false,
    everyone: { jobs: [], olderBackend: false, loading: false, failed: false },
    dialog: { open: true, section: "run", scope: "mine", person: null },
    indicator: indicatorState([], false),
    ...overrides,
  };
}

export const renderQueue = (node: React.ReactNode, theme: "light" | "dark" = "light") =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={buildTheme(theme)}>
        <StaticRouter location="/">
          <ConfirmProvider>{node}</ConfirmProvider>
        </StaticRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );

export const textOf = (html: string) =>
  html
    .replace(/<style[^>]*>.*?<\/style>/gs, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
