import { breadthMean, breadthRatio, intervalReturn, maximumDrawdown, annualizedVolatility, simpleMovingAverage, amountRatio } from "./metrics";
import type {
  BreadthPoint,
  Dimension,
  DimensionStatus,
  Evidence,
  PricePoint,
  ResearchInput,
  ResearchSnapshot,
} from "../contracts/research";
import { dimensionLabels } from "../contracts/research";

const INDEX_NAMES: Record<string, string> = {
  SSE_COMPOSITE: "上证指数（合成序列）",
  SZSE_COMPONENT: "深证成指（合成序列）",
  CHINEXT: "创业板指（合成序列）",
  CSI300: "沪深300（合成序列）",
  CSI1000: "中证1000（合成序列）",
};

function syntheticWorkdays(endDate: string, count: number): string[] {
  const result: string[] = [];
  const current = new Date(`${endDate}T12:00:00Z`);
  while (result.length < count) {
    const weekday = current.getUTCDay();
    if (weekday !== 0 && weekday !== 6) result.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() - 1);
  }
  return result.reverse();
}

function beijingDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function indexSeries(indexId: string, dates: string[], seed: number): PricePoint[] {
  return dates.map((tradeDate, index) => {
    const wave = Math.sin((index + seed) / 8) * 2.4 + Math.cos((index + seed) / 15) * 1.2;
    const close = 100 + index * (seed % 2 === 0 ? 0.045 : 0.018) + wave;
    const previous = index === 0 ? close * 0.998 : 100 + (index - 1) * (seed % 2 === 0 ? 0.045 : 0.018) + Math.sin((index - 1 + seed) / 8) * 2.4 + Math.cos((index - 1 + seed) / 15) * 1.2;
    const open = (close + previous) / 2;
    const amountCny = indexId === "SSE_COMPOSITE" ? 120_000_000_000 + index * 12_000_000 : 55_000_000_000 + index * 8_000_000;
    return {
      tradeDate,
      open,
      high: Math.max(open, close) * 1.006,
      low: Math.min(open, close) * 0.994,
      close,
      amountCny,
    };
  });
}

function breadthSeries(dates: string[]): BreadthPoint[] {
  return dates.map((tradeDate, index) => {
    const ratio = Math.min(0.72, Math.max(0.28, 0.51 + Math.sin(index / 7) * 0.11));
    const upCount = Math.round(ratio * 1000);
    const downCount = 1000 - upCount - (index % 9) * 3;
    const flatCount = 1000 - upCount - downCount;
    return { tradeDate, upCount, downCount, flatCount, universeDefinition: "合成的固定 1000 单位样本；非真实股票范围" };
  });
}

function status(statusValue: DimensionStatus["status"], explanation: string, dataAsOf: string | null): DimensionStatus {
  return { status: statusValue, explanation, dataAsOf };
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
  description: string,
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
    sourceRefs: [{ datasetId: `demo-${dimension}`, recordKeys: dates, fields }],
    derivation: { formulaId, formulaVersion: "mvp-v1", inputEvidenceIds: [], parameters: { note: formula } },
    issues: ["仅为代码生成的合成演示数据，不代表真实 A 股记录。"],
  });
  return id;
}

export function createDemoSnapshot(input: ResearchInput, generatedAt = new Date().toISOString()): ResearchSnapshot {
  const today = beijingDate(new Date(generatedAt));
  const period = input.scope.period;
  const endDate = period.kind === "range" ? period.endDate : input.scope.asOfDate ?? today;
  const count = period.kind === "lookback"
    ? Math.max(122, period.tradingDays + 1)
    : Math.min(10_000, Math.max(2, Math.ceil((Date.parse(`${period.endDate}T00:00:00Z`) - Date.parse(`${period.startDate}T00:00:00Z`)) / 86_400_000 * 5 / 7) + 10));
  const allDates = syntheticWorkdays(endDate, count);
  const primary = indexSeries(input.scope.primaryIndex, allDates, 3);
  const large = indexSeries(input.scope.comparisonIndexes[0] ?? "CSI300", allDates, 4);
  const small = indexSeries(input.scope.comparisonIndexes[1] ?? "CSI1000", allDates, 8);
  const breadthAll = breadthSeries(allDates);
  const visiblePoints = period.kind === "lookback"
    ? primary.slice(-(period.tradingDays + 1))
    : primary.filter((point) => point.tradeDate >= period.startDate && point.tradeDate <= period.endDate);
  const visibleDates = visiblePoints.map((point) => point.tradeDate);
  const hasVisibleData = visiblePoints.length > 0;
  const latestDate = visibleDates.at(-1) ?? allDates.at(-1) ?? endDate;
  const latestPrimary = visiblePoints;
  const latestBreadth = hasVisibleData ? breadthAll.find((point) => point.tradeDate === latestDate) : undefined;
  const ratio = breadthRatio(latestBreadth);
  const selectedBreadth = breadthAll.filter((point) => visibleDates.includes(point.tradeDate));
  const return20 = intervalReturn(latestPrimary.map((point) => point.close), 20);
  const return60 = intervalReturn(latestPrimary.map((point) => point.close), 60);
  const ma20 = simpleMovingAverage(latestPrimary.map((point) => point.close), 20);
  const drawdown = maximumDrawdown(visiblePoints.map((point) => point.close));
  const volatility20 = annualizedVolatility(latestPrimary.map((point) => point.close), 20);
  const volatility60 = annualizedVolatility(latestPrimary.map((point) => point.close), 60);
  const breadth5 = breadthMean(selectedBreadth, 5);
  const comparisonDates = new Set(visibleDates);
  const largeSelected = large.filter((point) => comparisonDates.has(point.tradeDate));
  const smallSelected = small.filter((point) => comparisonDates.has(point.tradeDate));
  const smallReturn20 = intervalReturn(smallSelected.map((point) => point.close), 20);
  const alignedLargeReturn20 = intervalReturn(largeSelected.map((point) => point.close), 20);
  const styleSpread20 = alignedLargeReturn20 !== null && smallReturn20 !== null ? smallReturn20 - alignedLargeReturn20 : null;
  const amountRatio20 = amountRatio(latestPrimary);

  const evidence: Evidence[] = [];
  const selectedIndexId = input.scope.primaryIndex;
  const eReturn = return20 === null ? null : addEvidence(evidence, "price", "合成指数 20 日区间收益", return20 * 100, "%", latestPrimary.slice(-21).map((point) => point.tradeDate), "return20", "C_t / C_(t-20) - 1", ["close"], `${INDEX_NAMES[selectedIndexId]}；合成序列`);
  const eMa = ma20 === null ? null : addEvidence(evidence, "price", "合成指数 MA20", ma20, "合成点位", latestPrimary.slice(-20).map((point) => point.tradeDate), "ma20", "最近 20 个有效合成收盘值的简单均值", ["close"], `${INDEX_NAMES[selectedIndexId]}；仅演示计算`);
  if (drawdown !== null) addEvidence(evidence, "price", "合成指数区间最大回撤", drawdown * 100, "%", visibleDates, "maxDrawdown", "min(C_i / 历史最高收盘_i - 1)", ["close"], `${INDEX_NAMES[selectedIndexId]}；仅演示计算`);
  if (volatility20 !== null) addEvidence(evidence, "price", "合成年化波动率（20 日）", volatility20 * 100, "%", latestPrimary.slice(-21).map((point) => point.tradeDate), "volatility20", "20 日对数收益样本标准差 × sqrt(252)", ["close"], `${INDEX_NAMES[selectedIndexId]}；仅演示计算`);
  const eBreadth = ratio === null ? null : addEvidence(evidence, "breadth", "合成样本当日上涨比例", ratio * 100, "%", [latestDate], "breadthLatest", "上涨家数 / (上涨 + 下跌 + 平盘)", ["upCount", "downCount", "flatCount"], "合成的固定 1000 单位样本；非真实股票范围");
  const eStyle = styleSpread20 === null ? null : addEvidence(evidence, "style", "合成代理 20 日风格差", styleSpread20 * 100, "百分点", visibleDates.slice(-21), "styleSpread20", "小盘代理 20 日收益 - 大盘代理 20 日收益", ["close"], "两个合成指数代理序列；不代表沪深 300 或中证 1000 表现");
  if (amountRatio20 !== null) addEvidence(evidence, "liquidity", "合成成交额相对过去 20 日均值", amountRatio20, "倍", latestPrimary.slice(-21).map((point) => point.tradeDate), "amountRatio20", "当日合成成交额 / 前 20 日合成成交额均值", ["amountCny"], "合成指数成交额；非真实成交数据");

  const stateTags: ResearchSnapshot["stateTags"] = [];
  if (return20 !== null && ma20 !== null && latestPrimary.at(-1)!.close > ma20 && return20 > 0) {
    stateTags.push({ id: "price-structure-positive", label: "合成序列：区间价格结构偏强", evidenceIds: [eReturn, eMa].filter((id): id is string => Boolean(id)) });
  }
  if (breadth5 !== null && breadth5 >= 0.6) stateTags.push({ id: "breadth-broad", label: "合成序列：近五日参与较广", evidenceIds: [eBreadth].filter((id): id is string => Boolean(id)) });
  if (breadth5 !== null && breadth5 <= 0.4) stateTags.push({ id: "breadth-limited", label: "合成序列：近五日参与有限", evidenceIds: [eBreadth].filter((id): id is string => Boolean(id)) });
  if (styleSpread20 !== null && Math.abs(styleSpread20) >= 0.02) stateTags.push({ id: "style-different", label: "合成代理：历史表现差异明显", evidenceIds: [eStyle].filter((id): id is string => Boolean(id)) });
  if (return20 !== null && breadth5 !== null && ((return20 > 0 && breadth5 <= 0.4) || (return20 < 0 && breadth5 >= 0.6))) {
    stateTags.push({ id: "index-breadth-divergence", label: "合成序列：指数表现与参与度背离", evidenceIds: [eReturn, eBreadth].filter((id): id is string => Boolean(id)) });
  }

  const dimensionStatuses: Record<Dimension, DimensionStatus> = {
    price: status(hasVisibleData ? "available" : "missing", hasVisibleData ? "合成的工作日序列；不是供应商行情。" : "所选日期范围没有生成演示工作日数据。", hasVisibleData ? latestDate : null),
    breadth: status(latestBreadth ? "available" : "missing", latestBreadth ? "合成固定样本；没有历史股票范围或真实成分。" : "所选日期范围没有可用的演示宽度快照。", latestBreadth ? latestDate : null),
    style: status(styleSpread20 !== null ? "available" : "missing", styleSpread20 !== null ? "合成指数代理；不代表真实大小盘指数。" : "所选范围内没有足够的合成对比数据。", styleSpread20 !== null ? latestDate : null),
    valuation: status("unavailable", "估值接口尚未连接；演示不生成估值。", null),
    liquidity: status(hasVisibleData ? "available" : "missing", hasVisibleData ? "合成成交额仅用于演示单位与指标展示。" : "所选日期范围没有演示成交额数据。", hasVisibleData ? latestDate : null),
    sentiment: status("unavailable", "情绪数据源尚未连接。", null),
    events: status("unavailable", "事件数据源尚未连接。", null),
  };

  return {
    snapshotId: crypto.randomUUID(),
    reportId: crypto.randomUUID(),
    parentReportId: input.context?.parentReportId ?? null,
    mode: "demo",
    generatedAt,
    synthetic: true,
    scope: {
      ...input.scope,
      actualStartDate: visibleDates[0] ?? (period.kind === "range" ? period.startDate : latestDate),
      actualEndDate: visibleDates.at(-1) ?? (period.kind === "range" ? period.endDate : latestDate),
      calendarNote: hasVisibleData ? "演示日期按工作日合成，未使用真实交易日历。" : "所选区间没有合成工作日观测；没有生成行情或宽度数值。",
    },
    indexName: INDEX_NAMES[selectedIndexId],
    sourceLabel: "合成数据（仅演示交互与计算）",
    priceSeries: visiblePoints,
    breadthSeries: selectedBreadth,
    comparisonSeries: [
      { indexId: input.scope.comparisonIndexes[0] ?? "CSI300", indexName: "大盘合成代理", points: large.filter((point) => comparisonDates.has(point.tradeDate)) },
      { indexId: input.scope.comparisonIndexes[1] ?? "CSI1000", indexName: "小盘合成代理", points: small.filter((point) => comparisonDates.has(point.tradeDate)) },
    ],
    metrics: { return20, return60, ma20, maxDrawdown: drawdown, volatility20, volatility60, breadthLatest: ratio, breadth5Day: breadth5, styleSpread20, amountRatio20 },
    stateTags,
    dimensionStatuses,
    evidence,
    switchConditions: ratio === null ? [] : [{
      metricId: "breadth.latest",
      label: "重新检查当日参与度是否超过中性线",
      operator: ">",
      threshold: 50,
      unit: "%",
      observationWindow: "合成样本单日快照",
      currentValue: ratio * 100,
      evaluation: ratio * 100 > 50 ? "met" : "not_met",
      evidenceIds: eBreadth ? [eBreadth] : [],
      reevaluateMeaning: "若合成样本比例跨过该条件，只重新评估演示中的参与度描述。",
    }],
    assessment: "limited",
  };
}

export function dimensionLabel(dimension: Dimension): string {
  return dimensionLabels[dimension];
}
