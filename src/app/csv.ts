/**
 * CSV for the Parent Dashboard's "Download CSV" (task M3-11, PLAN.md §4.4).
 *
 * Everything stays on the device: the file is built here and handed to the browser as a local
 * download (a Blob and an anchor, `downloadBlob` in `ImportExport.tsx`). No network, no third-party
 * code.
 *
 * RFC 4180: comma-separated, CRLF line ends, a cell holding a comma, quote or line break is quoted
 * and its quotes doubled. The file starts with a UTF-8 byte-order mark so spreadsheet apps read
 * accented nicknames right.
 *
 * **Formula injection.** A spreadsheet runs a text cell that starts with `=`, `+`, `-` or `@` (and
 * some apps also tab or carriage return) as a formula. A nickname is the child's own text, so every
 * text cell that starts with one of those gets a leading `'`, which spreadsheets show as plain
 * text. Numbers are written as numbers and never escaped.
 */

/** A cell: text is escaped; a number is written as it is (non-finite numbers as empty). */
export type CsvCell = string | number;

/** The UTF-8 byte-order mark at the start of the file. */
export const CSV_BOM = "﻿";

/** Starts a spreadsheet formula when it leads a text cell. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** A text cell made safe to open in a spreadsheet: a leading `'` before a formula start. */
export function defuseFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** One cell as CSV text. */
export function csvCell(value: CsvCell): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const safe = defuseFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Rows as CSV text: BOM, one CRLF-ended line per row. */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return CSV_BOM + rows.map((row) => `${row.map(csvCell).join(",")}\r\n`).join("");
}

/**
 * Parses CSV text (as {@link toCsv} writes it) back into rows of strings. A leading BOM is
 * skipped. Escaping by {@link defuseFormula} is not undone: the `'` is part of the cell. Used by
 * the tests to prove the file round-trips.
 */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(CSV_BOM) ? text.slice(CSV_BOM.length) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (c === '"') quoted = false;
      else cell += c;
      i += 1;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && src[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
    i += 1;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** A CSV text as a Blob for a local download. */
export function csvBlob(text: string): Blob {
  return new Blob([text], { type: "text/csv;charset=utf-8" });
}

/**
 * A file name for a nickname's sessions: `voxel-typer-sessions-<nickname>-<date>.csv`, with the
 * nickname cut to plain letters, digits and dashes (no path or odd characters reach the name).
 */
export function csvFileName(nickname: string, date: string): string {
  const slug = nickname
    .normalize("NFKD")
    .replaceAll(/[^A-Za-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 24);
  return `voxel-typer-sessions-${slug === "" ? "player" : slug}-${date}.csv`;
}
