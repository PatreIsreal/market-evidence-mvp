import { describe, expect, it } from "vitest";
import { researchInputSchema } from "@/lib/contracts/research";
import { createDemoSnapshot } from "@/lib/server/demo-snapshot";
import { assessResearchConfidence } from "@/lib/confidence";

function createSnapshot() {
  const input = researchInputSchema.parse({
    question: "检查市场状态",
    scope: {
      primaryIndex: "SSE_COMPOSITE",
      period: { kind: "lookback", tradingDays: 20 },
      comparisonIndexes: ["CSI300", "CSI1000"],
    },
  });
  return createDemoSnapshot(input, "2026-10-18T02:00:00.000Z");
}

describe("research confidence assessment", () => {
  it("does not assign real-market confidence to synthetic data or missing reports", () => {
    const snapshot = createSnapshot();
    expect(assessResearchConfidence(snapshot, true).level).toBe("not_assessed");

    snapshot.synthetic = false;
    expect(assessResearchConfidence(snapshot, false).level).toBe("not_assessed");
  });

  it("lowers confidence when a focus-required dimension is stale", () => {
    const snapshot = createSnapshot();
    snapshot.synthetic = false;
    snapshot.dimensionStatuses.breadth = { status: "stale", dataAsOf: "2026-10-18", explanation: "日期不匹配" };

    const confidence = assessResearchConfidence(snapshot, true);
    expect(confidence.level).toBe("low");
    expect(confidence.reason).toContain("市场宽度");
  });

  it("caps confidence at medium when only single-day breadth is available", () => {
    const snapshot = createSnapshot();
    snapshot.synthetic = false;
    for (const dimension of Object.keys(snapshot.dimensionStatuses) as Array<keyof typeof snapshot.dimensionStatuses>) {
      snapshot.dimensionStatuses[dimension] = { status: "available", dataAsOf: "2026-10-16", explanation: "test fixture" };
    }
    snapshot.breadthSeries = snapshot.breadthSeries.slice(0, 1);

    expect(assessResearchConfidence(snapshot, true).level).toBe("medium");
  });
});
