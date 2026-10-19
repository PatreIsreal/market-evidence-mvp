import { env } from "cloudflare:workers";
import { researchInputSchema } from "@/lib/contracts/research";
import { createDemoSnapshot } from "@/lib/server/demo-snapshot";
import { createFuyaoSnapshot, FuyaoProviderError } from "@/lib/server/providers/fuyao";
import { createAiPlan, createAiReport, ModelProviderError } from "@/lib/server/model";
import { readRuntimeConfig } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function beijingToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "INVALID_INPUT", message: "请求内容不是有效的 JSON。" }, { status: 400 });
  }

  const parsed = researchInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { code: "INVALID_INPUT", message: "研究问题或范围不符合要求。", details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
      { status: 400 },
    );
  }

  const source = env as unknown as Record<string, string | undefined>;
  const config = readRuntimeConfig(source);
  const today = beijingToday();
  const { period, asOfDate } = parsed.data.scope;
  const requestedEnd = period.kind === "range" ? period.endDate : asOfDate;
  if ((requestedEnd && requestedEnd > today) || (asOfDate && asOfDate > today)) {
    return Response.json(
      { code: "FUTURE_DATE", message: "研究截止日期不能晚于今天（北京时间）。" },
      { status: 400 },
    );
  }
  if (period.kind === "range" && asOfDate && period.endDate > asOfDate) {
    return Response.json(
      { code: "SCOPE_CONFLICT", message: "日期区间结束日不能晚于研究截止日。" },
      { status: 400 },
    );
  }
  if (config.mode === "live" && !source.FUYAO_API_KEY) {
    return Response.json(
      {
        code: config.dataProviderConfigured ? "LIVE_ADAPTER_UNVERIFIED" : "CONFIG_MISSING",
        message: "当前 live 模式尚未配置扶摇 API Key；iFinD 适配器也尚未实现。没有使用演示数据替代。",
        retryable: false,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const requestId = crypto.randomUUID();
  const input = parsed.data;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let seq = 0;
      const emit = (type: string, data: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type, requestId, seq: seq++, data })}\n`));
      };
      const close = () => {
        try { controller.close(); } catch { /* The client may have cancelled the stream. */ }
      };
      const pause = () => new Promise((resolve) => setTimeout(resolve, 100));

      void (async () => {
        if (config.mode === "demo") {
          const snapshot = createDemoSnapshot(input);
          emit("scope_resolved", {
            scope: snapshot.scope,
            mode: "demo",
            note: "日期按工作日合成；未使用交易日历。",
          });
          await pause();
          emit("plan", {
            origin: "demo_fixture",
            intent: input.scope.focus,
            calls: [{ callId: "demo-1", toolName: "synthetic_demo", purpose: "展示查询轨迹和演示计算", status: "local_fixture" }],
            requiredDimensions: ["price", "breadth", "style"],
            optionalDimensions: ["liquidity", "valuation", "sentiment", "events"],
          });
          emit("tool_started", { callId: "demo-1", toolName: "synthetic_demo", purpose: "使用明确标注的本地合成夹具" });
          await pause();
          emit("tool_finished", { callId: "demo-1", status: "available", mode: "demo" });
          emit("snapshot", snapshot);
          emit("warning", {
            code: "MODEL_NOT_CONFIGURED",
            message: "此页面展示合成数据和代码计算；运行时 AI 模型尚未连接，因此没有生成 AI 最终结论。",
            affectedDimensions: ["valuation", "sentiment", "events"],
          });
          emit("done", { outcome: "partial", mode: "demo", reportId: snapshot.reportId });
          return;
        }

        let dimensions: Array<"price" | "breadth" | "style" | "sentiment" | "events"> = ["price", "breadth", "style", "sentiment", "events"];
        let aiPlanSucceeded = false;
        let analysisAngle: string = input.scope.focus;
        if (config.modelConfigured) {
          emit("tool_started", { callId: "model-plan", toolName: "runtime_model", purpose: "根据问题选择本轮研究维度" });
          try {
            const plan = await createAiPlan(input, source, { signal: request.signal });
            dimensions = plan.dimensions;
            analysisAngle = plan.analysisAngle;
            aiPlanSucceeded = true;
            emit("tool_finished", { callId: "model-plan", status: "available", mode: "live", modelName: plan.modelName });
          } catch (error) {
            const modelError = error instanceof ModelProviderError ? error : null;
            emit("tool_finished", { callId: "model-plan", status: "failed", mode: "live" });
            emit("warning", {
              code: modelError?.code ?? "PLAN_FAILED",
              message: (modelError?.message ?? "模型计划未通过校验。") + " 本轮继续使用代码默认的行情、宽度、风格、情绪和事件候选计划。",
              affectedDimensions: [],
            });
          }
        }
        const comparisons = dimensions.includes("style")
          ? input.scope.comparisonIndexes.filter((id) => id !== input.scope.primaryIndex)
          : [];
        const calls = [
          ...(config.modelConfigured ? [{ callId: "model-plan", toolName: "runtime_model", purpose: "选择研究维度", status: aiPlanSucceeded ? "available" : "failed" }] : []),
          { callId: "calendar", toolName: "get_a_share_calendar_trading_days", purpose: "确定最近已完成的 A 股交易日", status: "planned" },
          { callId: "index-primary", toolName: "get_a_share_index_prices_historical", purpose: "读取主观察指数历史日线", status: "planned" },
          ...comparisons.map((_, index) => ({ callId: "index-comparison-" + (index + 1), toolName: "get_a_share_index_prices_historical", purpose: "读取同期对比指数日线", status: "planned" })),
          ...(dimensions.includes("breadth") ? [{ callId: "market-snapshot-1", toolName: "get_a_share_prices_snapshot", purpose: "读取最近已完成交易日对应的全市场快照（收盘确认后）计算市场宽度", status: "planned" }] : []),
          ...(dimensions.includes("sentiment") ? [{ callId: "sentiment-statistics", toolName: "get_a_share_special_data_limit_up_statistics", purpose: "读取与研究收盘日对齐的涨停封板率、打开家数与连板高度", status: "planned" }] : []),
          ...(dimensions.includes("events") ? [{ callId: "news-flash", toolName: "get_a_share_news_flash_list", purpose: "读取近 72 小时 A 股快讯候选（不等同于已核实重大事件）", status: "planned" }] : []),
          ...(config.modelConfigured ? [{ callId: "model-report", toolName: "runtime_model", purpose: "生成有证据引用的归纳与反证", status: "planned" }] : []),
        ];
        emit("plan", {
          origin: config.modelConfigured ? aiPlanSucceeded ? "model" : "rule_fallback" : "code_default",
          intent: analysisAngle,
          calls,
          requiredDimensions: dimensions,
          optionalDimensions: [],
        });
        try {
          const snapshot = await createFuyaoSnapshot(input, source, emit, { signal: request.signal, dimensions });
          emit("scope_resolved", { scope: snapshot.scope, mode: "live", source: snapshot.sourceLabel });
          emit("snapshot", snapshot);
          if (config.modelConfigured) {
            try {
              emit("tool_started", { callId: "model-report", toolName: "runtime_model", purpose: "依据本轮证据生成结构化归纳" });
              const report = await createAiReport(input, snapshot, source, { signal: request.signal });
              emit("tool_finished", { callId: "model-report", status: "available", mode: "live", modelName: report.modelName });
              emit("report", report);
              emit("done", { outcome: aiPlanSucceeded ? "complete" : "partial", mode: "live", reportId: snapshot.reportId });
            } catch (error) {
              const modelError = error instanceof ModelProviderError ? error : null;
              emit("tool_finished", { callId: "model-report", status: "failed", mode: "live" });
              emit("warning", {
                code: modelError?.code ?? "MODEL_FAILED",
                message: modelError?.message ?? "AI 最终结论未生成；本轮真实数据、规则标签与证据仍可查看。",
                affectedDimensions: [],
              });
              emit("done", { outcome: "partial", mode: "live", reportId: snapshot.reportId });
            }
          } else {
            emit("warning", {
              code: "MODEL_NOT_CONFIGURED",
              message: "本轮已读取并计算扶摇数据；尚未配置运行时模型，因此没有生成 AI 最终结论、观察或反证。",
              affectedDimensions: ["valuation", "sentiment", "events"],
            });
            emit("done", { outcome: "partial", mode: "live", reportId: snapshot.reportId });
          }
        } catch (error) {
          const providerError = error instanceof FuyaoProviderError ? error : null;
          emit("error", {
            code: providerError?.code ?? "RESEARCH_FAILED",
            message: providerError?.message ?? "本轮研究未完成；没有使用演示数据替代。",
            retryable: providerError?.retryable ?? false,
          });
          emit("done", { outcome: "failed", mode: "live" });
        }
      })().catch(() => {
        try {
          emit("error", { code: "RESEARCH_STREAM_FAILED", message: "研究流未能完成；请重试。", retryable: true });
          emit("done", { outcome: "failed", mode: config.mode });
        } catch { /* The client may have cancelled the stream. */ }
      }).finally(close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
