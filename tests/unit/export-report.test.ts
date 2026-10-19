import { describe, expect, it } from "vitest";
import { researchInputSchema } from "@/lib/contracts/research";
import { createDemoSnapshot } from "@/lib/server/demo-snapshot";
import { snapshotToMarkdown } from "@/lib/client/export-report";

describe("Markdown research export", () => {
  it("includes source status, evidence IDs, and correctly identifies the live AI report", () => {
    const input = researchInputSchema.parse({
      question: "检查市场状态",
      scope: {
        primaryIndex: "SSE_COMPOSITE",
        period: { kind: "lookback", tradingDays: 20 },
        comparisonIndexes: ["CSI300", "CSI1000"],
      },
    });
    const snapshot = createDemoSnapshot(input, "2026-10-18T02:00:00.000Z");
    snapshot.mode = "live";
    snapshot.synthetic = false;
    snapshot.sourceLabel = "同花顺扶摇金融数据 API";
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
    snapshot.evidence.push({
      id: "E999",
      dimension: "events",
      label: "快讯候选",
      kind: "source_excerpt",
      value: "这是测试摘要。",
      unit: "来源摘要",
      period: { start: "2026-10-19", end: "2026-10-19" },
      dataAsOf: "2026-10-19 16:00:00",
      status: "available",
      scopeDescription: "A 股快讯候选。",
      sourceRefs: [{ datasetId: "fuyao.news.flash", recordKeys: ["100"], fields: ["title", "summary"], sourceUrl: "https://example.com/news/100" }],
      issues: ["未核验"],
    });

    const markdown = snapshotToMarkdown(snapshot);
    expect(markdown).toContain("## AI 最终结论");
    expect(markdown).toContain("证据：E001");
    expect(markdown).toContain("七维证据覆盖：67%");
    expect(markdown).toContain("AI 最终结论由 test-model 基于本轮证据生成");
    expect(markdown).toContain("[原文](https://example.com/news/100)");
    expect(markdown).not.toContain("运行时 AI 未连接");
  });

  it("clearly marks a demo export with no AI report", () => {
    const input = researchInputSchema.parse({
      question: "检查市场状态",
      scope: {
        primaryIndex: "SSE_COMPOSITE",
        period: { kind: "lookback", tradingDays: 20 },
        comparisonIndexes: ["CSI300", "CSI1000"],
      },
    });
    const snapshot = createDemoSnapshot(input, "2026-10-18T02:00:00.000Z");

    const markdown = snapshotToMarkdown(snapshot);
    expect(markdown).toContain("模式：demo（合成演示）");
    expect(markdown).toContain("本轮未生成 AI 最终结论");
    expect(markdown).toContain("合成数据与代码计算仅用于演示");
  });
});
