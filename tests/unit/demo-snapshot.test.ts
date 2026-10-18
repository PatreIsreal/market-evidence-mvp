import { describe, expect, it } from "vitest";
import { researchInputSchema } from "@/lib/contracts/research";
import { createDemoSnapshot } from "@/lib/server/demo-snapshot";

describe("synthetic demo snapshot", () => {
  it("labels every result as synthetic and keeps unavailable dimensions explicit", () => {
    const input = researchInputSchema.parse({
      question: "近 60 日市场状态如何？",
      scope: {
        primaryIndex: "SSE_COMPOSITE",
        period: { kind: "lookback", tradingDays: 60 },
        comparisonIndexes: ["CSI300", "CSI1000"],
      },
    });
    const snapshot = createDemoSnapshot(input, "2026-10-18T02:00:00.000Z");

    expect(snapshot.mode).toBe("demo");
    expect(snapshot.synthetic).toBe(true);
    expect(snapshot.priceSeries).toHaveLength(61);
    expect(snapshot.dimensionStatuses.valuation.status).toBe("unavailable");
    expect(snapshot.evidence.every((item) => item.issues.some((issue) => issue.includes("合成演示数据")))).toBe(true);
    expect(snapshot.sourceLabel).toContain("合成数据");
  });

  it("does not borrow a prior weekday observation for a weekend-only range", () => {
    const input = researchInputSchema.parse({
      question: "周末日期是否有市场数据？",
      scope: {
        primaryIndex: "SSE_COMPOSITE",
        period: { kind: "range", startDate: "2026-10-17", endDate: "2026-10-18" },
        comparisonIndexes: ["CSI300", "CSI1000"],
      },
    });
    const snapshot = createDemoSnapshot(input, "2026-10-18T02:00:00.000Z");

    expect(snapshot.priceSeries).toHaveLength(0);
    expect(snapshot.breadthSeries).toHaveLength(0);
    expect(snapshot.metrics.breadthLatest).toBeNull();
    expect(snapshot.dimensionStatuses.price.status).toBe("missing");
    expect(snapshot.scope.calendarNote).toContain("没有合成工作日");
  });
});
