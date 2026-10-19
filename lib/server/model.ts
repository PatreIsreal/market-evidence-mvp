import { z } from "zod";
import type { AiReport, AiResearchPlan, Dimension, ResearchInput, ResearchSnapshot } from "../contracts/research";

const planSchema = z.object({
  analysisAngle: z.string().trim().min(8).max(240),
  dimensions: z.array(z.enum(["price", "breadth", "style"])).min(1).max(3),
});

const statementSchema = z.object({
  statement: z.string().trim().min(8).max(320),
  evidenceIds: z.array(z.string()).min(1).max(5),
});

const draftSchema = z.object({
  summary: z.string().trim().min(12).max(500),
  summaryEvidenceIds: z.array(z.string()).min(1).max(10),
  observations: z.array(statementSchema).min(1).max(5),
  counterpoints: z.array(statementSchema).max(4),
  uncertainties: z.array(z.object({
    statement: z.string().trim().min(8).max(320),
    dimension: z.enum(["price", "breadth", "style", "valuation", "liquidity", "sentiment", "events"]),
  })).max(7),
  reevaluationConditionIds: z.array(z.string()).max(10),
});

type ModelSource = Record<string, string | undefined>;
type Fetcher = typeof fetch;

function modelModeOptions(source: ModelSource) {
  return source.MODEL_THINKING_MODE?.trim() === "disabled"
    ? { thinking: { type: "disabled" as const } }
    : {};
}

async function requestModelJson(
  systemPrompt: string,
  userPrompt: string,
  source: ModelSource,
  options: { fetcher?: Fetcher; signal?: AbortSignal; maxTokens: number },
): Promise<{ data: unknown; modelName: string }> {
  const baseUrl = source.MODEL_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = source.MODEL_API_KEY;
  const modelName = source.MODEL_NAME?.trim();
  if (!baseUrl || !apiKey || !modelName) throw new ModelProviderError("尚未配置服务端模型地址、API Key 与模型名称。", "CONFIG_MISSING");

  let endpoint: URL;
  try {
    endpoint = new URL(baseUrl + "/chat/completions");
  } catch {
    throw new ModelProviderError("模型 API 地址不是有效 URL。", "CONFIG_INVALID");
  }
  if (endpoint.protocol !== "https:") throw new ModelProviderError("模型 API 地址必须使用 HTTPS。", "CONFIG_INVALID");

  const fetcher = options.fetcher ?? fetch;
  const timeout = AbortSignal.timeout(25_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.15,
        max_tokens: options.maxTokens,
        response_format: { type: "json_object" },
        ...modelModeOptions(source),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal,
    });
  } catch {
    throw new ModelProviderError("模型请求失败或超时；已保留本轮数据与规则结果。", "MODEL_NETWORK_ERROR");
  }
  if (!response.ok) throw new ModelProviderError("模型服务返回 HTTP " + response.status + "；已保留本轮数据与规则结果。", "MODEL_UPSTREAM_ERROR");

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new ModelProviderError("模型服务返回了无法解析的 JSON。", "MODEL_INVALID_RESPONSE");
  }
  const content = (envelope as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new ModelProviderError("模型响应缺少结构化文本。", "MODEL_INVALID_RESPONSE");
  try {
    return { data: JSON.parse(content) as unknown, modelName };
  } catch {
    throw new ModelProviderError("模型输出不是有效 JSON；已保留本轮数据与规则结果。", "MODEL_INVALID_RESPONSE");
  }
}

export class ModelProviderError extends Error {
  constructor(message: string, readonly code = "MODEL_FAILED") {
    super(message);
    this.name = "ModelProviderError";
  }
}

export async function createAiPlan(
  input: ResearchInput,
  source: ModelSource,
  options: { fetcher?: Fetcher; signal?: AbortSignal } = {},
): Promise<AiResearchPlan> {
  const response = await requestModelJson(
    "你负责为 A 股市场状态研究选择数据维度。只允许选择 price（指数行情）、breadth（最近完成交易日的全市场上涨参与度）和 style（沪深 300 与中证 1000 对比）。不能生成交易建议、预测或任意工具名、代码、URL、参数。无论用户问题如何，price 都是必需维度。只返回 JSON：analysisAngle、dimensions。",
    JSON.stringify({
      question: input.question,
      requestedFocus: input.scope.focus,
      availableDimensions: [
        { id: "price", description: "主指数的历史日线、收益、均线、回撤、波动与成交额" },
        { id: "breadth", description: "仅最近已完成交易日可用的全市场涨跌家数快照；历史区间不回填" },
        { id: "style", description: "主指数之外的沪深 300 与中证 1000 同期指数表现" },
      ],
      sourceLimits: "估值、情绪、新闻事件和历史宽度序列尚未接入。",
    }),
    source,
    { ...options, maxTokens: 500 },
  );
  const parsed = planSchema.safeParse(response.data);
  if (!parsed.success) throw new ModelProviderError("模型研究计划未通过结构校验；将使用代码默认计划。", "PLAN_VALIDATION_FAILED");
  return {
    ...parsed.data,
    dimensions: Array.from(new Set(["price" as const, ...parsed.data.dimensions])),
    modelName: response.modelName,
  };
}

const restrictedAdvice = /(保证收益|稳赚|必涨|必跌|明天(?:一定|必然)?(?:涨|跌)|上涨概率|下跌概率|满仓|加仓|减仓|买入|卖出|买哪只|卖哪只|仓位建议|投资建议|buy\s+now|sell\s+now|guaranteed\s+(?:return|profit))/i;

function buildPrompt(input: ResearchInput, snapshot: ResearchSnapshot) {
  const evidence = snapshot.evidence.map((item) => ({
    id: item.id,
    dimension: item.dimension,
    label: item.label,
    value: item.value,
    unit: item.unit,
    period: item.period,
    dataAsOf: item.dataAsOf,
    scope: item.scopeDescription,
    issues: item.issues,
    formula: item.derivation?.parameters.note ?? null,
  }));
  const statuses = Object.fromEntries(Object.entries(snapshot.dimensionStatuses).map(([key, value]) => [key, value]));
  const conditions = snapshot.switchConditions.map(({ metricId, label, operator, threshold, unit, currentValue, evaluation, reevaluateMeaning }) => ({ metricId, label, operator, threshold, unit, currentValue, evaluation, reevaluateMeaning }));
  return JSON.stringify({
    userQuestion: input.question,
    focus: input.scope.focus,
    index: snapshot.indexName,
    actualPeriod: [snapshot.scope.actualStartDate, snapshot.scope.actualEndDate],
    source: snapshot.sourceLabel,
    evidence,
    dimensionStatuses: statuses,
    ruleTags: snapshot.stateTags.map(({ id, label }) => ({ id, label })),
    reevaluationConditions: conditions,
  });
}

function checkCitations(draft: z.infer<typeof draftSchema>, snapshot: ResearchSnapshot) {
  const evidenceIds = new Set(snapshot.evidence.map((item) => item.id));
  const conditionIds = new Set(snapshot.switchConditions.map((item) => item.metricId));
  const allStatements = [draft.summary, ...draft.observations.map((item) => item.statement), ...draft.counterpoints.map((item) => item.statement), ...draft.uncertainties.map((item) => item.statement)];
  if (allStatements.some((statement) => restrictedAdvice.test(statement))) {
    throw new ModelProviderError("模型输出越过研究边界，已隐藏本轮 AI 研判。", "REPORT_VALIDATION_FAILED");
  }
  for (const item of [{ evidenceIds: draft.summaryEvidenceIds }, ...draft.observations, ...draft.counterpoints]) {
    if (item.evidenceIds.some((id) => !evidenceIds.has(id))) {
      throw new ModelProviderError("模型引用了本轮不存在的证据，已隐藏本轮 AI 研判。", "REPORT_VALIDATION_FAILED");
    }
  }
  if (draft.reevaluationConditionIds.some((id) => !conditionIds.has(id))) {
    throw new ModelProviderError("模型引用了本轮不存在的复核条件，已隐藏本轮 AI 研判。", "REPORT_VALIDATION_FAILED");
  }

  const evidenceById = new Map(snapshot.evidence.map((item) => [item.id, item]));
  const claims = [
    { statement: draft.summary, ids: draft.summaryEvidenceIds },
    ...draft.observations.map((item) => ({ statement: item.statement, ids: item.evidenceIds })),
    ...draft.counterpoints.map((item) => ({ statement: item.statement, ids: item.evidenceIds })),
  ];
  for (const claim of claims) {
    const supportingText = claim.ids.flatMap((id) => {
      const item = evidenceById.get(id);
      return item ? [
        String(item.value ?? ""), item.label, item.unit,
        item.period.start, item.period.end, item.dataAsOf ?? "",
        item.scopeDescription,
        ...Object.values(item.derivation?.parameters ?? {}).map(String),
      ] : [];
    }).join(" ");
    const ruleNumbers = snapshot.switchConditions.flatMap((condition) => numericTokens(`${condition.threshold} ${condition.currentValue ?? ""}`));
    const supportedNumbers = [...numericTokens(supportingText), ...ruleNumbers].flatMap((value) => {
      const variants = [value, Number(value.toFixed(1)), Number(value.toFixed(2)), Math.round(value)];
      return [...variants, ...variants.map(Math.abs)];
    });
    const unsupportedNumber = numericTokens(claim.statement).find((value) =>
      !supportedNumbers.some((supported) => Math.abs(value - supported) < 1e-8),
    );
    if (unsupportedNumber !== undefined) {
      throw new ModelProviderError("模型输出包含引用证据或代码条件无法支持的数值，已隐藏本轮 AI 研判。", "REPORT_VALIDATION_FAILED");
    }
  }
}

function numericTokens(text: string): number[] {
  // A hyphen inside ISO dates separates fields; it must not turn month/day into negatives.
  return Array.from(text.matchAll(/(?<!\d)-?\d+(?:,\d{3})*(?:\.\d+)?/g), ([token]) => Number(token.replaceAll(",", "")))
    .filter(Number.isFinite);
}

export async function createAiReport(
  input: ResearchInput,
  snapshot: ResearchSnapshot,
  source: ModelSource,
  options: { fetcher?: Fetcher; signal?: AbortSignal } = {},
): Promise<AiReport> {
  if (snapshot.mode !== "live" || snapshot.synthetic) {
    throw new ModelProviderError("合成演示数据不能进入 AI 市场研判。", "SYNTHETIC_DATA_NOT_SUPPORTED");
  }
  const baseUrl = source.MODEL_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = source.MODEL_API_KEY;
  const modelName = source.MODEL_NAME?.trim();
  if (!baseUrl || !apiKey || !modelName) throw new ModelProviderError("尚未配置服务端模型地址、API Key 与模型名称。", "CONFIG_MISSING");

  let endpoint: URL;
  try {
    endpoint = new URL(`${baseUrl}/chat/completions`);
  } catch {
    throw new ModelProviderError("模型 API 地址不是有效 URL。", "CONFIG_INVALID");
  }
  if (endpoint.protocol !== "https:") throw new ModelProviderError("模型 API 地址必须使用 HTTPS。", "CONFIG_INVALID");

  const fetcher = options.fetcher ?? fetch;
  const timeout = AbortSignal.timeout(25_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.15,
        max_tokens: 1800,
        response_format: { type: "json_object" },
        ...modelModeOptions(source),
        messages: [
          {
            role: "system",
            content: "你是面向 A 股市场状态研究的证据归纳助手。只描述已给出的事实，不预测未来涨跌、不估计涨跌概率、不提出买卖、仓位或收益建议。只能使用给定的证据 ID；summary 必须带 1 到 10 个 summaryEvidenceIds，且每条 observation 和 counterpoint 必须带 1 到 5 个本轮证据 ID。区分事实、解释和不确定性。若数据是合成演示，拒绝将其解释为真实市场事实。只返回符合要求的 JSON 对象，字段为 summary、summaryEvidenceIds、observations[{statement,evidenceIds}]、counterpoints[{statement,evidenceIds}]、uncertainties[{statement,dimension}]、reevaluationConditionIds。每个 uncertainties.dimension 必须逐字使用以下一个值：price、breadth、style、valuation、liquidity、sentiment、events；不要翻译或自造维度值。所有陈述使用简体中文。",
          },
          {
            role: "user",
            content: `请根据以下本轮服务端证据，回答用户问题。没有证据支持的维度应放入 uncertainties；反证只从现有证据中寻找，不要编造。\n${buildPrompt(input, snapshot)}`,
          },
        ],
      }),
      signal,
    });
  } catch {
    throw new ModelProviderError("模型请求失败或超时；已保留本轮数据与规则结果。", "MODEL_NETWORK_ERROR");
  }
  if (!response.ok) throw new ModelProviderError(`模型服务返回 HTTP ${response.status}；已保留本轮数据与规则结果。`, "MODEL_UPSTREAM_ERROR");

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new ModelProviderError("模型服务返回了无法解析的 JSON。", "MODEL_INVALID_RESPONSE");
  }
  const content = (envelope as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new ModelProviderError("模型响应缺少结构化文本。", "MODEL_INVALID_RESPONSE");

  let rawDraft: unknown;
  try {
    rawDraft = JSON.parse(content);
  } catch {
    throw new ModelProviderError("模型输出不是有效 JSON；已保留本轮数据与规则结果。", "MODEL_INVALID_RESPONSE");
  }
  const parsed = draftSchema.safeParse(rawDraft);
  if (!parsed.success) throw new ModelProviderError("模型输出未通过报告结构校验；已保留本轮数据与规则结果。", "REPORT_VALIDATION_FAILED");
  checkCitations(parsed.data, snapshot);

  const coreDimensions: Dimension[] = ["price", "breadth", "style"];
  const evidenceCoverage = Math.round(coreDimensions.filter((dimension) => snapshot.dimensionStatuses[dimension].status === "available").length / coreDimensions.length * 100);
  return { ...parsed.data, evidenceCoverage, modelName };
}
