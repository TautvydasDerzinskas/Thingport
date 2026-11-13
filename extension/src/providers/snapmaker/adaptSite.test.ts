import { describe, expect, it } from "vitest";
import { onSite, profileFiles } from "./adaptSite";

describe("a Snapmaker Space model's print profiles", () => {
  it("are the files its model detail lists that can be downloaded, shown by their titles", () => {
    const files = profileFiles({
      printProfiles: [
        {
          id: 49371,
          title: "2 color",
          translatedTitle: "2 Farben",
          fileName: "gnome_2 color.3mf",
          fileSize: 8723564,
          gcodeUrl: "x",
        },
        { id: "49504", title: "4 Color", fileName: "gnome_4 color.3mf", fileSize: 0, gcodeUrl: "y" },
        { id: "49505", title: "No file yet", fileName: "none.3mf", gcodeUrl: null },
      ],
    });
    expect(files).toEqual([
      { id: "49371", name: "gnome_2 color.3mf", title: "2 Farben", size: 8723564 },
      { id: "49504", name: "gnome_4 color.3mf", title: "4 Color", size: null },
    ]);
    expect(profileFiles(undefined)).toEqual([]);
  });
});

describe("a Snapmaker Space download link", () => {
  it("is fetched on the site, where its first host redirects without letting the page read the file", () => {
    expect(onSite("https://models.snapmaker.com/models/download/a/b.3mf?sign=1&t=2")).toBe(
      "https://space.snapmaker.com/models/download/a/b.3mf?sign=1&t=2",
    );
    expect(onSite("https://space.snapmaker.com/models/download/a.3mf?sign=1")).toBe(
      "https://space.snapmaker.com/models/download/a.3mf?sign=1",
    );
    expect(onSite("http://models.snapmaker.com/models/download/a.3mf")).toBeNull();
    expect(onSite("https://example.com/a.3mf")).toBeNull();
    expect(onSite("not a link")).toBeNull();
  });
});
