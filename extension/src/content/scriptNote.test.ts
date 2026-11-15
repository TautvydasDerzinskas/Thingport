import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../shared/i18n";
import {
  SHARED_SCRIPT_EXPLAINER,
  WITHHELD_SCRIPT_NOTE_HTML,
  WITHHELD_SCRIPT_PANEL_NOTE_HTML,
  refreshScriptNoteTexts,
} from "./scriptNote";

afterEach(() => {
  setLocale("en");
  refreshScriptNoteTexts();
});

describe("script-note localization", () => {
  it("refreshes its live HTML exports after the locale is selected", () => {
    setLocale("uk");
    refreshScriptNoteTexts();

    expect(SHARED_SCRIPT_EXPLAINER).toContain("сценарієм");
    expect(WITHHELD_SCRIPT_NOTE_HTML).toContain('tg-fab-note__no">Без</span>');
    expect(WITHHELD_SCRIPT_PANEL_NOTE_HTML).toContain("Автор вирішив");
  });
});
