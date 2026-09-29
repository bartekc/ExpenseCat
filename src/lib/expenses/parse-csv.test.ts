import { describe, expect, it } from "vitest";
import { ExpenseCsvFileError, MAX_CSV_BYTES, parseExpenseCsv } from "./parse-csv";

const encode = (text: string) => new TextEncoder().encode(text);
const header = "Data_operacji;Kwota;Tytul";

describe("parseExpenseCsv", () => {
  it("decodes UTF-8 with a BOM and keeps Polish titles, case, and quoted semicolons", () => {
    const bytes = encode(`\uFEFF${header}\r\n2026-09-28;-12.34;"  Żółć; sklep  "\r\n`);

    expect(parseExpenseCsv(bytes)).toEqual({
      candidates: [{ row: 2, transactionDate: "2026-09-28", amount: "-12.34", title: "Żółć; sklep", currency: "PLN" }],
      nonExpense: 0,
      invalid: [],
    });
  });

  it("falls back to Windows-1250 for Polish characters", () => {
    const prefix = encode(`${header}\n2026-09-28;-1.20;`);
    const bytes = new Uint8Array([...prefix, 0xaf, 0xf3, 0xb3, 0xe6]);

    expect(parseExpenseCsv(bytes).candidates[0].title).toBe("Żółć");
  });

  it("accepts LF, CRLF, escaped quotes, and newlines inside quoted titles", () => {
    const csv = `${header}\n2026-09-28;-1.00;"Pierwsza\nlinia; ""cytat"""\r\n2026-09-29;-2.00;Druga`;

    expect(parseExpenseCsv(encode(csv)).candidates).toEqual([
      { row: 2, transactionDate: "2026-09-28", amount: "-1.00", title: 'Pierwsza\nlinia; "cytat"', currency: "PLN" },
      { row: 4, transactionDate: "2026-09-29", amount: "-2.00", title: "Druga", currency: "PLN" },
    ]);
  });

  it.each(["Kwota;Data_operacji;Tytul", "Data_operacji;Kwota;Title", "Data_operacji;Kwota;Tytul;Extra"])(
    "rejects wrong header %s",
    (wrongHeader) => {
      expect(() => parseExpenseCsv(encode(`${wrongHeader}\n2026-09-28;-1.00;Test`))).toThrow(ExpenseCsvFileError);
    },
  );

  it("rejects empty, oversized, and structurally broken files", () => {
    expect(() => parseExpenseCsv(new Uint8Array())).toThrow("CSV file is empty");
    expect(() => parseExpenseCsv(new Uint8Array(MAX_CSV_BYTES + 1))).toThrow("CSV file exceeds 2 MiB");
    expect(() => parseExpenseCsv(encode(`${header}\n2026-09-28;-1.00;"Unclosed`))).toThrow("CSV structure is invalid");
  });

  it("skips invalid rows without discarding valid rows and never includes titles in reasons", () => {
    const csv = [
      header,
      "2026-02-29;-1.00;Invalid leap day",
      "0000-01-01;-1.00;Invalid year",
      "9999-12-31;-1.00;Valid year",
      "2024-02-29;-1.00;Leap day",
      "2026-09-28;-1,00;Private amount title",
      "2026-09-28;-10000000000.00;Too large",
      "2026-09-28;-1.00;   ",
      "2026-09-28;-1.00;Okay;extra",
      "2026-09-28;-2.00;Final valid",
    ].join("\n");

    const parsed = parseExpenseCsv(encode(csv));
    expect(parsed.candidates.map((candidate) => candidate.row)).toEqual([4, 5, 10]);
    expect(parsed.invalid.map(({ row }) => row)).toEqual([2, 3, 6, 7, 8, 9]);
    expect(parsed.invalid.map(({ reason }) => reason).join(" ")).not.toContain("Private");
  });

  it("classifies positive and zero amounts separately from invalid rows", () => {
    const csv = `${header}\n2026-09-28;+1.00;Refund\n2026-09-28;0.00;Zero\n2026-09-28;-0.00;Negative zero\n2026-09-28;-1.0;Malformed`;
    const parsed = parseExpenseCsv(encode(csv));

    expect(parsed.nonExpense).toBe(3);
    expect(parsed.invalid).toEqual([{ row: 5, reason: "Invalid amount" }]);
    expect(parsed.candidates).toEqual([]);
  });

  it("retains duplicate candidate keys for the import layer to count", () => {
    const csv = `${header}\n2026-09-28;-1.00; Repeat \n2026-09-28;-1.00;Repeat`;
    const { candidates } = parseExpenseCsv(encode(csv));

    expect(candidates).toHaveLength(2);
    expect(candidates[0].row).toBe(2);
    expect(candidates[1].row).toBe(3);
    expect(candidates[0].title).toBe(candidates[1].title);
  });

  it("accepts 10,000 data rows and rejects the next one", () => {
    const row = "2026-09-28;-1.00;Synthetic";
    const accepted = `${header}\n${Array(10_000).fill(row).join("\n")}`;

    expect(parseExpenseCsv(encode(accepted)).candidates).toHaveLength(10_000);
    expect(() => parseExpenseCsv(encode(`${accepted}\n${row}`))).toThrow("CSV exceeds 10,000 data rows");
  });
});
