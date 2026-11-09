import { describe, expect, it } from "vitest";
import { createInstance } from "i18next";
import type { Notification } from "../../api/notifications";
import { notificationTitle } from "./notificationTitle";

const base: Notification = {
  id: "1",
  type: "import",
  title: "",
  message: null,
  body: null,
  external_url: null,
  internal_path: null,
  read: false,
  read_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

describe("notificationTitle", () => {
  it("translates the server's message, keeping names as they are, and shows the English title without one", async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: "ru",
      interpolation: { escapeValue: false },
      resources: {
        ru: {
          translation: {
            notifications: {
              messages: {
                imported: "Импортировано: {{name}}",
                importedModels_one: "Импортирована {{count}} модель",
                importedModels_few: "Импортировано {{count}} модели",
                importedModels_many: "Импортировано {{count}} моделей",
              },
            },
          },
        },
      },
    });
    const title = (english: string, message: Notification["message"]) =>
      notificationTitle({ ...base, title: english, message }, i18n.t);
    expect(title('Imported "A "B""', { key: "imported", values: { name: 'A "B"' } })).toBe('Импортировано: A "B"');
    expect(title("Imported 21 models", { key: "importedModels", values: { count: 21 } })).toBe(
      "Импортирована 21 модель",
    );
    expect(title("Imported 25 models", { key: "importedModels", values: { count: 25 } })).toBe(
      "Импортировано 25 моделей",
    );
    // Written before messages, or a kind not translated yet: its own title.
    expect(title("Imported 3 models", null)).toBe("Imported 3 models");
    // A key this app doesn't know, from a newer server: still the English.
    expect(title("Something new", { key: "somethingNew" })).toBe("Something new");
  });
});
