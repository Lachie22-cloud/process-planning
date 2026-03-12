import * as XLSX from "xlsx";
import * as cptable from "xlsx/dist/cpexcel.full.mjs";
XLSX.set_cptable(cptable);

export interface ParsedRow {
  [key: string]: string | number | null;
}

/**
 * Normalise an Excel date value to ISO YYYY-MM-DD.
 * Handles Excel serial-date numbers, DD/MM/YYYY, DD.MM.YYYY,
 * and passes through already-valid ISO strings.
 */
export function excelDateToISO(value: string | number | null): string | null {
  if (value == null || value === "") return null;

  // Excel serial date number
  if (typeof value === "number") {
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString().split("T")[0] ?? null;
  }

  const str = String(value).trim();

  // DD/MM/YYYY or DD.MM.YYYY
  const dmyMatch = str.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2]!.padStart(2, "0")}-${dmyMatch[1]!.padStart(2, "0")}`;
  }

  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  return null;
}

export function parseExcelFile(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheet = workbook.SheetNames[0];
        if (!firstSheet) {
          resolve([]);
          return;
        }
        const sheet = workbook.Sheets[firstSheet];
        if (!sheet) {
          resolve([]);
          return;
        }
        const rows = XLSX.utils.sheet_to_json<ParsedRow>(sheet);
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
