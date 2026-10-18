import { describe, expect, it } from "vitest";
import { researchInputSchema } from "@/lib/contracts/research";
import { createDemoSnapshot } from "@/lib/server/demo-snapshot";
import { createAiReport } from "@/lib/server/model";

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
    const fetcher: typeof fetch = async (url, init) => {
      requestUrl = String(url);
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      return Response.json({ choices: [{ message: { content: JSON.stringify(modelResponse()) } }] });
    };
    const report = await createAiReport(input, snapshot, {
      MODEL_BASE_URL: "https://model.example/v1",
      MODEL_API_KEY: "test-secret",
      MODEL_NAME: "test-model",
    }, { fetcher });

    expect(requestUrl).toBe("https://model.example/v1/chat/completions");
    expect(authorization).toBe("Bearer test-secret");
    expect(report.modelName).toBe("test-model");
    expect(report.evidenceCoverage).toBe(100);
    expect(report.observations[0]?.evidenceIds).toEqual(["E001"]);
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
