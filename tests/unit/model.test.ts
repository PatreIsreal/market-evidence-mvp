import { describe, expect, it } from "vitest";
import { researchInputSchema } from "@/lib/contracts/research";
import { createDemoSnapshot } from "@/lib/server/demo-snapshot";
import { createAiPlan, createAiReport } from "@/lib/server/model";

const input = researchInputSchema.parse({
  question: "市场价格结构和参与度是否一致？",
  scope: {
    primaryIndex: "SSE_COMPOSITE",
    period: { kind: "lookback", tradingDays: 60 },
    comparisonIndexes: ["CSI300", "CSI1000"],
  },
});

function liveSnapshot() {
  const snapshot = {
    ...createDemoSnapshot(input, "2026-10-18T02:00:00.000Z"),
    mode: "live" as const,
    synthetic: false,
    sourceLabel: "测试供应商样本",
  };
  for (const status of Object.values(snapshot.dimensionStatuses)) status.status = "available";
  return snapshot;
}

function modelResponse(overrides: Record<string, unknown> = {}) {
  return {
    summary: "所选证据可以描述价格和参与度的当前关系，但不能据此判断未来走势。",
    summaryEvidenceIds: ["E001"],
    observations: [{ statement: "价格区间收益可由所列指数收盘价计算。", evidenceIds: ["E001"] }],
    counterpoints: [],
    uncertainties: [{ statement: "估值与事件维度尚未接入，无法纳入本轮证据。", dimension: "valuation" }],
    reevaluationConditionIds: [],
    ...overrides,
  };
}

describe("structured AI report", () => {
  it("lets the model choose supported research dimensions while code keeps price data mandatory", async () => {
    const fetcher: typeof fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify({ analysisAngle: "先核对价格结构，再检查情绪与市场参与情况。", dimensions: ["breadth", "sentiment"] }) } }],
    });
    const plan = await createAiPlan(input, {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-secret",
      MODEL_NAME: "test-model",
    }, { fetcher });

    expect(plan.dimensions).toEqual(["price", "events", "breadth", "sentiment"]);
    expect(plan.analysisAngle).toContain("情绪");
  });

  it("keeps synthetic demo evidence out of the model", async () => {
    const snapshot = createDemoSnapshot(input, "2026-10-18T02:00:00.000Z");
    let requested = false;
    const fetcher: typeof fetch = async () => {
      requested = true;
      return Response.json({});
    };
    await expect(createAiReport(input, snapshot, {}, { fetcher })).rejects.toMatchObject({ code: "SYNTHETIC_DATA_NOT_SUPPORTED" });
    expect(requested).toBe(false);
  });

  it("parses structured output, checks citations, and sends credentials only in the server request", async () => {
    const snapshot = liveSnapshot();
    let requestUrl = "";
    let authorization = "";
    let thinkingMode: unknown;
    let systemPrompt = "";
    const fetcher: typeof fetch = async (url, init) => {
      requestUrl = String(url);
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      const body = JSON.parse(String(init?.body));
      thinkingMode = body.thinking;
      systemPrompt = body.messages[0].content;
      return Response.json({ choices: [{ message: { content: JSON.stringify(modelResponse()) } }] });
    };
    const report = await createAiReport(input, snapshot, {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-secret",
      MODEL_NAME: "test-model",
      MODEL_THINKING_MODE: "disabled",
    }, { fetcher });

    expect(requestUrl).toBe("https://model.example/v1/chat/completions");
    expect(authorization).toBe("Bearer test-secret");
    expect(report.modelName).toBe("test-model");
    expect(report.generationMode).toBe("model");
    expect(report.evidenceCoverage).toBe(100);
    expect(report.observations[0]?.evidenceIds).toEqual(["E001"]);
    expect(thinkingMode).toEqual({ type: "disabled" });
    expect(systemPrompt).toContain("summary 是给用户的最终结论");
    expect(systemPrompt).toContain("必须直接回答用户问题");
  });

  it("accepts a summary that cites six valid evidence items", async () => {
    const snapshot = liveSnapshot();
    const evidenceIds = snapshot.evidence.slice(0, 6).map((item) => item.id);
    expect(evidenceIds).toHaveLength(6);
    const fetcher: typeof fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify(modelResponse({ summaryEvidenceIds: evidenceIds })) } }],
    });
    const report = await createAiReport(input, snapshot, {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-secret",
      MODEL_NAME: "test-model",
    }, { fetcher });

    expect(report.summaryEvidenceIds).toEqual(evidenceIds);
  });

  it("retries a report with unknown evidence references and still returns a conclusion", async () => {
    const snapshot = liveSnapshot();
    snapshot.evidence.push({
      id: "E900", dimension: "sentiment", label: "涨停封板率", kind: "derived_metric", value: 69.7, unit: "%",
      period: { start: "2026-10-16", end: "2026-10-16" }, dataAsOf: "2026-10-16", status: "available",
      scopeDescription: "测试情绪指标", sourceRefs: [{ datasetId: "test.sentiment", recordKeys: ["2026-10-16"], fields: ["seal_rate"] }], issues: [],
    });
    snapshot.evidence.push({
      id: "E901", dimension: "events", label: "近时段资讯候选", kind: "source_excerpt", value: "未核验资讯", unit: "来源摘要",
      period: { start: "2026-10-16", end: "2026-10-16" }, dataAsOf: "2026-10-16", status: "available",
      scopeDescription: "待核验候选", sourceRefs: [{ datasetId: "test.events", recordKeys: ["1"], fields: ["title"] }], issues: ["未核验"],
    });
    const fetcher: typeof fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify(modelResponse({
        observations: [{ statement: "这条说明引用了本轮没有的证据编号。", evidenceIds: ["E999"] }],
      })) } }],
    });
    const report = await createAiReport(input, snapshot, {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-secret",
      MODEL_NAME: "test-model",
    }, { fetcher });
    expect(report.generationMode).toBe("recovered");
    expect(report.summary).toContain("所选证据可以描述");
    expect(report.observations.length).toBeGreaterThan(0);
    expect(report.summaryEvidenceIds).toContain("E003");
    expect(report.summaryEvidenceIds).toContain("E900");
    expect(report.summaryEvidenceIds).toContain("E901");
    expect(report.observations.some((item) => item.statement.includes("资讯候选"))).toBe(true);
  });

  it("falls back to a rule conclusion when the model repeats unsupported numerical claims", async () => {
    const snapshot = liveSnapshot();
    const fetcher: typeof fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify(modelResponse({
        summary: "当前收益是 987654321.123%，这一数值代表本轮数据。",
        summaryEvidenceIds: [snapshot.evidence[0]!.id],
      })) } }],
    });
    const report = await createAiReport(input, snapshot, {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-key",
      MODEL_NAME: "test-model",
    }, { fetcher });
    expect(report.generationMode).toBe("rule_fallback");
    expect(report.summary).toContain("市场状态");
    expect(report.summaryEvidenceIds.length).toBeGreaterThan(0);
  });

  it("accepts the requested lookback length but still rejects unsupported period numbers", async () => {
    const snapshot = liveSnapshot();
    const source = {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-key",
      MODEL_NAME: "test-model",
    };
    const supported: typeof fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify(modelResponse({
        summary: "本轮覆盖60个交易日，具体日历区间见研究范围。",
      })) } }],
    });
    await expect(createAiReport(input, snapshot, source, { fetcher: supported })).resolves.toMatchObject({
      summary: "本轮覆盖60个交易日，具体日历区间见研究范围。",
    });

    const unsupported: typeof fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify(modelResponse({
        summary: "本轮覆盖777个交易日，具体日历区间见研究范围。",
      })) } }],
    });
    const unsupportedReport = await createAiReport(input, snapshot, source, { fetcher: unsupported });
    expect(unsupportedReport.generationMode).toBe("rule_fallback");
  });

  it("accepts a rounded numerical claim supported by its cited evidence", async () => {
    const snapshot = liveSnapshot();
    const evidence = snapshot.evidence.find((item) => typeof item.value === "number")!;
    const condition = snapshot.switchConditions[0]!;
    const value = (evidence.value as number).toFixed(2);
    const date = evidence.period.end.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1年$2月$3日");
    const fetcher: typeof fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify(modelResponse({
        summary: `截至 ${date}，当前证据数值为 ${value}${evidence.unit}，与代码复核条件 ${condition.threshold}${condition.unit} 比较。`,
        summaryEvidenceIds: [evidence.id],
        reevaluationConditionIds: [condition.metricId],
      })) } }],
    });
    const report = await createAiReport(input, snapshot, {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-key",
      MODEL_NAME: "test-model",
    }, { fetcher });

    expect(report.summary).toContain(value);
  });

  it("accepts the magnitude of a negative spread when the wording describes a lower value", async () => {
    const snapshot = liveSnapshot();
    const evidence = snapshot.evidence[0]!;
    evidence.value = -3.631998;
    evidence.unit = "百分点";
    const fetcher: typeof fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify(modelResponse({
        summary: "同期小盘指数收益低 3.63 个百分点。",
        summaryEvidenceIds: [evidence.id],
      })) } }],
    });
    const report = await createAiReport(input, snapshot, {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-key",
      MODEL_NAME: "test-model",
    }, { fetcher });

    expect(report.summary).toContain("低 3.63 个百分点");
  });

  it("keeps a report conclusion when the model returns malformed JSON or a network error", async () => {
    const source = {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-key",
      MODEL_NAME: "test-model",
    };
    const malformed: typeof fetch = async () => Response.json({ choices: [{ message: { content: "{broken" } }] });
    const timeout: typeof fetch = async () => { throw new Error("network timeout"); };

    const malformedReport = await createAiReport(input, liveSnapshot(), source, { fetcher: malformed });
    const timeoutReport = await createAiReport(input, liveSnapshot(), source, { fetcher: timeout });
    expect(malformedReport.generationMode).toBe("rule_fallback");
    expect(timeoutReport.generationMode).toBe("rule_fallback");
    expect(malformedReport.summary.length).toBeGreaterThan(12);
    expect(timeoutReport.summary.length).toBeGreaterThan(12);
  });

  it("rejects trading advice even when the model returns valid JSON", async () => {
    const fetcher: typeof fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify(modelResponse({
        summary: "根据当前数据，明天一定涨并且可以满仓。",
      })) } }],
    });
    const report = await createAiReport(input, liveSnapshot(), {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-secret",
      MODEL_NAME: "test-model",
    }, { fetcher });
    expect(report.generationMode).toBe("rule_fallback");
    expect(report.summary).not.toContain("明天一定涨");
  });
});
