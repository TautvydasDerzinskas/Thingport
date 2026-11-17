// A file's size as a site writes it beside the file, read back into bytes.

const UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };

/** "25.4 MB", "19.48 kB", "1,200 KB" or "512 bytes" in bytes, near enough to weigh it against a limit; null when it
 *  can't be read. */
export function bytesFromSizeText(text: string | null | undefined): number | null {
  const match = /^\s*([\d.,]+)\s*(bytes?|b|kb|mb|gb|tb)\s*$/i.exec(text ?? "");
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  const unit = match[2].toLowerCase().startsWith("byte") ? "b" : match[2].toLowerCase();
  return Number.isFinite(value) ? Math.round(value * UNITS[unit]) : null;
}
