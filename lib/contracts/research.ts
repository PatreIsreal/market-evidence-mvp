import { z } from "zod";

export const dimensions = [
  "price",
  "breadth",
  "style",
  "valuation",
  "liquidity",
  "sentiment",
  "events",
] as const;

export type Dimension = (typeof dimensions)[number];

export const dimensionLabels: Record<Dimension, string> = {
  price: "行情结构",
  breadth: "市场宽度",
  style: "风格轮动",
  valuation: "估值",
  liquidity: "流动性",
  sentiment: "情绪",
  events: "重要事件",
};

const indexIds = [
  "SSE_COMPOSITE",
  "SZSE_COMPONENT",
  "CHINEXT",
  "CSI300",
  "CSI1000",
] as const;

const dateString = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "日期不是有效的日历日期");

const periodSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("lookback"), tradingDays: z.union([z.literal(20), z.literal(60), z.literal(120)]) }),
  z.object({ kind: z.literal("range"), startDate: dateString, endDate: dateString }),
]);

export const researchInputSchema = z.object({
  schemaVersion: z.literal("1.0").default("1.0"),
  question: z.string().trim().min(1, "请输入研究问题").max(1000, "问题最多 1000 字"),
  scope: z.object({
    primaryIndex: z.enum(indexIds),
    period: periodSchema,
    asOfDate: dateString.nullable().default(null),
    focus: z.enum(["overview", "style", "risk", "historical"]).default("overview"),
    comparisonIndexes: z.array(z.enum(indexIds)).max(2).default([]),
  }),
  context: z.object({
    parentReportId: z.string().uuid(),
    parentScope: z.object({
      primaryIndex: z.enum(indexIds),
      period: periodSchema,
      asOfDate: dateString.nullable(),
      focus: z.enum(["overview", "style", "risk", "historical"]),
      comparisonIndexes: z.array(z.enum(indexIds)).max(2),
    }),
  }).optional(),
}).superRefine((input, context) => {
  const periods = [
    ["scope", input.scope.period] as const,
    ...(input.context ? [["context", input.context.parentScope.period] as const] : []),
  ];
  for (const [scopeName, period] of periods) {
    if (period.kind === "range" && period.startDate > period.endDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [scopeName, scopeName === "scope" ? "period" : "parentScope", "startDate"],
        message: "开始日期不能晚于结束日期",
      });
    }
  }
});

export type ResearchInput = z.infer<typeof researchInputSchema>;

export type PricePoint = {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  amountCny: number | null;
};

export type BreadthPoint = {
  tradeDate: string;
  upCount: number;
  downCount: number;
  flatCount: number;
  universeDefinition: string;
};

export type DataStatus = "available" | "missing" | "unavailable" | "stale" | "conflict" | "failed";

export type DimensionStatus = {
  status: DataStatus;
  explanation: string;
  dataAsOf: string | null;
};

export type Evidence = {
  id: string;
  dimension: Dimension;
  label: string;
  kind: "raw_field" | "derived_metric" | "source_excerpt";
  value: number | string | boolean | null;
  unit: string;
  period: { start: string; end: string };
  dataAsOf: string | null;
  status: DataStatus;
  scopeDescription: string;
  sourceRefs: Array<{
    datasetId: string;
    recordKeys: string[];
    fields: string[];
    sourceUrl?: string;
  }>;
  derivation?: {
    formulaId: string;
    formulaVersion: string;
    inputEvidenceIds: string[];
    parameters: Record<string, string | number | boolean>;
  };
  issues: string[];
};

export type SwitchCondition = {
  metricId: string;
  label: string;
  operator: ">" | ">=" | "<" | "<=";
  threshold: number;
  unit: string;
  observationWindow: string;
  currentValue: number | null;
  evaluation: "met" | "not_met" | "unavailable";
  evidenceIds: string[];
  reevaluateMeaning: string;
};

export type AiReport = {
  summary: string;
  summaryEvidenceIds: string[];
  observations: Array<{ statement: string; evidenceIds: string[] }>;
  counterpoints: Array<{ statement: string; evidenceIds: string[] }>;
  uncertainties: Array<{ statement: string; dimension: Dimension }>;
  reevaluationConditionIds: string[];
  evidenceCoverage: number;
  modelName: string;
};

export type ResearchSnapshot = {
  snapshotId: string;
  reportId: string;
  parentReportId: string | null;
  mode: "demo" | "live";
  generatedAt: string;
  synthetic: boolean;
  scope: ResearchInput["scope"] & {
    actualStartDate: string;
    actualEndDate: string;
    calendarNote: string;
  };
  indexName: string;
  sourceLabel: string;
  priceSeries: PricePoint[];
  breadthSeries: BreadthPoint[];
  comparisonSeries: Array<{ indexId: string; indexName: string; points: PricePoint[] }>;
  metrics: {
    return20: number | null;
    return60: number | null;
    ma20: number | null;
    maxDrawdown: number | null;
    volatility20: number | null;
    volatility60: number | null;
    breadthLatest: number | null;
    breadth5Day: number | null;
    styleSpread20: number | null;
    amountRatio20: number | null;
  };
  stateTags: Array<{ id: string; label: string; evidenceIds: string[] }>;
  dimensionStatuses: Record<Dimension, DimensionStatus>;
  evidence: Evidence[];
  switchConditions: SwitchCondition[];
  assessment: "supported" | "limited" | "insufficient" | "unavailable";
  aiReport?: AiReport;
};

export type StreamEvent = {
  type: string;
  requestId: string;
  seq: number;
  data: unknown;
};
