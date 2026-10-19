import type { Dimension, ResearchSnapshot } from "@/lib/contracts/research";
import { dimensionLabels } from "@/lib/contracts/research";

function metric(value: number | null, unit = "") {
  return value === null ? "未计算" : `${Number(value.toFixed(6))}${unit}`;
}

function safeHttpsUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function snapshotToMarkdown(snapshot: ResearchSnapshot) {
  const dimensions: Dimension[] = ["price", "breadth", "style", "valuation", "liquidity", "sentiment", "events"];
  const metrics = [
    ["20 日区间收益", metric(snapshot.metrics.return20 === null ? null : snapshot.metrics.return20 * 100, "%")],
    ["60 日区间收益", metric(snapshot.metrics.return60 === null ? null : snapshot.metrics.return60 * 100, "%")],
    ["区间最大回撤", metric(snapshot.metrics.maxDrawdown === null ? null : snapshot.metrics.maxDrawdown * 100, "%")],
    ["20 日年化波动率", metric(snapshot.metrics.volatility20 === null ? null : snapshot.metrics.volatility20 * 100, "%")],
    ["当日上涨比例", metric(snapshot.metrics.breadthLatest === null ? null : snapshot.metrics.breadthLatest * 100, "%")],
    ["小盘－大盘代理收益差", metric(snapshot.metrics.styleSpread20 === null ? null : snapshot.metrics.styleSpread20 * 100, "百分点")],
    ["成交额相对过去 20 日", metric(snapshot.metrics.amountRatio20, "倍")],
  ];

  const report = snapshot.aiReport;
  const reportContext = report
    ? snapshot.synthetic
      ? "> AI 最终结论基于本轮合成演示证据，仅用于演示。"
      : report.generationMode === "rule_fallback"
        ? "> 规则兜底结论由服务端根据本轮已校验证据生成；" + (report.recoveryNote ?? "请同时参考数据时点、口径与质量状态。")
        : "> 最终结论由 " + report.modelName + " 基于本轮证据生成；" + (report.recoveryNote ?? "请同时参考数据时点、口径与质量状态。")
    : snapshot.synthetic
      ? "> 本轮未生成 AI 最终结论；以下合成数据与代码计算仅用于演示。"
      : "> 本轮未生成 AI 最终结论；导出仅包含已计算指标、来源状态与证据索引。";
  return [
    `# ${snapshot.indexName}市场状态研究`,
    "",
    `- 报告 ID：${snapshot.reportId}`,
    `- 模式：${snapshot.mode}${snapshot.synthetic ? "（合成演示）" : ""}`,
    `- 研究区间：${snapshot.scope.actualStartDate} 至 ${snapshot.scope.actualEndDate}`,
    `- 数据来源：${snapshot.sourceLabel}`,
    `- 生成时间：${snapshot.generatedAt}`,
    `- 交易日说明：${snapshot.scope.calendarNote}`,
    "",
    reportContext,
    "",
    "## 指标",
    "",
    ...metrics.map(([label, value]) => `- ${label}：${value}`),
    ...(report ? [
      "",
      "## AI 最终结论",
      "",
      "- 生成方式：" + (report.generationMode === "model" ? "模型完整报告" : report.generationMode === "recovered" ? "模型修复结论" : "规则兜底"),
      `- 模型：${report.modelName}`,
      `- 七维证据覆盖：${report.evidenceCoverage}%（行情结构、市场宽度、风格、估值、流动性、情绪、事件；不代表涨跌概率）`,
      "",
      report.summary,
      "",
      "摘要证据：" + report.summaryEvidenceIds.join(", "),
      "",
      "### 证据支持的观察",
      "",
      ...report.observations.map((item) => `- ${item.statement}（证据：${item.evidenceIds.join(", ")}）`),
      ...(report.counterpoints.length ? ["", "### 反证与限制", "", ...report.counterpoints.map((item) => `- ${item.statement}（证据：${item.evidenceIds.join(", ")}）`)] : []),
      ...(report.uncertainties.length ? ["", "### 不确定事项", "", ...report.uncertainties.map((item) => `- ${dimensionLabels[item.dimension]}：${item.statement}`)] : []),
    ] : []),
    "",
    "## 证据维度状态",
    "",
    ...dimensions.map((dimension) => {
      const item = snapshot.dimensionStatuses[dimension];
      return `- ${dimensionLabels[dimension]}：${item.status}；截至 ${item.dataAsOf ?? "无数据"}；${item.explanation}`;
    }),
    "",
    "## 证据条目",
    "",
    ...(snapshot.evidence.length ? snapshot.evidence.map((item) => {
      const value = typeof item.value === "number" ? metric(item.value, item.unit) : String(item.value ?? "无值");
      const formula = item.derivation?.parameters.note;
      const sourceLink = item.dimension === "events" ? item.sourceRefs.map((ref) => safeHttpsUrl(ref.sourceUrl)).find(Boolean) : null;
      return `- **${item.id} ${item.label}**：${value}；${item.period.start} 至 ${item.period.end}；${item.scopeDescription}${sourceLink ? `；[原文](${sourceLink})` : ""}${formula ? `；计算：${formula}` : ""}${item.issues.length ? `；说明：${item.issues.join("；")}` : ""}`;
    }) : ["- 当前没有可导出的证据条目。"]),
    "",
    "## 重新评估条件",
    "",
    ...(snapshot.switchConditions.length ? snapshot.switchConditions.map((item) => `- ${item.label}：当前 ${metric(item.currentValue, item.unit)}，条件 ${item.operator} ${item.threshold}${item.unit}，状态 ${item.evaluation}；${item.reevaluateMeaning}`) : ["- 本轮没有可计算的切换条件。"]),
    "",
  ].join("\n");
}

export function downloadSnapshot(snapshot: ResearchSnapshot, format: "json" | "markdown") {
  const content = format === "json" ? JSON.stringify(snapshot, null, 2) : snapshotToMarkdown(snapshot);
  const mime = format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8";
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `market-research-${snapshot.reportId}.${format === "json" ? "json" : "md"}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
