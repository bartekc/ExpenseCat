import { categoryRatio, isCentText } from "./monthly";

export type PieSlice = { index: number; kind: "circle" } | { index: number; kind: "wedge"; path: string };

// Unit-circle geometry keeps the SVG independent of its rendered size. Only
// bounded ratios become numbers; money totals remain integers.
export function pieSlices(values: readonly string[]): PieSlice[] {
  if (!values.every(isCentText)) throw new Error("Expected non-negative integer cents");
  const amounts = values.map((value) => BigInt(value));
  const total = amounts.reduce((sum, amount) => sum + amount, 0n);
  if (total === 0n) return [];
  const positive = amounts.flatMap((amount, index) => (amount > 0n ? [index] : []));
  if (positive.length === 1) return [{ index: positive[0], kind: "circle" }];

  // Fixed-point presentation can round a tiny positive share to zero. Keep a
  // subpixel angle for every positive category, then normalize the whole pie.
  // The adjacent legend always supplies the exact amounts and rounded shares.
  const weights = positive.map((index) => Math.max(categoryRatio(values[index], total.toString()), 1e-9));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let cumulative = 0;
  return positive.map((index, position): PieSlice => {
    const start = (cumulative / weightTotal) * Math.PI * 2 - Math.PI / 2;
    cumulative += weights[position];
    const end = (cumulative / weightTotal) * Math.PI * 2 - Math.PI / 2;
    const largeArc = weights[position] * 2 > weightTotal ? 1 : 0;
    return {
      index,
      kind: "wedge",
      path: `M 0 0 L ${Math.cos(start)} ${Math.sin(start)} A 1 1 0 ${largeArc} 1 ${Math.cos(end)} ${Math.sin(end)} Z`,
    };
  });
}
