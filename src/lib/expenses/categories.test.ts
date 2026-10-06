import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES, isExpenseCategoryCode } from "./categories";

describe("expense categories", () => {
  it("keeps the agreed ten codes and labels in display order", () => {
    expect(EXPENSE_CATEGORIES).toEqual([
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
    ]);
    expect(new Set(EXPENSE_CATEGORIES.map((category) => category.code)).size).toBe(10);
  });

  it("recognizes every stable code and rejects arbitrary values", () => {
    for (const category of EXPENSE_CATEGORIES) expect(isExpenseCategoryCode(category.code)).toBe(true);
    for (const value of ["", "Groceries", "custom", "toString", " other ", null, undefined, 1, {}]) {
      expect(isExpenseCategoryCode(value)).toBe(false);
    }
  });
});
