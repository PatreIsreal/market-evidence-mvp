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
  return {
    ...createDemoSnapshot(input, "2026-10-18T02:00:00.000Z"),
    mode: "live" as const,
    synthetic: false,
    sourceLabel: "测试供应商样本",
  };
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
      choices: [{ message: { content: JSON.stringify({ analysisAngle: "先核对价格结构，再检查市场参与情况。", dimensions: ["breadth"] }) } }],
    });
    const plan = await createAiPlan(input, {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-secret",
      MODEL_NAME: "test-model",
    }, { fetcher });

    expect(plan.dimensions).toEqual(["price", "breadth"]);
    expect(plan.analysisAngle).toContain("参与情况");
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
    const fetcher: typeof fetch = async (url, init) => {
      requestUrl = String(url);
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      thinkingMode = JSON.parse(String(init?.body)).thinking;
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
    expect(report.evidenceCoverage).toBe(100);
    expect(report.observations[0]?.evidenceIds).toEqual(["E001"]);
    expect(thinkingMode).toEqual({ type: "disabled" });
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

  it("rejects unknown evidence references", async () => {
    const fetcher: typeof fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify(modelResponse({
        observations: [{ statement: "这条说明引用了本轮没有的证据编号。", evidenceIds: ["E999"] }],
      })) } }],
    });
    await expect(createAiReport(input, liveSnapshot(), {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-secret",
      MODEL_NAME: "test-model",
    }, { fetcher })).rejects.toMatchObject({ code: "REPORT_VALIDATION_FAILED" });
  });

  it("rejects numerical claims that the cited evidence cannot support", async () => {
    const snapshot = liveSnapshot();
    const fetcher: typeof fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify(modelResponse({
        summary: "当前收益是 987654321.123%，这一数值代表本轮数据。",
        summaryEvidenceIds: [snapshot.evidence[0]!.id],
      })) } }],
    });
    await expect(createAiReport(input, snapshot, {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-key",
      MODEL_NAME: "test-model",
    }, { fetcher })).rejects.toMatchObject({ code: "REPORT_VALIDATION_FAILED" });
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
    await expect(createAiReport(input, snapshot, source, { fetcher: unsupported }))
      .rejects.toMatchObject({ code: "REPORT_VALIDATION_FAILED" });
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

  it("surfaces malformed JSON and model network timeouts with stable error codes", async () => {
    const source = {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-key",
      MODEL_NAME: "test-model",
    };
    const malformed: typeof fetch = async () => Response.json({ choices: [{ message: { content: "{broken" } }] });
    const timeout: typeof fetch = async () => { throw new Error("network timeout"); };

    await expect(createAiReport(input, liveSnapshot(), source, { fetcher: malformed }))
      .rejects.toMatchObject({ code: "MODEL_INVALID_RESPONSE" });
    await expect(createAiReport(input, liveSnapshot(), source, { fetcher: timeout }))
      .rejects.toMatchObject({ code: "MODEL_NETWORK_ERROR" });
  });

  it("rejects trading advice even when the model returns valid JSON", async () => {
    const fetcher: typeof fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify(modelResponse({
        summary: "根据当前数据，明天一定涨并且可以满仓。",
      })) } }],
    });
    await expect(createAiReport(input, liveSnapshot(), {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-secret",
      MODEL_NAME: "test-model",
    }, { fetcher })).rejects.toMatchObject({ code: "REPORT_VALIDATION_FAILED" });
  });
});
