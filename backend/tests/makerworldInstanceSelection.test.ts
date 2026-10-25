import { describe, expect, it } from "vitest";
import { makerworldInstanceCover, makerworldInstanceIdFromNextData } from "../src/providers/makerworld/pageData";

function nextData(design: Record<string, unknown>) {
  return { props: { pageProps: { design } } };
}

describe("makerworldInstanceIdFromNextData", () => {
  const design = { defaultInstanceId: 2, instances: [{ id: 1 }, { id: 2 }, { id: 3 }] };

  it("takes the link's profile, else the default, else the first", () => {
    expect(makerworldInstanceIdFromNextData(nextData(design), "3")).toBe("3");
    expect(makerworldInstanceIdFromNextData(nextData(design), null)).toBe("2");
    expect(makerworldInstanceIdFromNextData(nextData(design), "999")).toBe("2");
    expect(makerworldInstanceIdFromNextData(nextData({ instances: [{ id: 7 }] }), null)).toBe("7");
  });

  // Seen on MakerWorld model 1106505: defaultInstanceId 1102432, but the only profile is 1113369.
  // Downloading the stale default answers 403 "The client does not have access rights to the content."
  it("skips a default that is no longer one of the design's profiles", () => {
    const stale = { defaultInstanceId: 1102432, instances: [{ id: 1113369 }] };
    expect(makerworldInstanceIdFromNextData(nextData(stale), null)).toBe("1113369");
  });

  it("answers null without a design or profiles", () => {
    expect(makerworldInstanceIdFromNextData({}, null)).toBeNull();
    expect(makerworldInstanceIdFromNextData(nextData({ defaultInstanceId: 5, instances: [] }), null)).toBeNull();
  });
});

describe("makerworldInstanceCover", () => {
  const design = {
    instances: [
      { id: 1, cover: "https://makerworld.bblmw.com/a/instance/one.png" },
      { id: 2, cover: "", pictures: [{ url: "https://makerworld.bblmw.com/a/instance/two.png" }] },
      { id: 3, cover: "javascript:alert(1)" },
    ],
  };

  it("takes the profile's cover, else its first picture", () => {
    expect(makerworldInstanceCover(design, "1")).toBe("https://makerworld.bblmw.com/a/instance/one.png");
    expect(makerworldInstanceCover(design, "2")).toBe("https://makerworld.bblmw.com/a/instance/two.png");
  });

  it("answers null for an unknown profile, no profile or a non-https address", () => {
    expect(makerworldInstanceCover(design, "9")).toBeNull();
    expect(makerworldInstanceCover(design, null)).toBeNull();
    expect(makerworldInstanceCover(design, "3")).toBeNull();
    expect(makerworldInstanceCover({}, "1")).toBeNull();
  });
});
