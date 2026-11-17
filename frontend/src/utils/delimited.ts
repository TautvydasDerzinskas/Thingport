/**
 * Rows of a CSV or TSV file, as a spreadsheet would read them: quoted fields may hold the delimiter, line breaks and
 * doubled quotes. Reads no further than the `maxRows` rows it returns, each of them to its end.
 */
export function parseDelimited(text: string, delimiter: "," | "\t" | ";", maxRows = 200): string[][] {
  return parseRows(text, delimiter, maxRows).rows;
}

/** parseDelimited, holding no more than `maxColumns` fields of a row: the rest are still read, to find where the row
 *  ends, but not kept. `cut` says which rows had more. */
function parseRows(text: string, delimiter: "," | "\t" | ";", maxRows: number, maxColumns = Number.POSITIVE_INFINITY) {
  const rows: string[][] = [];
  const cut: boolean[] = [];
  let row: string[] = [];
  let over = false;
  let field = "";
  let quoted = false;
  // The line holds a field even if it's empty: a quoted "" is one, where a blank line holds none.
  let present = false;
  let index = 0;
  // A byte-order mark isn't part of the first field.
  if (text.charCodeAt(0) === 0xfeff) index = 1;
  const keep = () => {
    if (row.length < maxColumns) row.push(field);
    else over = true;
    field = "";
  };
  const endRow = () => {
    keep();
    // A blank line between rows isn't a row of one empty field. One with fields past the cap isn't blank.
    if (present || over || row.length > 1 || row[0] !== "") {
      rows.push(row);
      cut.push(over);
    }
    row = [];
    over = false;
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
      keep();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      endRow();
    } else {
      field += char;
    }
  }
  if (rows.length < maxRows && (present || field !== "" || row.length)) endRow();
  return { rows, cut };
}

/** The delimiter a CSV file most likely uses, from its first record: some locales write `;` where `,` is the
 *  decimal mark. */
export function guessDelimiter(text: string, extension: string): "," | "\t" | ";" {
  if (extension === "tsv") return "\t";
  // Outside quoted fields only: `"size;colour",qty` is two fields split by a comma, and a line break inside quotes is
  // part of a field, not the header's end. A doubled quote inside one turns quoting off and on again.
  const counts = { "\t": 0, ",": 0, ";": 0 };
  let quoted = false;
  // Blank lines before it aren't the header.
  let started = false;
  for (const char of text) {
    if (char === "\ufeff") continue;
    if (char === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (char === "\n" || char === "\r") {
      if (started) break;
      continue;
    } else if (char === "\t" || char === "," || char === ";") counts[char] += 1;
    started = true;
  }
  if (counts["\t"] > counts[","] && counts["\t"] > counts[";"]) return "\t";
  return counts[";"] > counts[","] ? ";" : ",";
}

/** What a table preview shows of a CSV or TSV file: its header and up to `limit` rows under it, each cut to `columns`
 *  fields, and whether the file has more rows, or wider ones, than that. */
export function previewTable(text: string, extension: string, limit: number, columns = Number.POSITIVE_INFINITY) {
  // The header, the rows shown and one more, which says there are more.
  const { rows, cut } = parseRows(text, guessDelimiter(text, extension), limit + 2, columns);
  const [head = [], ...body] = rows;
  return {
    head,
    body: body.slice(0, limit),
    more: body.length > limit,
    // Only the header and the rows shown: the one more read says nothing of what's on screen.
    wider: cut.slice(0, limit + 1).some(Boolean),
  };
}
