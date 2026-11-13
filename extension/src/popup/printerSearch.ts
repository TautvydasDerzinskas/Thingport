// What Add printer's search box matches: each word typed must start a word of the printer's maker and model, so "k1"
// finds Creality's K1 and K1C but not a model called "MK1", and "ender 3" finds "Ender-3 V3".

/** A name's words, in lower case, split where printer names split them. */
export function nameWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\-_/().,+]+/)
    .filter(Boolean);
}

/** Whether every word of `query` (from nameWords) starts a word of `name`. */
export function nameMatches(name: string, query: readonly string[]): boolean {
  const words = nameWords(name);
  return query.every((typed) => words.some((word) => word.startsWith(typed)));
}
