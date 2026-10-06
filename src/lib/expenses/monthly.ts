import { EXPENSE_CATEGORIES, type ExpenseCategoryCode } from "./categories";
import { isRecord, isSafeCount } from "./contracts";

export interface MonthlyPeriod {
  month: string;
  startDate: string;
  endDateExclusive: string;
  timeZone: "Europe/Warsaw";
}
export interface CategoryTotal {
  code: ExpenseCategoryCode;
  label: string;
  totalCents: string;
  expenseCount: number;
  needsReviewCount: number;
}
export interface MonthlySummary {
  period: MonthlyPeriod;
  currency: "PLN";
  totalCents: string;
  expenseCount: number;
  needsReviewCount: number;
  categories: CategoryTotal[];
}

export function currentWarsawPeriod(instant: Date): MonthlyPeriod {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(instant);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const monthText = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    month: monthText,
    startDate: `${monthText}-01`,
    endDateExclusive: `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`,
    timeZone: "Europe/Warsaw",
  };
}

export function isCentText(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value);
}

export function summaryFromDatabase(period: MonthlyPeriod, value: unknown): MonthlySummary | null {
  if (!Array.isArray(value) || value.length !== EXPENSE_CATEGORIES.length) return null;
  const categories: CategoryTotal[] = [];
  let total = 0n;
  let count = 0;
  let reviewCount = 0;
  for (const [index, category] of EXPENSE_CATEGORIES.entries()) {
    const row: unknown = value[index];
    if (
      !isRecord(row) ||
      row.category_code !== category.code ||
      !isCentText(row.total_cents) ||
      !isSafeCount(row.expense_count) ||
      !isSafeCount(row.needs_review_count) ||
      row.needs_review_count > row.expense_count ||
      (category.code !== "other" && row.needs_review_count !== 0) ||
      (row.expense_count === 0 ? row.total_cents !== "0" : row.total_cents === "0")
    )
      return null;
    total += BigInt(row.total_cents);
    count += row.expense_count;
    reviewCount += row.needs_review_count;
    if (!isSafeCount(count) || !isSafeCount(reviewCount)) return null;
    categories.push({
      ...category,
      totalCents: row.total_cents,
      expenseCount: row.expense_count,
      needsReviewCount: row.needs_review_count,
    });
  }
  return {
    period,
    currency: "PLN",
    totalCents: total.toString(),
    expenseCount: count,
    needsReviewCount: reviewCount,
    categories,
  };
}

export function isMonthlySummary(value: unknown): value is MonthlySummary {
  if (
    !isRecord(value) ||
    !isRecord(value.period) ||
    value.currency !== "PLN" ||
    value.period.timeZone !== "Europe/Warsaw" ||
    typeof value.period.month !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.period.month) ||
    !Array.isArray(value.categories)
  )
    return false;
  const expectedPeriod = currentWarsawPeriod(new Date(`${value.period.month}-15T12:00:00Z`));
  if (
    value.period.startDate !== expectedPeriod.startDate ||
    value.period.endDateExclusive !== expectedPeriod.endDateExclusive
  )
    return false;
  const rows = value.categories.map((category: unknown) =>
    isRecord(category)
      ? {
          category_code: category.code,
          total_cents: category.totalCents,
          expense_count: category.expenseCount,
          needs_review_count: category.needsReviewCount,
        }
      : null,
  );
  const summary = summaryFromDatabase(expectedPeriod, rows);
  return (
    summary !== null &&
    summary.totalCents === value.totalCents &&
    summary.expenseCount === value.expenseCount &&
    summary.needsReviewCount === value.needsReviewCount &&
    value.categories.every(
      (category: unknown, index: number) => isRecord(category) && category.label === EXPENSE_CATEGORIES[index].label,
    )
  );
}

function cents(value: string): bigint {
  if (!isCentText(value)) throw new Error("Expected non-negative integer cents");
  return BigInt(value);
}

export function formatPlnCents(value: string): string {
  const amount = cents(value);
  const whole = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(amount / 100n);
  return `${whole},${(amount % 100n).toString().padStart(2, "0")}\u00A0zł`;
}

export function percentageShare(value: string, total: string): string {
  const part = cents(value);
  const denominator = cents(total);
  if (part > denominator) throw new Error("Category exceeds total");
  const tenths = denominator === 0n ? 0n : (part * 1000n + denominator / 2n) / denominator;
  return `${tenths / 10n}.${tenths % 10n}`;
}

export function categoryRatio(value: string, total: string): number {
  const part = cents(value);
  const denominator = cents(total);
  if (part > denominator) throw new Error("Category exceeds total");
  // Only a bounded fixed-point ratio crosses into floating point for chart geometry.
  return denominator === 0n ? 0 : Number((part * 1_000_000_000n) / denominator) / 1_000_000_000;
}
