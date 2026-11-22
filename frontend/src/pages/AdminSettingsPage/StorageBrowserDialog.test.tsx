import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@mui/material/styles";
import { describe, expect, it } from "vitest";
import type { StorageFile, StorageFolder, StorageListing } from "../../api/admin";
import en from "../../i18n/locales/en.json";
import { buildTheme } from "../../theme";
import { StorageListingView } from "./StorageBrowserDialog";

// What the storage browser shows of a listing: what the disk couldn't read is marked on its row, with the error's code,
// and counted once above the list. There's no DOM in the test run, so a render is markup, and text is read from it.

const i18n = i18next.createInstance();
await i18n.init({
  lng: "en",
  defaultNS: "app",
  ns: ["app", "common"],
  resources: { en: { app: en.app, common: en.common } },
  interpolation: { escapeValue: false },
});

const folder = (name: string, fields: Partial<StorageFolder> = {}): StorageFolder => ({
  name,
  path: `u-1/Desk organiser/${name}`,
  label: null,
  files: 3,
  bytes: 3_000,
  pictures: false,
  error_code: null,
  ...fields,
});

const file = (name: string, fields: Partial<StorageFile> = {}): StorageFile => ({
  name,
  path: `u-1/Desk organiser/${name}`,
  kind: "file",
  plate_id: null,
  print_id: "m1",
  print_name: "Desk organiser",
  owner_id: "someone else",
  size: 4_299_161,
  location: "managed",
  error_code: null,
  ...fields,
});

function render(
  folders: StorageFolder[],
  files: StorageFile[],
  theme: "light" | "dark" = "light",
  errorCode: string | null = null,
): string {
  const listing: StorageListing = { path: "u-1/Desk organiser", crumbs: [], folders, files, error_code: errorCode };
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={buildTheme(theme)}>
        <StorageListingView
          listing={listing}
          atTop={false}
          me="me"
          onOpenFolder={() => undefined}
          onOpenModel={() => undefined}
        />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

const textOf = (html: string) =>
  html
    .replace(/<style[^>]*>.*?<\/style>/gs, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the storage browser's listing", () => {
  it.each(["light", "dark"] as const)(
    "marks what the disk couldn't read, keeps the other states' chips, and counts it once (%s)",
    (theme) => {
      const html = render(
        [folder("Images", { pictures: true }), folder("Cable clips", { files: 0, bytes: 0, error_code: "EIO" })],
        [
          file("Clip.stl", { kind: "plate", size: 90_112, location: "source" }),
          file("Assembly guide.pdf", { location: "missing" }),
          file("Tower.gcode", { location: "unreadable", error_code: "EIO" }),
        ],
        theme,
      );
      const text = textOf(html);
      expect(text).toContain("The disk couldn't read 2 things here. They may still be there.");
      expect(text).toContain("Cable clips Can't read this folder · EIO");
      expect(text).toContain('Tower.gcode Can\'t read · EIO · 4.1 MB · Supporting file · model "Desk organiser"');
      expect(text).toContain("3 files · 2.9 KB");
      // The warning sign stands in for each one's own icon, and no chip is added for it.
      expect(count(html, 'data-testid="WarningAmberIcon"')).toBe(2);
      expect(count(html, 'data-testid="InsertDriveFileOutlinedIcon"')).toBe(1);
      expect(count(html, 'class="MuiChip-label')).toBe(2);
      expect(text).toContain("At its source");
      expect(text).toContain("Missing");
    },
  );

  it("says one thing for one", () => {
    const text = textOf(render([], [file("Tower.gcode", { location: "unreadable", error_code: "EACCES" })]));
    expect(text).toContain("The disk couldn't read 1 thing here. It may still be there.");
    expect(text).toContain("Can't read · EACCES · 4.1 MB");
  });

  it("counts the folder itself when the disk couldn't list all of it", () => {
    const text = textOf(render([], [file("Tower.gcode")], "light", "EACCES"));
    expect(text).toContain("The disk couldn't read 1 thing here. It may still be there. · EACCES");
  });

  it("warns of nothing when everything could be read", () => {
    const html = render(
      [folder("Images", { pictures: true })],
      [file("Tower.gcode"), file("Gone.pdf", { location: "missing" })],
    );
    expect(textOf(html)).not.toContain("couldn't read");
    expect(html).not.toContain("WarningAmberIcon");
    expect(html).not.toContain("MuiAlert");
  });

  it("opens a folder the disk couldn't list only when something below it is listed", () => {
    expect(render([folder("Cable clips", { files: 0, bytes: 0, error_code: "EIO" })], [])).not.toContain(
      'role="button"',
    );
    expect(render([folder("Cable clips", { files: 2, error_code: "EIO" })], [])).toContain('role="button"');
    expect(render([folder("Readable", { files: 0, bytes: 0 })], [])).toContain('role="button"');
  });
});
