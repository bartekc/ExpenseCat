import Papa from "papaparse";

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000;
export const MAX_TITLE_BYTES = 1024;

const HEADER = ["Data_operacji", "Kwota", "Tytul"];
const MAX_AMOUNT = 9_999_999_999.99;

export interface ExpenseCandidate {
  row: number;
  transactionDate: string;
  amount: string;
  title: string;
  currency: "PLN";
}

export interface InvalidExpenseRow {
  row: number;
  reason: string;
}

export interface ParsedExpenseCsv {
  candidates: ExpenseCandidate[];
  nonExpense: number;
  invalid: InvalidExpenseRow[];
}

export class ExpenseCsvFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpenseCsvFileError";
  }
}

function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1250", { fatal: true }).decode(bytes);
  }
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;

  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function classifyRow(cells: string[], row: number, result: ParsedExpenseCsv): void {
  if (cells.length !== 3) {
    result.invalid.push({ row, reason: "Expected exactly three columns" });
    return;
  }

  const [transactionDate, amount, title] = cells.map((cell) => cell.trim());
  if (!isCalendarDate(transactionDate)) {
    result.invalid.push({ row, reason: "Invalid transaction date" });
    return;
  }

  if (!/^[+-]?\d+\.\d{2}$/.test(amount) || !Number.isFinite(Number(amount)) || Math.abs(Number(amount)) > MAX_AMOUNT) {
    result.invalid.push({ row, reason: "Invalid amount" });
    return;
  }

  if (!title) {
    result.invalid.push({ row, reason: "Missing title" });
    return;
  }

  if (new TextEncoder().encode(title).byteLength > MAX_TITLE_BYTES) {
    result.invalid.push({ row, reason: "Title exceeds 1024 UTF-8 bytes" });
    return;
  }

  if (Number(amount) >= 0) {
    result.nonExpense++;
    return;
  }

  result.candidates.push({ row, transactionDate, amount, title, currency: "PLN" });
}

export function parseExpenseCsv(bytes: Uint8Array): ParsedExpenseCsv {
  if (bytes.byteLength === 0) throw new ExpenseCsvFileError("CSV file is empty");
  if (bytes.byteLength > MAX_CSV_BYTES) throw new ExpenseCsvFileError("CSV file exceeds 2 MiB");

  let csv: string;
  try {
    csv = decodeCsv(bytes);
  } catch {
    throw new ExpenseCsvFileError("CSV encoding is unsupported");
  }

  const result: ParsedExpenseCsv = { candidates: [], nonExpense: 0, invalid: [] };
  let nextRow = 1;
  let cursor = 0;
  let recordCount = 0;
  const parseState: { fileError: string | null } = { fileError: null };

  Papa.parse<string[]>(csv, {
    delimiter: ";",
    skipEmptyLines: false,
    step: (record, parser) => {
      if (record.errors.length > 0) {
        parseState.fileError = "CSV structure is invalid";
        parser.abort();
        return;
      }

      const sourceRow = nextRow;
      const consumed = csv.slice(cursor, record.meta.cursor);
      nextRow += (consumed.match(/\n/g) ?? []).length;
      cursor = record.meta.cursor;

      // Papa Parse reports the empty record after a final line ending as a row.
      if (
        record.data.length === 1 &&
        record.data[0] === "" &&
        record.meta.cursor === csv.length &&
        /\r?\n$/.test(csv)
      ) {
        return;
      }

      if (recordCount === 0) {
        if (record.data.length !== HEADER.length || record.data.some((column, index) => column !== HEADER[index])) {
          parseState.fileError = "CSV header must be Data_operacji;Kwota;Tytul";
          parser.abort();
          return;
        }
      } else {
        if (recordCount > MAX_CSV_ROWS) {
          parseState.fileError = "CSV exceeds 10,000 data rows";
          parser.abort();
          return;
        }
        classifyRow(record.data, sourceRow, result);
      }
      recordCount++;
    },
  });

  if (parseState.fileError) throw new ExpenseCsvFileError(parseState.fileError);
  if (recordCount === 0) throw new ExpenseCsvFileError("CSV header is missing");
  return result;
}
