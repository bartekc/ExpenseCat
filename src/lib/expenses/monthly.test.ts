import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES } from "./categories";
import {
  categoryRatio,
  currentWarsawPeriod,
  formatPlnCents,
  isMonthlySummary,
  percentageShare,
  summaryFromDatabase,
} from "./monthly";

const period = currentWarsawPeriod(new Date("2026-10-06T12:00:00Z"));
const emptyRows = () =>
  EXPENSE_CATEGORIES.map((category) => ({
    category_code: category.code,
    total_cents: "0",
    expense_count: 0,
    needs_review_count: 0,
  }));

describe("Warsaw monthly period", () => {
  it("uses Warsaw calendar parts across UTC month/year boundaries", () => {
    expect(currentWarsawPeriod(new Date("2026-09-30T22:30:00Z"))).toEqual({
      month: "2026-10",
      startDate: "2026-10-01",
      endDateExclusive: "2026-11-01",
      timeZone: "Europe/Warsaw",
    });
    expect(currentWarsawPeriod(new Date("2026-09-30T21:30:00Z")).month).toBe("2026-09");
    expect(currentWarsawPeriod(new Date("2026-12-31T23:30:00Z"))).toEqual({
      month: "2027-01",
      startDate: "2027-01-01",
      endDateExclusive: "2027-02-01",
      timeZone: "Europe/Warsaw",
    });
  });
  it("covers leap February and summer/winter offsets independently of the host", () => {
    expect(currentWarsawPeriod(new Date("2028-02-29T22:30:00Z"))).toMatchObject({
      month: "2028-02",
      endDateExclusive: "2028-03-01",
    });
    expect(currentWarsawPeriod(new Date("2028-02-29T23:30:00Z")).month).toBe("2028-03");
    expect(currentWarsawPeriod(new Date("2026-06-30T22:00:00Z")).month).toBe("2026-07");
    expect(currentWarsawPeriod(new Date("2026-01-31T23:00:00Z")).month).toBe("2026-02");
  });
});

describe("exact monthly summary", () => {
  it("returns all ten valid zero categories without fabricating missing data", () => {
    const summary = summaryFromDatabase(period, emptyRows());
    expect(summary).toMatchObject({ totalCents: "0", expenseCount: 0, needsReviewCount: 0 });
    expect(summary?.categories).toHaveLength(10);
    expect(isMonthlySummary(summary)).toBe(true);
    expect(summaryFromDatabase(period, [])).toBeNull();
    expect(summaryFromDatabase(period, null)).toBeNull();
  });
  it("sums 10 and 20 cents exactly and supports totals above MAX_SAFE_INTEGER", () => {
    const rows = emptyRows();
    rows[0] = { ...rows[0], total_cents: "10", expense_count: 1 };
    rows[1] = { ...rows[1], total_cents: "20", expense_count: 1 };
    expect(summaryFromDatabase(period, rows)?.totalCents).toBe("30");
    rows[9] = { ...rows[9], total_cents: "9007199254740993", expense_count: 2, needs_review_count: 1 };
    const summary = summaryFromDatabase(period, rows);
    expect(summary).toMatchObject({ totalCents: "9007199254741023", expenseCount: 4, needsReviewCount: 1 });
    expect(isMonthlySummary(summary)).toBe(true);
    expect(isMonthlySummary({ ...summary, totalCents: "9007199254741024" })).toBe(false);
    expect(isMonthlySummary({ ...summary, period: { ...period, endDateExclusive: "2026-12-01" } })).toBe(false);
  });
  it("rejects unknown/reordered categories, malformed cents and unsafe or inconsistent counts", () => {
    for (const patch of [
      { category_code: "custom" },
      { total_cents: 0 },
      { total_cents: "-1" },
      { total_cents: "1.00" },
      { total_cents: "01" },
      { total_cents: "1" },
      { expense_count: -1 },
      { expense_count: Number.MAX_SAFE_INTEGER + 1 },
      { needs_review_count: 1 },
      { expense_count: 1 },
      { total_cents: "1", expense_count: 1, needs_review_count: 1 },
    ]) {
      const rows = emptyRows();
      Object.assign(rows[0], patch);
      expect(summaryFromDatabase(period, rows)).toBeNull();
    }
    expect(summaryFromDatabase(period, emptyRows().reverse())).toBeNull();
    const rows = emptyRows();
    rows[0] = { ...rows[0], total_cents: "1", expense_count: Number.MAX_SAFE_INTEGER };
    rows[1] = { ...rows[1], total_cents: "1", expense_count: 1 };
    expect(summaryFromDatabase(period, rows)).toBeNull();
  });
});

describe("integer-safe PLN presentation", () => {
  it("formats cents with no floating point conversion", () => {
    expect(formatPlnCents("0")).toBe("0,00\u00a0zł");
    expect(formatPlnCents("30")).toBe("0,30\u00a0zł");
    expect(formatPlnCents("9007199254740993")).toBe("90\u00a0071\u00a0992\u00a0547\u00a0409,93\u00a0zł");
  });
  it("rounds shares to one decimal and keeps geometry ratios bounded", () => {
    expect(percentageShare("0", "0")).toBe("0.0");
    expect(percentageShare("1", "3")).toBe("33.3");
    expect(percentageShare("2", "3")).toBe("66.7");
    expect(percentageShare("1", "16")).toBe("6.3");
    expect(percentageShare("9007199254740993", "9007199254740993")).toBe("100.0");
    expect(categoryRatio("0", "0")).toBe(0);
    expect(categoryRatio("9007199254740993", "9007199254740993")).toBe(1);
    expect(categoryRatio("1", "3")).toBeCloseTo(1 / 3, 8);
    expect(() => categoryRatio("2", "1")).toThrow();
    expect(() => formatPlnCents("1.5")).toThrow();
  });
});
