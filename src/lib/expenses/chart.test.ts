import { describe, expect, it } from "vitest";
import { pieSlices } from "./chart";
import { formatPlnCents, percentageShare } from "./monthly";

describe("static pie geometry", () => {
  it("draws no wedges for an empty month", () => {
    expect(pieSlices(Array<string>(10).fill("0"))).toEqual([]);
    expect(pieSlices([])).toEqual([]);
  });

  it("uses a complete circle for one positive category, retaining its index", () => {
    expect(pieSlices(["0", "9007199254740993", "0"])).toEqual([{ index: 1, kind: "circle" }]);
  });

  it("omits zero categories and closes multiple slices with finite unit-circle coordinates", () => {
    const slices = pieSlices(["0", "10", "20", "0"]);
    expect(slices.map((slice) => slice.index)).toEqual([1, 2]);
    expect(slices.every((slice) => slice.kind === "wedge")).toBe(true);
    if (slices[0].kind !== "wedge" || slices[1].kind !== "wedge") throw new Error("Expected wedges");
    expect(slices[0].path).toContain("A 1 1 0 0 1");
    expect(slices[1].path).toContain("A 1 1 0 1 1");
    expect(slices[0].path).not.toMatch(/NaN|Infinity/);
    expect(slices[1].path).not.toMatch(/NaN|Infinity/);
    const firstStart = slices[0].path.split(" L ")[1].split(" A ")[0];
    const lastEnd = slices[1].path.split(" ").slice(-3, -1).join(" ");
    const [startX, startY] = firstStart.split(" ").map(Number);
    const [endX, endY] = lastEnd.split(" ").map(Number);
    expect(endX).toBeCloseTo(startX, 12);
    expect(endY).toBeCloseTo(startY, 12);
  });

  it("keeps a half-circle a small arc and handles large totals without money conversion", () => {
    const slices = pieSlices(["9007199254740993", "9007199254740993"]);
    expect(slices.every((slice) => slice.kind === "wedge" && slice.path.includes("A 1 1 0 0 1"))).toBe(true);
    expect(formatPlnCents("18014398509481986")).toBe("180\u00a0143\u00a0985\u00a0094\u00a0819,86\u00a0zł");
    expect(percentageShare("9007199254740993", "18014398509481986")).toBe("50.0");
  });

  it("retains a finite nondegenerate wedge for a tiny positive category next to a huge total", () => {
    const slices = pieSlices(["9007199254740993", "1", "0"]);
    expect(slices).toHaveLength(2);
    for (const slice of slices) {
      if (slice.kind !== "wedge") throw new Error("Expected wedges");
      const start = slice.path.split(" L ")[1].split(" A ")[0];
      const end = slice.path.split(" ").slice(-3, -1).join(" ");
      expect(start).not.toBe(end);
      expect(slice.path).not.toMatch(/NaN|Infinity/);
    }
  });

  it("rejects invalid cent values rather than inventing a slice", () => {
    for (const value of ["-1", "1.2", "01", "NaN"]) expect(() => pieSlices([value])).toThrow();
  });
});
