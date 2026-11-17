/**
 * Rows of a CSV or TSV file, as a spreadsheet would read them: quoted fields may hold the delimiter, line breaks and
 * doubled quotes. Stops after `maxRows`, so a preview of a large file costs no more than what it shows.
 */
export function parseDelimited(text: string, delimiter: "," | "\t" | ";", maxRows = 200): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;
  // A byte-order mark isn't part of the first field.
  if (text.charCodeAt(0) === 0xfeff) index = 1;
  const endRow = () => {
    row.push(field);
    field = "";
    // A blank line between rows isn't a row of one empty field.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
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
  if (rows.length < maxRows && (field !== "" || row.length)) endRow();
  return rows;
}

/** The delimiter a CSV file most likely uses: some locales write `;` where `,` is the decimal mark. */
export function guessDelimiter(firstLine: string, extension: string): "," | "\t" | ";" {
  if (extension === "tsv") return "\t";
  const count = (char: string) => firstLine.split(char).length - 1;
  if (count("\t") > count(",") && count("\t") > count(";")) return "\t";
  return count(";") > count(",") ? ";" : ",";
}
