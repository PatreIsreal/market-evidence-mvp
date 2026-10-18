import type { Dimension, ResearchSnapshot } from "@/lib/contracts/research";
import { dimensionLabels } from "@/lib/contracts/research";

export type ConfidenceAssessment = {
  level: "high" | "medium" | "low" | "not_assessed";
  label: string;
  reason: string;
};

const dimensions: Dimension[] = ["price", "breadth", "style", "valuation", "liquidity", "sentiment", "events"];

const requiredDimensions: Record<ResearchSnapshot["scope"]["focus"], Dimension[]> = {
  overview: ["price", "breadth", "style"],
  style: ["price", "style"],
  risk: ["price", "breadth", "liquidity"],
  historical: ["price", "breadth"],
};

export function assessResearchConfidence(snapshot: ResearchSnapshot, hasValidatedReport: boolean): ConfidenceAssessment {
  if (snapshot.synthetic) {
    return { level: "not_assessed", label: "未评估", reason: "合成演示数据不用于真实市场研判的置信度评估。" };
  }
  if (!hasValidatedReport) {
    return { level: "not_assessed", label: "未评估", reason: "本轮没有通过校验的 AI 归纳，仅保留事实和数据质量状态。" };
  }

  const required = requiredDimensions[snapshot.scope.focus];
  const missingRequired = required.filter((dimension) => snapshot.dimensionStatuses[dimension].status !== "available");
  if (missingRequired.length) {
    const labels = missingRequired.map((dimension) => dimensionLabels[dimension]).join("、");
    return {
      level: "low",
      label: "低",
      reason: `本轮核心证据未通过质量检查：${labels}；相关归纳受到限制。`,
    };
  }

  const missingSupplementary = dimensions.filter((dimension) => !required.includes(dimension) && snapshot.dimensionStatuses[dimension].status !== "available");
  const limitedBreadthHistory = required.includes("breadth") && snapshot.breadthSeries.length < 5;
  if (missingSupplementary.length || limitedBreadthHistory) {
    const reasons = [
      ...(limitedBreadthHistory ? ["市场宽度只有当日快照，无法验证历史参与度"] : []),
      ...(missingSupplementary.length ? [`辅助维度缺口：${missingSupplementary.map((dimension) => dimensionLabels[dimension]).join("、")}`] : []),
    ];
    return { level: "medium", label: "中", reason: `${reasons.join("；")}；结论强度有限。` };
  }

  return { level: "high", label: "高", reason: "研究所需维度齐备、时点一致，且有多类证据支持当前归纳。" };
}
