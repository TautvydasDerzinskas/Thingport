// Which colour each part is printed in.
//
// The border and base are one colour and the letters another; two more can be given to particular letters, by the
// character or by where it sits, so "NO 7" can have its 7 in red. The colours ride along in the 3MF as its own
// material list, so a slicer opens the file with the parts already assigned.
//

export const DEFAULT_COLOURS = {
  /** One filament for the whole thing, rather than one for the border and another for the letters. */
  single: false,
  border: "#77916a",
  letter: "#f0eedf",
  extras: [
    { enabled: false, targets: "", colour: "#e96868" },
    { enabled: false, targets: "", colour: "#6699dd" },
  ],
};

const hex = (value, fallback) => (/^#[\da-f]{6}$/i.test(value || "") ? value.toLowerCase() : fallback);

export function normalizeColours(value = {}) {
  return {
    single: Boolean(value.single),
    border: hex(value.border, DEFAULT_COLOURS.border),
    letter: hex(value.letter, DEFAULT_COLOURS.letter),
    extras: DEFAULT_COLOURS.extras.map((fallback, i) => ({
      enabled: Boolean(value.extras?.[i]?.enabled),
      targets: String(value.extras?.[i]?.targets ?? "").slice(0, 200),
      colour: hex(value.extras?.[i]?.colour, fallback.colour),
      mode: value.extras?.[i]?.mode === "positions" ? "positions" : "text",
      indices: [...new Set((value.extras?.[i]?.indices || []).filter((n) => Number.isInteger(n) && n >= 0 && n < 100))],
    })),
  };
}

/** The characters an extra colour names, however they were typed: "a,b" and "ab" mean the same. */
export const targetLetters = (value) => [
  ...new Set(
    String(value)
      .split(",")
      .flatMap((token) => [...token.trim()])
      .filter((character) => !/[\s,]/u.test(character)),
  ),
];

const matches = (model, extra) =>
  extra.enabled &&
  (extra.mode === "positions"
    ? extra.indices.includes(model.index)
    : targetLetters(extra.targets).includes(model.char));

/** Which colour a part takes: 0 the border, 1 the letters, 2 and 3 the extras — or 0 throughout in one colour. */
export function colourSlot(model, colours) {
  const settled = normalizeColours(colours);
  if (settled.single || model.kind !== "letter") return 0;
  let slot = 1;
  settled.extras.forEach((extra, i) => {
    if (matches(model, extra)) slot = i + 2;
  });
  return slot;
}

/** The filaments in slot order. In one colour there is only ever the one, so a 3MF lists one material. */
export function palette(colours) {
  const settled = normalizeColours(colours);
  if (settled.single) return [settled.border];
  return [settled.border, settled.letter, ...settled.extras.map((extra) => extra.colour)];
}

/** What the person got wrong: a letter given two colours, or a colour pointed at a letter that isn't there. */
export function colourIssues(
  text,
  colours,
  models = [...text].map((char, index) => ({ char, index, kind: "letter" })),
) {
  const settled = normalizeColours(colours);
  // In one colour nothing is sent anywhere, so there is nothing to clash or to miss.
  if (settled.single) return { duplicates: [], missing: [] };
  const named = settled.extras.map((extra) =>
    extra.enabled && extra.mode !== "positions" ? targetLetters(extra.targets) : [],
  );
  return {
    duplicates: [
      ...new Set(
        models
          .filter(
            (model) => model.char?.trim() && matches(model, settled.extras[0]) && matches(model, settled.extras[1]),
          )
          .map((model) => model.char),
      ),
    ],
    missing: [...new Set(named.flat().filter((character) => !text.includes(character)))],
  };
}
