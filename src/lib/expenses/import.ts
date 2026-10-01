import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedExpenseCsv } from "./parse-csv";

const MAX_INVALID_DETAILS = 100;

export interface ExpenseImportResult {
  imported: number;
  duplicates: number;
  nonExpense: number;
  invalid: number;
  invalidRows: { row: number; reason: string }[];
  detailsTruncated: boolean;
}

export async function importExpenses(
  supabase: SupabaseClient,
  ownerId: string,
  parsed: ParsedExpenseCsv,
): Promise<ExpenseImportResult> {
  const unique = new Map<string, (typeof parsed.candidates)[number]>();

  for (const candidate of parsed.candidates) {
    // The database stores numeric(12,2), so use its canonical decimal value for in-file deduplication too.
    const amount = Number(candidate.amount).toFixed(2);
    const key = JSON.stringify([candidate.transactionDate, amount, candidate.title]);
    if (!unique.has(key)) unique.set(key, { ...candidate, amount });
  }

  let imported = 0;
  if (unique.size > 0) {
    const rows = [...unique.values()].map((candidate) => ({
      owner_id: ownerId,
      transaction_date: candidate.transactionDate,
      amount: candidate.amount,
      title: candidate.title,
      currency: candidate.currency,
    }));
    const { data, error } = await supabase
      .from("expenses")
      .upsert(rows, { onConflict: "owner_id,transaction_date,amount,title", ignoreDuplicates: true })
      .select("id");

    if (error) throw new Error("Expense import could not be saved");
    imported = data.length;
  }

  return {
    imported,
    duplicates: parsed.candidates.length - imported,
    nonExpense: parsed.nonExpense,
    invalid: parsed.invalid.length,
    invalidRows: parsed.invalid.slice(0, MAX_INVALID_DETAILS),
    detailsTruncated: parsed.invalid.length > MAX_INVALID_DETAILS,
  };
}
