import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { importExpenses } from "./import";
import { parseExpenseCsv } from "./parse-csv";

function mockClient(data: { id: string }[] | null, error: object | null = null) {
  const select = vi.fn().mockResolvedValue({ data, error });
  const upsert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ upsert });
  return { client: { from } as unknown as SupabaseClient, from, upsert, select };
}

const parse = (rows: string[]) =>
  parseExpenseCsv(new TextEncoder().encode(`Data_operacji;Kwota;Tytul\n${rows.join("\n")}`));

describe("importExpenses", () => {
  it("deduplicates within a file and counts already saved database rows", async () => {
    const parsed = parse([
      "2026-09-28;-1.00;Synthetic A",
      "2026-09-28;-01.00;Synthetic A",
      "2026-09-27;-2.00;Synthetic B",
      "2026-09-26;3.00;Synthetic refund",
      "2026-02-30;-4.00;Synthetic bad date",
    ]);
    const { client, upsert } = mockClient([{ id: "new-row" }]);

    const result = await importExpenses(client, "owner-id", parsed);

    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(
      [
        {
          owner_id: "owner-id",
          transaction_date: "2026-09-28",
          amount: "-1.00",
          title: "Synthetic A",
          currency: "PLN",
        },
        {
          owner_id: "owner-id",
          transaction_date: "2026-09-27",
          amount: "-2.00",
          title: "Synthetic B",
          currency: "PLN",
        },
      ],
      { onConflict: "owner_id,transaction_date,amount,title", ignoreDuplicates: true },
    );
    expect(result).toEqual({
      imported: 1,
      duplicates: 2,
      nonExpense: 1,
      invalid: 1,
      invalidRows: [{ row: 6, reason: "Invalid transaction date" }],
      detailsTruncated: false,
    });
  });

  it("skips the write when there are no candidates and caps invalid details", async () => {
    const parsed = {
      candidates: [],
      nonExpense: 2,
      invalid: Array.from({ length: 101 }, (_, index) => ({ row: index + 2, reason: "Invalid amount" })),
    };
    const { client, from } = mockClient([]);

    const result = await importExpenses(client, "owner-id", parsed);

    expect(from).not.toHaveBeenCalled();
    expect(result.invalid).toBe(101);
    expect(result.invalidRows).toHaveLength(100);
    expect(result.detailsTruncated).toBe(true);
  });

  it("reports unexpected database failures without transaction titles", async () => {
    const { client } = mockClient(null, { message: "Synthetic secret title in database error" });

    await expect(
      importExpenses(client, "owner-id", parse(["2026-09-28;-1.00;Synthetic private title"])),
    ).rejects.toThrow("Expense import could not be saved");
  });
});
