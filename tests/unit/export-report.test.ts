import { describe, expect, it } from "vitest";
import { researchInputSchema } from "@/lib/contracts/research";
import { createDemoSnapshot } from "@/lib/server/demo-snapshot";
import { snapshotToMarkdown } from "@/lib/client/export-report";

describe("Markdown research export", () => {
  it("includes source status, evidence IDs, and an attached AI report", () => {
    const input = researchInputSchema.parse({
      question: "检查市场状态",
      scope: {
        primaryIndex: "SSE_COMPOSITE",
        period: { kind: "lookback", tradingDays: 20 },
        comparisonIndexes: ["CSI300", "CSI1000"],
      },
    });
    const snapshot = createDemoSnapshot(input, "2026-10-18T02:00:00.000Z");
    snapshot.aiReport = {
      summary: "以下文字仅用于测试导出格式。",
      summaryEvidenceIds: ["E001"],
      observations: [{ statement: "观察项引用一条证据。", evidenceIds: ["E001"] }],
      counterpoints: [],
      uncertainties: [{ statement: "仍缺少真实市场宽度时序。", dimension: "breadth" }],
      reevaluationConditionIds: [],
      evidenceCoverage: 67,
      modelName: "test-model",
    };

    const markdown = snapshotToMarkdown(snapshot);
    expect(markdown).toContain("## AI 证据归纳");
    expect(markdown).toContain("证据：E001");
    expect(markdown).toContain("核心证据覆盖：67%");
    expect(markdown).toContain("合成数据");
  });
});
