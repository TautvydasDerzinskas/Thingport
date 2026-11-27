import { describe, expect, it } from "vitest";
import be from "../../i18n/locales/be.json";
import de from "../../i18n/locales/de.json";
import en from "../../i18n/locales/en.json";
import es from "../../i18n/locales/es.json";
import fr from "../../i18n/locales/fr.json";
import lt from "../../i18n/locales/lt.json";
import ru from "../../i18n/locales/ru.json";
import uk from "../../i18n/locales/uk.json";
import zh from "../../i18n/locales/zh.json";
import {
  ANGLES,
  DEFAULT_SHOTS,
  FILAMENT_COLOURS,
  MAX_SHOTS,
  SCENES,
  canPicture,
  cleanShots,
  nextShot,
  pictureFilename,
} from "./scenes";

// Paths under public/scenes, as "surfaces/oak-desk/color.webp".
const FILES = new Set(
  Object.keys(import.meta.glob("../../../public/scenes/**/*.{webp,hdr}")).map(
    (path) => path.split("public/scenes/")[1],
  ),
);

describe("the scenes' files", () => {
  it("has a swatch for every background, and every surface's maps", () => {
    const needed = SCENES.flatMap((scene) => [
      `surfaces/${scene.id}/swatch.webp`,
      ...(scene.surface
        ? ["color", "normal", "rough"].map((map) => `surfaces/${scene.surface?.folder}/${map}.webp`)
        : []),
    ]);
    expect(needed.filter((path) => !FILES.has(path))).toEqual([]);
  });

  it("has every room a scene is lit by", () => {
    const needed = [...new Set(SCENES.map((scene) => `light/${scene.light}.hdr`))];
    expect(needed.filter((path) => !FILES.has(path))).toEqual([]);
  });

  it("keeps surfaces small enough to stay sharp beside a small print", () => {
    // 2048 px over the scan's width: past about 0.75 mm a pixel, a keyring sits on a blur.
    const blurry = SCENES.filter((scene) => scene.surface && scene.surface.sizeMm / 2048 > 0.75).map((s) => s.id);
    expect(blurry).toEqual([]);
  });
});

describe("a shot list", () => {
  it("starts with three pictures, each from its own angle on its own background", () => {
    expect(DEFAULT_SHOTS).toHaveLength(3);
    expect(new Set(DEFAULT_SHOTS.map((shot) => shot.angle)).size).toBe(3);
    expect(new Set(DEFAULT_SHOTS.map((shot) => shot.scene)).size).toBe(3);
  });

  it("adds a picture on a background the list doesn't use yet", () => {
    const next = nextShot(DEFAULT_SHOTS);
    expect(DEFAULT_SHOTS.map((shot) => shot.scene)).not.toContain(next.scene);
    expect(ANGLES.map((angle) => angle.id)).toContain(next.angle);
  });

  it("reads a stored list back without unknown backgrounds or angles, and never empty", () => {
    expect(
      cleanShots([
        { angle: "hero", scene: "walnut" },
        { angle: "upside-down", scene: "walnut" },
        { angle: "top", scene: "marble" },
        "nonsense",
      ]),
    ).toEqual([{ angle: "hero", scene: "walnut" }]);
    expect(cleanShots([])).toEqual(DEFAULT_SHOTS);
    expect(cleanShots("hero")).toEqual(DEFAULT_SHOTS);
    expect(cleanShots(Array.from({ length: 10 }, () => ({ angle: "side", scene: "wool" })))).toHaveLength(MAX_SHOTS);
  });
});

describe("a generated picture's name", () => {
  it("is the model's name, the background and the angle", () => {
    expect(pictureFilename("Thingport shopping cart coin", { angle: "hero", scene: "white-oak" }, 0)).toBe(
      "thingport-shopping-cart-coin-white-oak-hero-1.jpg",
    );
  });

  it("stays a plain file name whatever the model is called", () => {
    expect(pictureFilename("Ąžuolinis / stalas: ✓", { angle: "top", scene: "studio" }, 2)).toBe(
      "azuolinis-stalas-studio-top-3.jpg",
    );
    expect(pictureFilename("✓✓✓", { angle: "side", scene: "wool" }, 0)).toBe("model-wool-side-1.jpg");
  });
});

describe("what can be pictured", () => {
  it("takes the files the 3D viewer opens", () => {
    expect(canPicture("coin.3MF")).toBe(true);
    expect(canPicture("bracket.step")).toBe(true);
    expect(canPicture("readme.pdf")).toBe(false);
    expect(canPicture("print.gcode")).toBe(false);
  });
});

describe("the picture generator's text", () => {
  it("names every background, angle and colour in every language", () => {
    const missing = Object.entries({ en, lt, de, es, fr, ru, uk, be, zh }).flatMap(([lang, locale]) => {
      const strings = (locale as unknown as { models: { scenePictures: Record<string, Record<string, string>> } })
        .models.scenePictures;
      return [
        ...SCENES.map((scene) => ["scenes", scene.id]),
        ...ANGLES.map((angle) => ["angles", angle.id]),
        ...FILAMENT_COLOURS.map((colour) => ["colours", colour.id]),
      ]
        .filter(([group, id]) => !strings[group]?.[id])
        .map(([group, id]) => `${lang} ${group}.${id}`);
    });
    expect(missing).toEqual([]);
  });
});
