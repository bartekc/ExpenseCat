import { isExpenseCategoryCode, type ExpenseCategoryCode } from "./categories";

export const EXPENSE_PAGE_SIZE = 50;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parsePage(value: string | null): { page: number; offset: number } | null {
  const text = value ?? "1";
  if (!/^[1-9]\d*$/.test(text)) return null;
  const page = Number(text);
  const offset = (page - 1) * EXPENSE_PAGE_SIZE;
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(offset) || offset > 2_147_483_647 - EXPENSE_PAGE_SIZE) {
    return null;
  }
  return { page, offset };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
}

export interface Expense {
  id: string;
  transaction_date: string;
  amount: string | number;
  title: string;
  currency: "PLN";
  category_code: ExpenseCategoryCode;
  needs_review: boolean;
  review_reason: "unmatched" | "ambiguous" | null;
}

export interface ExpensePage {
  expenses: Expense[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function isExpense(value: unknown): value is Expense {
  if (!isRecord(value)) return false;
  const amountValid =
    (typeof value.amount === "number" && Number.isFinite(value.amount) && value.amount < 0) ||
    (typeof value.amount === "string" && /^-\d+(?:\.\d{1,2})?$/.test(value.amount) && Number(value.amount) < 0);
  return (
    isUuid(value.id) &&
    typeof value.transaction_date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.transaction_date) &&
    amountValid &&
    typeof value.title === "string" &&
    value.currency === "PLN" &&
    isExpenseCategoryCode(value.category_code) &&
    ((value.needs_review === false && value.review_reason === null) ||
      (value.needs_review === true &&
        value.category_code === "other" &&
        (value.review_reason === "unmatched" || value.review_reason === "ambiguous")))
  );
}

export function isExpensePage(value: unknown): value is ExpensePage {
  return (
    isRecord(value) &&
    typeof value.page === "number" &&
    parsePage(String(value.page)) !== null &&
    value.pageSize === EXPENSE_PAGE_SIZE &&
    isSafeCount(value.total) &&
    value.totalPages === Math.ceil(value.total / EXPENSE_PAGE_SIZE) &&
    Array.isArray(value.expenses) &&
    value.expenses.length <= EXPENSE_PAGE_SIZE &&
    value.expenses.every(isExpense)
  );
}

export const expenseJson = (body: object, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
