import { describe, expect, it } from "vitest";
import { makerworldInstanceIdFromNextData } from "../src/services/importResolvers";

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
