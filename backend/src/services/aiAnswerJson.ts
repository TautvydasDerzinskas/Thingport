/**
 * An answer's JSON object. Providers that ignore response_format (Xiaomi MiMo) wrap the object in prose or markdown,
 * e.g. `**{...}**`; the outermost braces are tried when the whole text doesn't parse. undefined when neither does.
 */
export function parseAnswerJson(text: string): unknown {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}
