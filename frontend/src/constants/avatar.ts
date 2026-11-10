import { apiBase } from "../api/client";

/** A Thingport avatar's parts, as the backend's avatarArt.ts draws them; -1 for no hair or no glasses. */
export type AvatarStyle = {
  hair: number;
  hair_color: number;
  glasses: number;
  mouth: number;
  background: number;
};
export type AvatarPart = keyof AvatarStyle;

/** How many of each there are: the backend's AVATAR_PARTS. */
export const AVATAR_PARTS: Record<AvatarPart, number> = {
  hair: 10,
  hair_color: 8,
  glasses: 5,
  mouth: 5,
  background: 8,
};
/** Hair and glasses can be left out. */
export const OPTIONAL_PARTS: ReadonlySet<AvatarPart> = new Set(["hair", "glasses"]);

/** Every choice of a part, in the order the designer offers them: "none" first where there is one. */
export const partChoices = (part: AvatarPart): number[] =>
  Array.from({ length: AVATAR_PARTS[part] + (OPTIONAL_PARTS.has(part) ? 1 : 0) }, (_, i) =>
    OPTIONAL_PARTS.has(part) ? i - 1 : i,
  );

/** The picture of a design, drawn by the backend: the designer's preview and its choices. */
export function thingportAvatarUrl(style: AvatarStyle): string {
  const params = new URLSearchParams(Object.entries(style).map(([key, value]) => [key, String(value)]));
  return `${apiBase()}/avatars/thingport.svg?${params}`;
}

export function shuffledAvatarStyle(): AvatarStyle {
  const pick = (part: AvatarPart) => {
    const choices = partChoices(part);
    return choices[Math.floor(Math.random() * choices.length)];
  };
  return {
    hair: pick("hair"),
    hair_color: pick("hair_color"),
    glasses: pick("glasses"),
    mouth: pick("mouth"),
    background: pick("background"),
  };
}

export const sameAvatarStyle = (a: AvatarStyle | null | undefined, b: AvatarStyle | null | undefined) =>
  Boolean(a && b) && (Object.keys(AVATAR_PARTS) as AvatarPart[]).every((part) => a![part] === b![part]);

export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;

/** Each choice's name, for its label: `models:avatar.<part>.<name>`. */
export const PART_NAMES: Record<AvatarPart, readonly string[]> = {
  hair: ["spiky", "sideSwept", "curly", "long", "topBun", "mohawk", "ponytail", "flatTop", "bob", "spaceBuns"],
  hair_color: ["black", "darkBrown", "brown", "blonde", "ginger", "grey", "blue", "pink"],
  glasses: ["round", "square", "sunglasses", "catEye", "threeD"],
  mouth: ["smile", "toothy", "wobbly", "surprised", "cheeky"],
  background: ["mint", "sky", "peach", "lavender", "sand", "teal", "stone", "rose"],
};
