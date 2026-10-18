import { describe, expect, it } from "vitest";
import { annualizedVolatility, amountRatio, breadthMean, breadthRatio, intervalReturn, maximumDrawdown, simpleMovingAverage } from "@/lib/server/metrics";
import type { BreadthPoint, PricePoint } from "@/lib/contracts/research";

describe("market metrics", () => {
  it("calculates interval return and rejects insufficient or invalid prices", () => {
    expect(intervalReturn([100, 102, 105], 2)).toBeCloseTo(0.05);
    expect(intervalReturn([100, 102], 2)).toBeNull();
    expect(intervalReturn([100, 0, 105], 2)).toBeNull();
  });

  it("calculates a simple moving average from the latest window", () => {
    expect(simpleMovingAverage([1, 2, 3, 4], 3)).toBe(3);
    expect(simpleMovingAverage([1, 2], 3)).toBeNull();
  });

  it("measures drawdown from the running peak", () => {
    expect(maximumDrawdown([100, 120, 90, 110])).toBeCloseTo(-0.25);
    expect(maximumDrawdown([100, 110, 120])).toBe(0);
    expect(maximumDrawdown([100])).toBeNull();
  });

  it("returns zero volatility for a flat series and null when history is short", () => {
    expect(annualizedVolatility([100, 100, 100, 100], 3)).toBe(0);
    expect(annualizedVolatility([100, 101], 2)).toBeNull();
  });

  it("uses the full breadth denominator and refuses mixed populations", () => {
    const points: BreadthPoint[] = [
      { tradeDate: "2026-10-16", upCount: 50, downCount: 40, flatCount: 10, universeDefinition: "A" },
      { tradeDate: "2026-10-17", upCount: 60, downCount: 30, flatCount: 10, universeDefinition: "A" },
    ];
    expect(breadthRatio(points[0])).toBe(0.5);
    expect(breadthMean(points, 2)).toBeCloseTo(0.55);
    expect(breadthMean([{ ...points[0], universeDefinition: "B" }, points[1]], 2)).toBeNull();
  });

  it("compares today's turnover with the preceding twenty observations", () => {
    const points = Array.from({ length: 21 }, (_, index) => ({
      tradeDate: `2026-10-${String(index + 1).padStart(2, "0")}`,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      amountCny: index === 20 ? 200 : 100,
    } satisfies PricePoint));
    expect(amountRatio(points)).toBe(2);
    expect(amountRatio(points.slice(0, 20))).toBeNull();
  });
});
