import { describe, expect, it } from "vitest";
import type { WidgetManifest } from "../../../api/widgets";
import { fromManifest, keyFromLabel, newSetting, problems, slugFromName, toManifest } from "./draft";

const manifest: WidgetManifest = {
  name: "Print farm",
  description: "Printers",
  iconUrl: "https://example.com/icon.svg",
  version: "1.2.0",
  author: "Jane Doe",
  authorUrl: "https://github.com/jane",
  size: { w: 4, h: 3, minW: 2, minH: 2 },
  settings: [
    { key: "baseUrl", type: "text", label: "Address", placeholder: "http://octopi.local" },
    { key: "apiKey", type: "text", label: "API key", secret: true },
    { key: "jobs", type: "number", label: "Jobs", default: 5 },
    { key: "temps", type: "toggle", label: "Temperatures", default: true },
    {
      key: "refresh",
      type: "choice",
      label: "Refresh",
      default: "30",
      options: [
        { value: "10", label: "10 s" },
        { value: "30", label: "30 s" },
      ],
    },
  ],
  hosts: ["octopi.local"],
};

describe("widget editor draft", () => {
  it("turns metadata into the form and back unchanged", () => {
    expect(toManifest(fromManifest(manifest, "print-farm"))).toEqual(manifest);
  });

  it("leaves out optional fields left empty", () => {
    const draft = fromManifest({ ...manifest, iconUrl: undefined, authorUrl: undefined }, "x1");
    const saved = toManifest({ ...draft, description: "  " });
    expect(saved.iconUrl).toBeUndefined();
    expect(saved.description).toBe("");
  });

  it("derives keys and folder names", () => {
    expect(keyFromLabel("API key")).toBe("apiKey");
    expect(keyFromLabel("2nd printer")).toBe("");
    expect(slugFromName("Print farm!")).toBe("print-farm");
  });

  it("names what needs fixing", () => {
    const draft = fromManifest(manifest, "print-farm");
    const extra = { ...newSetting("choice", []), key: "baseUrl", label: "" };
    extra.options = [
      { ...extra.options[0], value: "same" },
      { ...extra.options[1], value: "same" },
    ];
    const found = problems({
      ...draft,
      slug: "X",
      name: " ",
      iconUrl: "ftp://x",
      size: { w: 2, h: 2, minW: 3, minH: 1 },
      settings: [...draft.settings, extra],
    });
    expect(found).toEqual({
      slug: "slug",
      name: "name",
      iconUrl: "url",
      minW: "minSize",
      [`settings.${extra.uid}.key`]: "keyTaken",
      [`settings.${extra.uid}.label`]: "label",
      [`settings.${extra.uid}.options`]: "options",
    });
    expect(problems(draft)).toEqual({});
  });
});
