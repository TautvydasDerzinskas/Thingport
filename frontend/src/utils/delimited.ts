/**
 * Rows of a CSV or TSV file, as a spreadsheet would read them: quoted fields may hold the delimiter, line breaks and
 * doubled quotes. Stops after `maxRows`, so a preview of a large file costs no more than what it shows.
 */
export function parseDelimited(text: string, delimiter: "," | "\t" | ";", maxRows = 200): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // The line holds a field even if it's empty: a quoted "" is one, where a blank line holds none.
  let present = false;
  let index = 0;
  // A byte-order mark isn't part of the first field.
  if (text.charCodeAt(0) === 0xfeff) index = 1;
  const endRow = () => {
    row.push(field);
    field = "";
    // A blank line between rows isn't a row of one empty field.
    if (present || row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
    present = false;
  };
  for (; index < text.length && rows.length < maxRows; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
      present = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      endRow();
    } else {
      field += char;
    }
  }
  if (rows.length < maxRows && (present || field !== "" || row.length)) endRow();
  return rows;
}

/** The delimiter a CSV file most likely uses, from its first record: some locales write `;` where `,` is the
 *  decimal mark. */
export function guessDelimiter(text: string, extension: string): "," | "\t" | ";" {
  if (extension === "tsv") return "\t";
  // Outside quoted fields only: `"size;colour",qty` is two fields split by a comma, and a line break inside quotes is
  // part of a field, not the header's end. A doubled quote inside one turns quoting off and on again.
  const counts = { "\t": 0, ",": 0, ";": 0 };
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (char === "\n" || char === "\r") break;
    else if (char === "\t" || char === "," || char === ";") counts[char] += 1;
  }
  if (counts["\t"] > counts[","] && counts["\t"] > counts[";"]) return "\t";
  return counts[";"] > counts[","] ? ";" : ",";
}

/** What a table preview shows of a CSV or TSV file: its header, up to `limit` rows under it, and whether it has more. */
export function previewTable(text: string, extension: string, limit: number) {
  // The header, the rows shown and one more, which says there are more.
  const rows = parseDelimited(text, guessDelimiter(text, extension), limit + 2);
  const [head = [], ...body] = rows;
  return { head, body: body.slice(0, limit), more: body.length > limit };
}
