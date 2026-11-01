import { describe, expect, it } from "vitest";
import { personAvatar } from "./personAvatar";
import { accentSwatch } from "../../theme";

const keys = Array.from({ length: 200 }, (_, n) => n.toString(16).padStart(12, "0"));

describe("personAvatar", () => {
  it("gives one person the same look every time", () => {
    expect(personAvatar("a1b2c3d4e5f6")).toEqual(personAvatar("a1b2c3d4e5f6"));
  });

  it("takes its colours from the theme, with text that reads on them", () => {
    const swatches = (["blue", "orange", "amber", "teal", "purple", "green"] as const).map(accentSwatch);
    for (const key of keys) {
      const { background, foreground } = personAvatar(key);
      expect(swatches).toContainEqual({ color: background, contrast: foreground });
    }
  });

  it("tells people apart by both colour and shape", () => {
    const looks = keys.map(personAvatar);
    expect(new Set(looks.map((look) => look.background)).size).toBeGreaterThan(3);
    expect(new Set(looks.map((look) => look.shape)).size).toBeGreaterThan(3);
    expect(new Set(looks.map((look) => `${look.background} ${look.shape}`)).size).toBeGreaterThan(15);
  });

  it("copes with a key that isn't one", () => {
    expect(personAvatar("").path).toEqual(expect.any(String));
  });
});
