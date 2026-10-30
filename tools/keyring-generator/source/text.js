// What may be typed, and how it is counted.

export const MAX_LINES = 5;
export const MAX_CHARACTERS = 15;

/** One kind of line ending, and no tabs: a tab has no width a font agrees on. */
export const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ");

/** Lines and characters, counted as the limits count them: a line break is not a character. */
export function textStats(value) {
  const text = normalizeText(value);
  return { lines: text.split("\n").length, characters: [...text.replace(/\n/g, "")].length };
}

/** The text cut down to what will fit, keeping whole characters: an emoji is one, not two. */
export function limitText(value) {
  let remaining = MAX_CHARACTERS;
  return normalizeText(value)
    .split("\n")
    .slice(0, MAX_LINES)
    .map((line) => {
      const characters = [...line].slice(0, remaining);
      remaining -= characters.length;
      return characters.join("");
    })
    .join("\n");
}
