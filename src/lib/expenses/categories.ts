export const EXPENSE_CATEGORIES = [
  { code: "groceries", label: "Groceries" },
  { code: "eating_out", label: "Eating out" },
  { code: "transport", label: "Transport" },
  { code: "housing_bills", label: "Housing & bills" },
  { code: "household", label: "Household" },
  { code: "health", label: "Health" },
  { code: "clothing", label: "Clothing" },
  { code: "shopping", label: "Shopping" },
  { code: "leisure", label: "Leisure" },
  { code: "other", label: "Other" },
] as const;

export type ExpenseCategoryCode = (typeof EXPENSE_CATEGORIES)[number]["code"];

export function isExpenseCategoryCode(value: unknown): value is ExpenseCategoryCode {
  return typeof value === "string" && EXPENSE_CATEGORIES.some((category) => category.code === value);
}
