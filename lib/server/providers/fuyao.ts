import { z } from "zod";
import type { Dimension, Evidence, PricePoint, ResearchInput, ResearchSnapshot } from "../../contracts/research";
import {
  amountRatio,
  annualizedVolatility,
  breadthRatio,
  intervalReturn,
  maximumDrawdown,
  simpleMovingAverage,
} from "../metrics";

const indexCodes: Record<ResearchInput["scope"]["primaryIndex"], string> = {
  SSE_COMPOSITE: "000001.SH",
  SZSE_COMPONENT: "399001.SZ",
  CHINEXT: "399006.SZ",
  CSI300: "000300.SH",
  CSI1000: "000852.SH",
};

const indexNames: Record<ResearchInput["scope"]["primaryIndex"], string> = {
  SSE_COMPOSITE: "上证指数",
  SZSE_COMPONENT: "深证成指",
  CHINEXT: "创业板指",
  CSI300: "沪深 300",
  CSI1000: "中证 1000",
};

const envelopeSchema = z.object({
  code: z.number(),
  message: z.string().optional().default(""),
  request_id: z.string().optional(),
  data: z.unknown(),
});

const calendarSchema = z.object({
  timestamp: z.number().nullable().optional(),
  item: z.array(z.object({ date_ms: z.number(), date: z.string() })),
});

const historicalSchema = z.object({
  timestamp: z.number().nullable().optional(),
  item: z.array(z.object({
    date_ms: z.number(),
    open_price: z.number().nullable().optional(),
    high_price: z.number().nullable().optional(),
    low_price: z.number().nullable().optional(),
    close_price: z.number().nullable().optional(),
    turnover: z.number().nullable().optional(),
  })),
});

const snapshotSchema = z.object({
  timestamp: z.number().nullable().optional(),
  total: z.number().int().nonnegative(),
  item: z.array(z.object({
    thscode: z.string(),
    last_price: z.number().nullable().optional(),
    prev_price: z.number().nullable().optional(),
  })),
});

type EventEmitter = (type: string, data: unknown) => void;
type Fetcher = typeof fetch;
type ApiResult<T> = { data: T; requestId: string | null; path: string };

export class FuyaoProviderError extends Error {
  constructor(message: string, readonly code = "FUYAO_REQUEST_FAILED", readonly retryable = false) {
    super(message);
    this.name = "FuyaoProviderError";
  }
}

const maxFuyaoAttempts = 3;
const fuyaoAttemptTimeoutMs = 12_000;

function isRetryableHttpStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function waitBeforeRetry(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("请求已取消。"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("请求已取消。"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function formatShanghaiDate(value: number | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function formatShanghaiDateTime(value: number | Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(value instanceof Date ? value : new Date(value));
}

function minutesAfterMidnight(value: number | Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(fields.hour) * 60 + Number(fields.minute);
}

function isAshareSessionOrCloseFinalization(tradeDates: string[], now: Date) {
  const today = formatShanghaiDate(now);
  const minute = minutesAfterMidnight(now);
  return tradeDates.includes(today) && minute >= 9 * 60 + 15 && minute < 16 * 60;
}

function dateFromCompact(value: string) {
  if (!/^\d{8}$/.test(value)) throw new FuyaoProviderError("扶摇交易日历返回了无法识别的日期。", "INVALID_PROVIDER_RESPONSE");
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function shanghaiDayStart(date: string) {
  return Date.parse(`${date}T00:00:00+08:00`);
}

function shanghaiDayEnd(date: string) {
  return shanghaiDayStart(date) + 86_399_999;
}

function shiftCalendarDays(date: string, offset: number) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + offset);
  return result.toISOString().slice(0, 10);
}

function latestCompletedTradeDate(dates: string[], now: Date) {
  const today = formatShanghaiDate(now);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const time = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const afterClose = Number(time.hour) >= 16;
  const eligible = dates.filter((date) => date < today || (date === today && afterClose));
  return eligible.at(-1) ?? null;
}

async function callFuyao<T>(args: {
  baseUrl: string;
  apiKey: string;
  path: string;
  params?: Record<string, string | number>;
  callId: string;
  purpose: string;
  schema: z.ZodType<T>;
  emit: EventEmitter;
  fetcher: Fetcher;
  signal?: AbortSignal;
}): Promise<ApiResult<T>> {
  const { baseUrl, apiKey, path, callId, purpose, schema, emit, fetcher, signal } = args;
  const url = new URL(path, `${baseUrl.replace(/\/+$/, "")}/`);
  for (const [key, value] of Object.entries(args.params ?? {})) url.searchParams.set(key, String(value));
  emit("tool_started", { callId, toolName: "fuyao_rest_api", purpose });

  const startedAt = Date.now();
  for (let attempt = 1; attempt <= maxFuyaoAttempts; attempt += 1) {
    if (signal?.aborted) {
      emit("tool_finished", { callId, status: "failed", mode: "live", attempts: attempt - 1, elapsedMs: Date.now() - startedAt });
      throw signal.reason ?? new Error("请求已取消。");
    }

    const attemptStartedAt = Date.now();
    const timeoutSignal = AbortSignal.timeout(fuyaoAttemptTimeoutMs);
    const attemptSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      const response = await fetcher(url, {
        headers: { "X-api-key": apiKey, Accept: "application/json" },
        signal: attemptSignal,
      });
      const elapsedMs = Date.now() - attemptStartedAt;
      const rayId = response.headers.get("cf-ray");
      const upstreamRequestId = response.headers.get("x-request-id");
      if (!response.ok) {
        try { await response.body?.cancel(); } catch { /* The upstream may already have closed its response. */ }
        if (isRetryableHttpStatus(response.status) && attempt < maxFuyaoAttempts) {
          const delayMs = 300 * 2 ** (attempt - 1);
          emit("tool_retrying", { callId, attempt, nextAttempt: attempt + 1, maxAttempts: maxFuyaoAttempts, delayMs, httpStatus: response.status, rayId, upstreamRequestId, elapsedMs });
          await waitBeforeRetry(delayMs, signal);
          continue;
        }
        const diagnostic = [
          `HTTP ${response.status}`,
          `尝试 ${attempt}/${maxFuyaoAttempts}`,
          rayId ? `Cloudflare Ray ID ${rayId}` : null,
          upstreamRequestId ? `上游请求 ID ${upstreamRequestId}` : null,
        ].filter(Boolean).join("，");
        throw new FuyaoProviderError(
          `扶摇数据接口返回 ${diagnostic}。${isRetryableHttpStatus(response.status) ? "请稍后重试；" : ""}未使用演示数据替代。`,
          isRetryableHttpStatus(response.status) ? "FUYAO_UPSTREAM_HTTP_ERROR" : "FUYAO_REQUEST_FAILED",
          isRetryableHttpStatus(response.status),
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new FuyaoProviderError("扶摇接口返回的内容不是有效 JSON。", "INVALID_PROVIDER_RESPONSE");
      }
      const envelope = envelopeSchema.safeParse(body);
      if (!envelope.success) throw new FuyaoProviderError("扶摇响应结构与已验证的接口契约不匹配。", "INVALID_PROVIDER_RESPONSE");
      if (envelope.data.code !== 0) {
        throw new FuyaoProviderError(`扶摇数据接口未成功：${envelope.data.message || `业务代码 ${envelope.data.code}`}。`, `FUYAO_${envelope.data.code}`);
      }
      const parsed = schema.safeParse(envelope.data.data);
      if (!parsed.success) throw new FuyaoProviderError("扶摇数据字段未通过本地结构校验。", "INVALID_PROVIDER_RESPONSE");
      emit("tool_finished", {
        callId,
        status: "available",
        mode: "live",
        attempts: attempt,
        elapsedMs: Date.now() - startedAt,
        requestId: envelope.data.request_id ?? upstreamRequestId,
        rayId,
      });
      return { data: parsed.data, requestId: envelope.data.request_id ?? null, path: `${url.origin}${url.pathname}` };
    } catch (error) {
      if (signal?.aborted) {
        emit("tool_finished", { callId, status: "failed", mode: "live", attempts: attempt, elapsedMs: Date.now() - startedAt });
        throw signal.reason ?? error;
      }
      if (error instanceof FuyaoProviderError) {
        if (error.retryable && attempt < maxFuyaoAttempts) {
          const delayMs = 300 * 2 ** (attempt - 1);
          emit("tool_retrying", { callId, attempt, nextAttempt: attempt + 1, maxAttempts: maxFuyaoAttempts, delayMs, elapsedMs: Date.now() - attemptStartedAt, errorCode: error.code });
          await waitBeforeRetry(delayMs, signal);
          continue;
        }
        emit("tool_finished", { callId, status: "failed", mode: "live", attempts: attempt, elapsedMs: Date.now() - startedAt, errorCode: error.code });
        throw error;
      }
      if (attempt < maxFuyaoAttempts) {
        const delayMs = 300 * 2 ** (attempt - 1);
        emit("tool_retrying", { callId, attempt, nextAttempt: attempt + 1, maxAttempts: maxFuyaoAttempts, delayMs, elapsedMs: Date.now() - attemptStartedAt, errorCode: "FUYAO_NETWORK_ERROR" });
        await waitBeforeRetry(delayMs, signal);
        continue;
      }
      emit("tool_finished", { callId, status: "failed", mode: "live", attempts: attempt, elapsedMs: Date.now() - startedAt, errorCode: "FUYAO_NETWORK_ERROR" });
      throw new FuyaoProviderError(
        `扶摇数据请求在 ${maxFuyaoAttempts} 次尝试后仍失败或超时（单次上限 ${fuyaoAttemptTimeoutMs / 1000} 秒）。未使用演示数据替代。`,
        "FUYAO_NETWORK_ERROR",
        true,
      );
    }
  }

  throw new FuyaoProviderError("扶摇数据请求失败；未使用演示数据替代。", "FUYAO_NETWORK_ERROR", true);
}

function barsFromResult(result: ApiResult<z.infer<typeof historicalSchema>>): PricePoint[] {
  return result.data.item.flatMap((item) => {
    const values = [item.open_price, item.high_price, item.low_price, item.close_price];
    if (!values.every((value): value is number => typeof value === "number" && Number.isFinite(value)) || item.close_price! <= 0) return [];
    return [{
      tradeDate: formatShanghaiDate(item.date_ms),
      open: item.open_price!,
      high: item.high_price!,
      low: item.low_price!,
      close: item.close_price!,
      amountCny: typeof item.turnover === "number" && Number.isFinite(item.turnover) ? item.turnover : null,
    }];
  }).sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
}

function addEvidence(
  evidence: Evidence[],
  dimension: Dimension,
  label: string,
  value: number,
  unit: string,
  dates: string[],
  formulaId: string,
  formula: string,
  fields: string[],
  datasetId: string,
  description: string,
  sourceUrl: string,
) {
  const id = `E${String(evidence.length + 1).padStart(3, "0")}`;
  evidence.push({
    id,
    dimension,
    label,
    kind: "derived_metric",
    value,
    unit,
    period: { start: dates[0] ?? "", end: dates.at(-1) ?? "" },
    dataAsOf: dates.at(-1) ?? null,
    status: "available",
    scopeDescription: description,
    sourceRefs: [{ datasetId, recordKeys: dates, fields, sourceUrl }],
    derivation: { formulaId, formulaVersion: "mvp-v1", inputEvidenceIds: [], parameters: { note: formula } },
    issues: [],
  });
  return id;
}

function currentBreadthFromSnapshot(items: Array<z.infer<typeof snapshotSchema>["item"][number]>) {
  let upCount = 0;
  let downCount = 0;
  let flatCount = 0;
  let excludedCount = 0;
  for (const item of items) {
    if (typeof item.last_price !== "number" || !Number.isFinite(item.last_price) || typeof item.prev_price !== "number" || !Number.isFinite(item.prev_price)) {
      excludedCount += 1;
    } else if (item.last_price > item.prev_price) upCount += 1;
    else if (item.last_price < item.prev_price) downCount += 1;
    else flatCount += 1;
  }
  return { upCount, downCount, flatCount, excludedCount };
}

export async function createFuyaoSnapshot(
  input: ResearchInput,
  source: Record<string, string | undefined>,
  emit: EventEmitter,
  options: { fetcher?: Fetcher; now?: Date; signal?: AbortSignal; dimensions?: Array<"price" | "breadth" | "style"> } = {},
): Promise<ResearchSnapshot> {
  const apiKey = source.FUYAO_API_KEY;
  if (!apiKey) throw new FuyaoProviderError("尚未配置扶摇 API Key。", "CONFIG_MISSING");
  const baseUrl = source.FUYAO_BASE_URL || "https://fuyao.aicubes.cn";
  let parsedBase: URL;
  try {
    parsedBase = new URL(baseUrl);
  } catch {
    throw new FuyaoProviderError("扶摇 API 地址不是有效 URL。", "CONFIG_INVALID");
  }
  if (parsedBase.protocol !== "https:") throw new FuyaoProviderError("扶摇 API 地址必须使用 HTTPS。", "CONFIG_INVALID");
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const requestedDimensions = options.dimensions ?? ["price", "breadth", "style"];
  const calendarResult = await callFuyao({
    baseUrl,
    apiKey,
    path: "/api/a-share/calendar/trading-days",
    callId: "calendar",
    purpose: "确定最近已完成的 A 股交易日",
    schema: calendarSchema,
    emit,
    fetcher,
    signal: options.signal,
  });
  const tradeDates = calendarResult.data.item.map((item) => dateFromCompact(item.date)).sort();
  const latestCompleted = latestCompletedTradeDate(tradeDates, now);
  if (!latestCompleted && !input.scope.asOfDate && input.scope.period.kind === "lookback") {
    throw new FuyaoProviderError("扶摇最近一年交易日历没有返回可用的已完成交易日。", "NO_COMPLETED_TRADE_DATE");
  }

  const period = input.scope.period;
  const endDate = period.kind === "range" ? period.endDate : input.scope.asOfDate ?? latestCompleted!;
  let startDate: string;
  if (period.kind === "range") {
    startDate = period.startDate;
  } else if (input.scope.asOfDate) {
    startDate = shiftCalendarDays(endDate, -Math.ceil((period.tradingDays + 15) * 1.8));
  } else {
    const endIndex = tradeDates.lastIndexOf(endDate);
    const startIndex = endIndex >= period.tradingDays ? endIndex - period.tradingDays : -1;
    startDate = startIndex >= 0 ? tradeDates[startIndex] : shiftCalendarDays(endDate, -Math.ceil((period.tradingDays + 15) * 1.8));
  }

  const fiveYearsAgo = new Date(now);
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
  if (period.kind === "range" && Date.parse(`${startDate}T00:00:00+08:00`) < fiveYearsAgo.getTime()) {
    throw new FuyaoProviderError("扶摇指数历史 K 线当前只支持最近五年；请选择较新的日期区间。", "DATE_RANGE_UNSUPPORTED");
  }

  const comparisonIds = requestedDimensions.includes("style")
    ? input.scope.comparisonIndexes.filter((id) => id !== input.scope.primaryIndex).slice(0, 2)
    : [];
  const queryHistory = async (indexId: ResearchInput["scope"]["primaryIndex"], callId: string, primary: boolean) => {
    const result = await callFuyao({
      baseUrl,
      apiKey,
      path: "/api/a-share-index/prices/historical",
      params: {
        thscode: indexCodes[indexId],
        interval: "1d",
        start: shanghaiDayStart(startDate),
        end: shanghaiDayEnd(endDate),
      },
      callId,
      purpose: `${indexNames[indexId]}日线${primary ? "（主观察序列）" : "（同期对比）"}`,
      schema: historicalSchema,
      emit,
      fetcher,
      signal: options.signal,
    });
    let points = barsFromResult(result).filter((point) => point.tradeDate >= startDate && point.tradeDate <= endDate);
    if (period.kind === "lookback") points = points.slice(-(period.tradingDays + 1));
    return { points, result };
  };

  const primaryPromise = queryHistory(input.scope.primaryIndex, "index-primary", true);
  const comparisonPromises = comparisonIds.map((id, index) => queryHistory(id, `index-comparison-${index + 1}`, false).then(
    (result) => ({ id, ...result, error: null as string | null }),
    (error: unknown) => ({ id, points: [] as PricePoint[], result: null, error: error instanceof Error ? error.message : "对比指数查询失败。" }),
  ));
  const [primaryResult, comparisonResults] = await Promise.all([primaryPromise, Promise.all(comparisonPromises)]);
  const primaryPoints = primaryResult.points;
  const primaryDataAsOf = primaryResult.result.data.timestamp ? formatShanghaiDate(primaryResult.result.data.timestamp) : primaryPoints.at(-1)?.tradeDate ?? null;
  const actualStart = primaryPoints[0]?.tradeDate ?? startDate;
  const actualEnd = primaryPoints.at(-1)?.tradeDate ?? endDate;
  const primarySourceUrl = `${baseUrl.replace(/\/+$/, "")}/api/a-share-index/prices/historical`;

  const largePoints = input.scope.primaryIndex === "CSI300" ? primaryPoints : comparisonResults.find((result) => result.id === "CSI300")?.points ?? [];
  const smallPoints = input.scope.primaryIndex === "CSI1000" ? primaryPoints : comparisonResults.find((result) => result.id === "CSI1000")?.points ?? [];
  const styleDates = largePoints.map((point) => point.tradeDate).filter((date) => smallPoints.some((point) => point.tradeDate === date));
  const recentAlignedDates = styleDates.slice(-21);
  const largeAligned = largePoints.filter((point) => recentAlignedDates.includes(point.tradeDate));
  const smallAligned = smallPoints.filter((point) => recentAlignedDates.includes(point.tradeDate));

  const return20 = intervalReturn(primaryPoints.map((point) => point.close), 20);
  const return60 = intervalReturn(primaryPoints.map((point) => point.close), 60);
  const ma20 = simpleMovingAverage(primaryPoints.map((point) => point.close), 20);
  const drawdown = maximumDrawdown(primaryPoints.map((point) => point.close));
  const volatility20 = annualizedVolatility(primaryPoints.map((point) => point.close), 20);
  const volatility60 = annualizedVolatility(primaryPoints.map((point) => point.close), 60);
  const amountRatio20 = amountRatio(primaryPoints);
  const largeReturn20 = intervalReturn(largeAligned.map((point) => point.close), 20);
  const smallReturn20 = intervalReturn(smallAligned.map((point) => point.close), 20);
  const styleSpread20 = largeReturn20 !== null && smallReturn20 !== null ? smallReturn20 - largeReturn20 : null;

  const evidence: Evidence[] = [];
  const dateList = (points: PricePoint[]) => points.map((point) => point.tradeDate);
  const eReturn = return20 === null ? null : addEvidence(evidence, "price", "指数 20 日区间收益", return20 * 100, "%", dateList(primaryPoints.slice(-21)), "return20", "C_t / C_(t-20) - 1", ["close_price"], "fuyao.index.daily", `${indexNames[input.scope.primaryIndex]}指数日线；未复权指数点位`, primarySourceUrl);
  const eMa = ma20 === null ? null : addEvidence(evidence, "price", "指数 MA20", ma20, "点", dateList(primaryPoints.slice(-20)), "ma20", "最近 20 个有效收盘值的简单均值", ["close_price"], "fuyao.index.daily", `${indexNames[input.scope.primaryIndex]}指数日线`, primarySourceUrl);
  if (drawdown !== null) addEvidence(evidence, "price", "区间最大回撤", drawdown * 100, "%", dateList(primaryPoints), "maxDrawdown", "min(C_i / 历史最高收盘_i - 1)", ["close_price"], "fuyao.index.daily", `${indexNames[input.scope.primaryIndex]}指数日线收盘回撤`, primarySourceUrl);
  if (volatility20 !== null) addEvidence(evidence, "price", "年化波动率（20 日）", volatility20 * 100, "%", dateList(primaryPoints.slice(-21)), "volatility20", "20 日对数收益样本标准差 × sqrt(252)", ["close_price"], "fuyao.index.daily", `${indexNames[input.scope.primaryIndex]}指数日线`, primarySourceUrl);
  const eStyle = styleSpread20 === null ? null : addEvidence(evidence, "style", "大小盘代理 20 日收益差", styleSpread20 * 100, "百分点", recentAlignedDates, "styleSpread20", "小盘指数 20 日收益 - 大盘指数 20 日收益", ["close_price"], "fuyao.index.daily", "指数按同一交易日对齐；未复权指数点位", primarySourceUrl);
  if (amountRatio20 !== null) addEvidence(evidence, "liquidity", "指数成交额相对前 20 日均值", amountRatio20, "倍", dateList(primaryPoints.slice(-21)), "amountRatio20", "当日成交额 / 前 20 个有效日成交额均值", ["turnover"], "fuyao.index.daily", `${indexNames[input.scope.primaryIndex]}指数成交额，人民币元`, primarySourceUrl);

  let breadthSeries: ResearchSnapshot["breadthSeries"] = [];
  let breadthStatus: ResearchSnapshot["dimensionStatuses"][Dimension] = requestedDimensions.includes("breadth")
    ? { status: "unavailable", explanation: "所选日期并非最近已完成交易日；接口只提供最新全市场快照，无法回填历史宽度。", dataAsOf: null }
    : { status: "unavailable", explanation: "本轮 AI 研究计划未请求市场宽度；如需此维度，可在问题中询问市场参与度。", dataAsOf: null };
  let breadthLatest: number | null = null;
  let eBreadth: string | null = null;
  const isLatestCompletedDate = Boolean(latestCompleted && endDate === latestCompleted && actualEnd === latestCompleted);
  const finishBreadthTool = (status: string) => emit("tool_finished", { callId: "market-snapshot-1", status, mode: "live" });
  if (requestedDimensions.includes("breadth") && !isLatestCompletedDate) finishBreadthTool("unavailable");
  if (isLatestCompletedDate && requestedDimensions.includes("breadth")) {
    if (isAshareSessionOrCloseFinalization(tradeDates, now)) {
      breadthStatus = {
        status: "stale",
        explanation: "当前处于 A 股交易或收盘确认时段；最新全市场快照可能包含盘中价格，本轮不与最近完成交易日的收盘日线混合计算。收盘确认后可重试。",
        dataAsOf: null,
      };
      finishBreadthTool("stale");
    } else {
      try {
        const allItems: Array<z.infer<typeof snapshotSchema>["item"][number]> = [];
        const firstPage = await callFuyao({
          baseUrl,
          apiKey,
          path: "/api/a-share/prices/snapshot",
          params: { limit: 1000, offset: 0 },
          callId: "market-snapshot-1",
          purpose: "读取全市场最新个股价格，计算当日上涨／下跌／平盘家数",
          schema: snapshotSchema,
          emit,
          fetcher,
          signal: options.signal,
        });
        const snapshotReadyAt = firstPage.data.timestamp;
        const snapshotReadyDate = snapshotReadyAt ? formatShanghaiDate(snapshotReadyAt) : null;
        const readyAtTradeDateClose = typeof snapshotReadyAt === "number"
          && snapshotReadyDate === latestCompleted
          && minutesAfterMidnight(snapshotReadyAt) >= 16 * 60;
        const readyAtOrAfterTradeDate = Boolean(snapshotReadyAt && snapshotReadyDate && snapshotReadyDate >= latestCompleted!);
        const readyAtNotInFuture = Boolean(snapshotReadyAt && snapshotReadyAt <= now.getTime() + 5 * 60_000);
        if (!snapshotReadyAt || !readyAtOrAfterTradeDate || !readyAtNotInFuture || (snapshotReadyDate === latestCompleted && !readyAtTradeDateClose)) {
          const readyAt = snapshotReadyAt ? formatShanghaiDateTime(snapshotReadyAt) : "未知";
          breadthStatus = {
            status: "stale",
            explanation: `全市场快照数据就绪时间为 ${readyAt}；无法确认其包含 ${latestCompleted} 收盘数据，因此未用于计算。`,
            dataAsOf: null,
          };
          finishBreadthTool("stale");
        } else {
          const confirmedSnapshotDate = latestCompleted!;
          const readyAtLabel = formatShanghaiDateTime(snapshotReadyAt);
          allItems.push(...firstPage.data.item);
          let offset = firstPage.data.item.length;
          const maxRows = Math.min(6_000, firstPage.data.total);
          let pageNumber = 2;
          while (offset < maxRows && pageNumber <= 6) {
            const page = await callFuyao({
              baseUrl,
              apiKey,
              path: "/api/a-share/prices/snapshot",
              params: { limit: 1000, offset },
              callId: "market-snapshot-1",
              purpose: `读取全市场行情快照第 ${pageNumber} 页`,
              schema: snapshotSchema,
              emit,
              fetcher,
              signal: options.signal,
            });
            if (!page.data.timestamp
              || formatShanghaiDate(page.data.timestamp) < confirmedSnapshotDate
              || formatShanghaiDate(page.data.timestamp) > formatShanghaiDate(now)
              || page.data.timestamp > now.getTime() + 5 * 60_000) {
              throw new FuyaoProviderError("全市场快照分页期间数据时点发生变化；本轮宽度计算已中止。", "SNAPSHOT_TIME_CONFLICT");
            }
            if (page.data.item.length === 0) break;
            allItems.push(...page.data.item);
            offset += page.data.item.length;
            pageNumber += 1;
          }
          if (allItems.length < firstPage.data.total) {
            throw new FuyaoProviderError(`全市场快照仅返回 ${allItems.length}/${firstPage.data.total} 条记录；为避免偏样本宽度，本轮不计算上涨比例。`, "INCOMPLETE_MARKET_SNAPSHOT");
          }
          const counts = currentBreadthFromSnapshot(allItems);
          const breadthPoint = {
            tradeDate: confirmedSnapshotDate,
            ...counts,
            universeDefinition: `扶摇全市场股票快照中有效现价与前收盘价记录；快照数据就绪时间 ${readyAtLabel}，按交易日历归属到最近已完成交易日 ${confirmedSnapshotDate}；返回 ${allItems.length} 条，排除 ${counts.excludedCount} 条无有效价格记录。`,
          };
          breadthSeries = [{ ...breadthPoint }];
          breadthLatest = breadthRatio({ ...breadthPoint, flatCount: counts.flatCount });
          breadthStatus = allItems.length > 0
            ? { status: "available", explanation: breadthPoint.universeDefinition, dataAsOf: confirmedSnapshotDate }
            : { status: "missing", explanation: "全市场快照没有返回可用于计算的股票记录。", dataAsOf: confirmedSnapshotDate };
          finishBreadthTool(allItems.length > 0 ? "available" : "missing");
          if (breadthLatest !== null) {
            eBreadth = addEvidence(evidence, "breadth", "全市场当日上涨比例", breadthLatest * 100, "%", [confirmedSnapshotDate], "breadthLatest", "上涨家数 / (上涨 + 下跌 + 平盘家数)", ["last_price", "prev_price"], "fuyao.a_share.snapshot", breadthPoint.universeDefinition, `${baseUrl.replace(/\/+$/, "")}/api/a-share/prices/snapshot`);
          }
        }
      } catch (error) {
        breadthStatus = { status: "failed", explanation: error instanceof Error ? error.message : "全市场快照调用失败。", dataAsOf: null };
        finishBreadthTool("failed");
      }
    }
  }

  const stateTags: ResearchSnapshot["stateTags"] = [];
  if (return20 !== null && ma20 !== null && primaryPoints.at(-1)!.close > ma20 && return20 > 0) {
    stateTags.push({ id: "price-structure-positive", label: "所选区间：价格高于 MA20 且 20 日收益为正", evidenceIds: [eReturn, eMa].filter((id): id is string => Boolean(id)) });
  }
  if (breadthLatest !== null && breadthLatest >= 0.6) stateTags.push({ id: "breadth-broad", label: "最近交易日：上涨参与度较广", evidenceIds: eBreadth ? [eBreadth] : [] });
  if (breadthLatest !== null && breadthLatest <= 0.4) stateTags.push({ id: "breadth-limited", label: "最近交易日：上涨参与度有限", evidenceIds: eBreadth ? [eBreadth] : [] });
  if (styleSpread20 !== null && Math.abs(styleSpread20) >= 0.02) stateTags.push({ id: "style-different", label: "所选区间：大、小盘指数表现存在差异", evidenceIds: eStyle ? [eStyle] : [] });
  if (return20 !== null && breadthLatest !== null && ((return20 > 0 && breadthLatest <= 0.4) || (return20 < 0 && breadthLatest >= 0.6))) {
    stateTags.push({ id: "index-breadth-divergence", label: "所选区间价格与最近交易日参与度方向不一致", evidenceIds: [eReturn, eBreadth].filter((id): id is string => Boolean(id)) });
  }

  const priceStatus: ResearchSnapshot["dimensionStatuses"][Dimension] = primaryPoints.length
    ? { status: "available", explanation: "扶摇指数历史日线；指数点位无复权语义，成交额单位为人民币元。", dataAsOf: primaryDataAsOf }
    : { status: "missing", explanation: "扶摇在所选范围内没有返回有效指数日线。", dataAsOf: primaryDataAsOf };
  const comparisonFailures = comparisonResults.filter((result) => result.error).length;
  const styleStatus: ResearchSnapshot["dimensionStatuses"][Dimension] = !comparisonIds.length
    ? { status: "unavailable", explanation: "本轮研究计划未请求对比指数。", dataAsOf: null }
    : comparisonFailures
      ? { status: "failed", explanation: comparisonResults.map((result) => result.error).filter(Boolean).join("；"), dataAsOf: null }
      : largePoints.length > 0 && smallPoints.length > 0 && recentAlignedDates.length >= 21
        ? { status: "available", explanation: "对比指数按交易日对齐；区间表现为未复权指数点位变化。", dataAsOf: recentAlignedDates.at(-1) ?? null }
        : { status: "missing", explanation: "未同时取得沪深 300 与中证 1000，或共同交易日不足 21 个，无法计算大小盘 20 日风格差。", dataAsOf: recentAlignedDates.at(-1) ?? null };

  return {
    snapshotId: crypto.randomUUID(),
    reportId: crypto.randomUUID(),
    parentReportId: input.context?.parentReportId ?? null,
    mode: "live",
    generatedAt: now.toISOString(),
    synthetic: false,
    scope: {
      ...input.scope,
      asOfDate: input.scope.asOfDate ?? (period.kind === "lookback" ? endDate : null),
      actualStartDate: actualStart,
      actualEndDate: actualEnd,
      calendarNote: "主序列日期来自扶摇指数历史日线；研究截止日不晚于最近已完成交易日。",
    },
    indexName: indexNames[input.scope.primaryIndex],
    sourceLabel: "同花顺扶摇金融数据 API",
    priceSeries: primaryPoints,
    breadthSeries,
    comparisonSeries: comparisonResults.map((result) => ({
      indexId: result.id,
      indexName: indexNames[result.id],
      points: result.points,
    })),
    metrics: {
      return20,
      return60,
      ma20,
      maxDrawdown: drawdown,
      volatility20,
      volatility60,
      breadthLatest,
      breadth5Day: null,
      styleSpread20,
      amountRatio20,
    },
    stateTags,
    dimensionStatuses: {
      price: priceStatus,
      breadth: breadthStatus,
      style: styleStatus,
      valuation: { status: "unavailable", explanation: "扶摇估值接口当前提供个股最新估值；本版尚未建立指数估值映射。", dataAsOf: null },
      liquidity: primaryPoints.some((point) => point.amountCny !== null)
        ? { status: "available", explanation: "使用指数日线成交额字段，单位为人民币元。", dataAsOf: primaryDataAsOf }
        : { status: "missing", explanation: "指数历史日线没有有效成交额字段。", dataAsOf: primaryDataAsOf },
      sentiment: { status: "unavailable", explanation: "情绪接口尚未接入。", dataAsOf: null },
      events: { status: "unavailable", explanation: "政策、新闻与公告事件接口尚未接入。", dataAsOf: null },
    },
    evidence,
    switchConditions: [{
      metricId: "breadth.latest",
      label: "复核最近交易日上涨参与度",
      operator: ">",
      threshold: 50,
      unit: "%",
      observationWindow: "最近已完成交易日的全市场快照",
      currentValue: breadthLatest === null ? null : breadthLatest * 100,
      evaluation: breadthLatest === null ? "unavailable" : breadthLatest * 100 > 50 ? "met" : "not_met",
      evidenceIds: eBreadth ? [eBreadth] : [],
      reevaluateMeaning: "若上涨比例越过 50%，重新评估参与度是否高于下跌与平盘合计的一半；此条件仅触发描述复核。",
    }],
    assessment: primaryPoints.length ? "limited" : "insufficient",
  };
}
