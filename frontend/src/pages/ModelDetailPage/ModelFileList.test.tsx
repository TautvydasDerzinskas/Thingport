import i18next from "i18next";
import { ThemeProvider } from "@mui/material/styles";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import type { Plate } from "../../api/prints";
import { buildTheme } from "../../theme";
import en from "../../i18n/locales/en.json";
import ModelFileList, { nextFocusIndex } from "./ModelFileList";
import { defaultFile, type ModelFile } from "./useOpenInSlicer";

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", defaultNS: "models", resources: { en: { models: en.models } } });

function file(i: number, name = `part${i}.3mf`, profile = false): ModelFile {
  return {
    key: `k${i}`,
    url: `/f/${i}`,
    filename: name,
    launchFilename: name,
    index: i,
    plate: {
      id: i,
      filename: name,
      url: `/f/${i}`,
      thumb_url: null,
      profile: profile
        ? {
            title: `Profile ${i}`,
            printer: null,
            nozzle_mm: 0.4,
            layer_height_mm: 0.2,
            materials: ["PLA"],
            plates: 1,
            estimated_seconds: null,
            plate_stats: [],
            weight_g: null,
          }
        : null,
    } as unknown as Plate,
  };
}

function render(files: ModelFile[], selectedIndex = 0): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={buildTheme("light")}>
        <ModelFileList files={files} selected={files[selectedIndex]} onSelect={() => {}} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

const many = (n: number) => Array.from({ length: n }, (_, i) => file(i));

describe("nextFocusIndex", () => {
  it("moves with arrows and stops at the ends", () => {
    expect(nextFocusIndex("ArrowDown", 0, 4)).toBe(1);
    expect(nextFocusIndex("ArrowDown", 3, 4)).toBe(3);
    expect(nextFocusIndex("ArrowUp", 2, 4)).toBe(1);
    expect(nextFocusIndex("ArrowUp", 0, 4)).toBe(0);
  });
  it("jumps with Home and End and ignores other keys", () => {
    expect(nextFocusIndex("Home", 2, 8)).toBe(0);
    expect(nextFocusIndex("End", 2, 8)).toBe(7);
    expect(nextFocusIndex("a", 2, 8)).toBeNull();
  });
});

describe("ModelFileList", () => {
  it("shows one file as plain information, without a selection role", () => {
    const html = render(many(1));
    expect(html).toContain('role="list"');
    expect(html).not.toContain('role="option"');
    expect(html).not.toContain("aria-selected");
    expect(html).toContain("part0");
  });

  it.each([4, 8])("lists %i files as a listbox with the selected one marked", (n) => {
    const html = render(many(n), 1);
    expect(html).toContain('role="listbox"');
    expect(html.match(/role="option"/g)).toHaveLength(n);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  });

  it("shows STL-only files with name and type, without badges", () => {
    const stl = [file(0, "a.stl"), file(1, "b.stl")].map((f) => ({ ...f, plate: f.plate }));
    const html = render(stl);
    expect(html).toContain("a");
    expect(html).toContain("STL");
    expect(html).not.toContain('role="img"');
  });

  it("shows profile badges under the profile title", () => {
    const html = render([file(0, "x.3mf", true), file(1, "y.3mf", true)]);
    expect(html).toContain("Profile 0");
    expect(html).toContain('data-item="nozzle"');
  });

  it("shows a file without plate data as prepared print", () => {
    const html = render([{ ...file(0, "p.gcode.3mf"), plate: null }]);
    expect(html).toContain("Prepared print");
    expect(html).toContain("p.gcode.3mf");
  });

  it("marks only the file the source flags as default, with a help tip", () => {
    const flagged = file(1);
    flagged.plate = { ...flagged.plate!, is_default: true };
    const html = render([file(0), flagged]);
    expect(html.match(/>Default</g)).toHaveLength(1);
    expect(html).toContain("Marked as the default by the source site");
    expect(render([file(0), file(1)])).not.toContain(">Default<");
  });
});

describe("defaultFile", () => {
  const flag = (f: ModelFile): ModelFile => ({ ...f, plate: { ...f.plate!, is_default: true } });
  it("is null for no files", () => expect(defaultFile([])).toBeNull());
  it("is the only file", () => expect(defaultFile([file(0)])?.key).toBe("k0"));
  it("is the first file without a flag", () => expect(defaultFile([file(0), file(1)])?.key).toBe("k0"));
  it("is the flagged file, even when not the first", () =>
    expect(defaultFile([file(0), flag(file(1)), file(2)])?.key).toBe("k1"));
  it("ignores files without plate data", () =>
    expect(defaultFile([{ ...file(0), plate: null }, flag(file(1))])?.key).toBe("k1"));
});
