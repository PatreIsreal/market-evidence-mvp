import { describe, expect, it } from "vitest";
import { researchInputSchema } from "@/lib/contracts/research";

const input = {
  question: "指数走势与参与度是否一致？",
  scope: {
    primaryIndex: "SSE_COMPOSITE",
    period: { kind: "lookback", tradingDays: 60 },
    comparisonIndexes: ["CSI300", "CSI1000"],
  },
};

describe("research input contract", () => {
  it("fills stable defaults for a valid research request", () => {
    const parsed = researchInputSchema.parse(input);
    expect(parsed.schemaVersion).toBe("1.0");
    expect(parsed.scope.focus).toBe("overview");
    expect(parsed.scope.asOfDate).toBeNull();
  });

  it("rejects impossible dates and reversed intervals", () => {
    expect(researchInputSchema.safeParse({
      ...input,
      scope: { ...input.scope, period: { kind: "range", startDate: "2026-02-30", endDate: "2026-03-01" } },
    }).success).toBe(false);
    expect(researchInputSchema.safeParse({
      ...input,
      scope: { ...input.scope, period: { kind: "range", startDate: "2026-10-18", endDate: "2026-10-01" } },
    }).success).toBe(false);
  });

  it("rejects unsupported lookback lengths", () => {
    expect(researchInputSchema.safeParse({
      ...input,
      scope: { ...input.scope, period: { kind: "lookback", tradingDays: 30 } },
    }).success).toBe(false);
  });
});
