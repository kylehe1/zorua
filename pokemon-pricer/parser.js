// parser.js
// Single responsibility: read the vendor's .csv inventory into plain
// JS objects, and write the priced results back out to a downloadable .csv.
// No external dependencies — hand-rolled RFC4180-ish CSV parse/serialize.

// Column headers we look for in the uploaded spreadsheet. Matching is
// case-insensitive and ignores surrounding whitespace, so "Card Name",
// "card name", and " Card Name " all work.
const COLUMN_ALIASES = {
  cardName: ["card name", "name", "card"],
  setName: ["set name", "set"],
  cardCode: ["card code #", "card code", "code", "card code number"],
  price: ["price"],
};

// Recognized condition codes, matched as a trailing "(XX)" suffix on the
// card name, e.g. "Charmander (MP)" -> name "Charmander", condition "MP".
const CONDITION_SUFFIX = /\s*\(\s*(NM|LP|MP|HP)\s*\)\s*$/i;

// Normalizes a header string for comparison: lowercase + trimmed.
function normalizeHeader(header) {
  return String(header || "").trim().toLowerCase();
}

// Builds a map from our internal field names (cardName, setName, ...) to
// the actual header string used in this particular spreadsheet, so we can
// read/write the right cell regardless of exact header capitalization.
function mapColumns(headerRow) {
  const columnMap = {};

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const matchedHeader = headerRow.find((header) =>
      aliases.includes(normalizeHeader(header))
    );
    if (matchedHeader !== undefined) {
      columnMap[field] = matchedHeader;
    }
  }

  return columnMap;
}

// Splits a raw card name into its clean name and condition code. Falls
// back to "NM" when no "(NM|LP|MP|HP)" suffix is present, since that's
// the pricer's own default for unrecognized/missing condition.
function splitNameAndCondition(rawName) {
  const match = rawName.match(CONDITION_SUFFIX);
  if (!match) {
    return { cleanName: rawName.trim(), condition: "NM" };
  }
  return {
    cleanName: rawName.slice(0, match.index).trim(),
    condition: match[1].toUpperCase(),
  };
}

// Parses a full CSV text blob into an array of rows (each an array of
// string cells), honoring quoted fields that may contain commas, quotes
// (escaped as ""), or newlines.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // Flush the last field/row if the file doesn't end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

// Quotes a single CSV field only when necessary (contains a comma, quote,
// or newline), escaping embedded quotes by doubling them.
function serializeCsvField(value) {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function serializeCsv(rows) {
  return rows.map((row) => row.map(serializeCsvField).join(",")).join("\r\n");
}

// Reads an uploaded .csv File object and returns:
//   { rows: [{ cardName, condition, setName, cardCode, price, _original }], columnMap, headerRow }
// `_original` keeps the raw row so we can preserve any extra columns on export.
export async function readInventoryFile(file) {
  const text = await file.text();
  const grid = parseCsv(text);

  if (grid.length === 0) {
    throw new Error("Spreadsheet is empty.");
  }

  const [headerRow, ...dataRows] = grid;
  const columnMap = mapColumns(headerRow);

  const requiredFields = ["cardName", "setName", "price"];
  const missingFields = requiredFields.filter((field) => !(field in columnMap));
  if (missingFields.length > 0) {
    throw new Error(
      `Spreadsheet is missing required column(s): ${missingFields.join(", ")}`
    );
  }

  const rows = dataRows
    // Skip fully blank rows (common at the end of exported spreadsheets).
    .filter((row) => row.some((cell) => String(cell).trim() !== ""))
    .map((row) => {
      const rowObject = {};
      headerRow.forEach((header, index) => {
        rowObject[header] = row[index];
      });

      const rawName = String(rowObject[columnMap.cardName] || "").trim();
      const { cleanName, condition } = splitNameAndCondition(rawName);

      return {
        cardName: cleanName,
        condition,
        setName: String(rowObject[columnMap.setName] || "").trim(),
        cardCode: columnMap.cardCode
          ? String(rowObject[columnMap.cardCode] || "").trim()
          : "",
        price: rowObject[columnMap.price],
        _original: rowObject,
      };
    });

  return { rows, columnMap, headerRow };
}

// Builds and triggers a download of a .csv file containing the priced
// results. `results` is the array produced in main.js, each with a
// `newPrice` field (number or null) and the original row data.
export function downloadResultsAsCsv(results, columnMap, headerRow, filename) {
  const priceHeader = columnMap.price;

  const outputRows = results.map((result) => {
    const outputRow = { ...result._original };
    outputRow[priceHeader] = result.newPrice ?? outputRow[priceHeader];
    return headerRow.map((header) => outputRow[header]);
  });

  const csvText = serializeCsv([headerRow, ...outputRows]);
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
