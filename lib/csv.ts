/**
 * CSV downloads (Finished Trips and Attendance): what the screen's filters
 * show, as a file Excel opens directly.
 */

export type CsvCell = string | number | boolean | null | undefined;

/**
 * One cell: blank for none, Yes/No for a checkbox, quoted when it holds a
 * comma, quote or line break. Text that starts like a formula (= + - @) gets
 * a leading ' so a spreadsheet shows it rather than runs it.
 */
function cell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A header row and data rows, CRLF-separated as RFC 4180 has it. */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}

/** Saves the CSV in the browser, with a byte-order mark so Excel reads it as UTF-8 (→, ñ). */
export function downloadCsv(fileName: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
