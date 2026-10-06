import { describe, expect, it } from "vitest";
import { isExpense, isExpensePage, isUuid, parsePage } from "./contracts";

const expense = {
  id: "00000000-0000-0000-0000-000000000001",
  transaction_date: "2026-10-01",
  amount: -1,
  title: "Synthetic",
  currency: "PLN",
  category_code: "other",
  needs_review: true,
  review_reason: "unmatched",
};

describe("expense API contracts", () => {
  it("shares positive safe page and offset bounds", () => {
    expect(parsePage(null)).toEqual({ page: 1, offset: 0 });
    expect(parsePage("2")).toEqual({ page: 2, offset: 50 });
    expect(parsePage("42949672")).toEqual({ page: 42949672, offset: 2147483550 });
    for (const value of ["0", "-1", "1.5", "01", " 1", "1e3", "42949673", "9007199254740992"]) {
      expect(parsePage(value)).toBeNull();
    }
  });
  it("validates UUID IDs", () => {
    expect(isUuid(expense.id)).toBe(true);
    for (const value of ["", "not-an-id", "1", null, {}, "00000000000000000000000000000001"])
      expect(isUuid(value)).toBe(false);
  });
  it("distinguishes deliberate Other, unmatched and ambiguous", () => {
    expect(isExpense(expense)).toBe(true);
    expect(isExpense({ ...expense, review_reason: "ambiguous" })).toBe(true);
    expect(isExpense({ ...expense, needs_review: false, review_reason: null })).toBe(true);
    expect(isExpense({ ...expense, category_code: "groceries", needs_review: false, review_reason: null })).toBe(true);
    for (const patch of [
      { category_code: "custom" },
      { category_code: "groceries" },
      { needs_review: false },
      { review_reason: null },
      { review_reason: "other" },
      { needs_review: "true" },
      { amount: 1 },
      { amount: NaN },
    ])
      expect(isExpense({ ...expense, ...patch })).toBe(false);
  });
  it("checks the existing page envelope and safe counts", () => {
    const page = { expenses: [expense], page: 1, pageSize: 50, total: 1, totalPages: 1 };
    expect(isExpensePage(page)).toBe(true);
    for (const patch of [
      { total: Number.MAX_SAFE_INTEGER + 1 },
      { page: 0 },
      { pageSize: 100 },
      { totalPages: 0 },
      { expenses: [{ ...expense, category_code: "custom" }] },
      { expenses: Array.from({ length: 51 }, () => expense) },
    ]) {
      expect(isExpensePage({ ...page, ...patch })).toBe(false);
    }
  });
});
