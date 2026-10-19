import type { BreadthPoint, PricePoint } from "../contracts/research";

export function intervalReturn(values: number[], intervals: number): number | null {
  if (!Number.isInteger(intervals) || intervals < 1 || values.length <= intervals) return null;
  const window = values.slice(-(intervals + 1));
  if (!window.every((value) => Number.isFinite(value) && value > 0)) return null;
  const first = window[0];
  const last = values.at(-1);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0 || last === undefined) return null;
  const result = last / first - 1;
  return Number.isFinite(result) ? result : null;
}

export function simpleMovingAverage(values: number[], window: number): number | null {
  if (!Number.isInteger(window) || window < 1 || values.length < window) return null;
  const slice = values.slice(-window);
  if (!slice.every((value) => Number.isFinite(value) && value > 0)) return null;
  return slice.reduce((sum, value) => sum + value / window, 0);
}

export function maximumDrawdown(values: number[]): number | null {
  if (values.length < 2 || !values.every((value) => Number.isFinite(value) && value > 0)) return null;
  let peak = values[0];
  let worst = 0;
  for (const value of values.slice(1)) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

export function annualizedVolatility(values: number[], intervals: number): number | null {
  if (values.length <= intervals || intervals < 2) return null;
  const prices = values.slice(-(intervals + 1));
  if (!prices.every((value) => Number.isFinite(value) && value > 0)) return null;
  const returns = prices.slice(1).map((value, index) => Math.log(value) - Math.log(prices[index]));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const sampleVariance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  const result = Math.sqrt(sampleVariance * 252);
  return Number.isFinite(result) ? result : null;
}

export function breadthRatio(point: BreadthPoint | undefined): number | null {
  if (!point) return null;
  const counts = [point.upCount, point.downCount, point.flatCount];
  if (!counts.every((value) => Number.isSafeInteger(value) && value >= 0)) return null;
  const total = counts.reduce((sum, value) => sum + value, 0);
  return total > 0 ? point.upCount / total : null;
}

export function breadthMean(points: BreadthPoint[], window = 5): number | null {
  if (points.length < window || window < 1) return null;
  const recent = points.slice(-window);
  const population = new Set(recent.map((point) => point.universeDefinition));
  if (population.size !== 1) return null;
  const ratios = recent.map(breadthRatio);
  if (ratios.some((ratio) => ratio === null)) return null;
  return (ratios as number[]).reduce((sum, ratio) => sum + ratio, 0) / window;
}

export function amountRatio(points: PricePoint[], window = 20): number | null {
  if (points.length <= window || window < 1) return null;
  const baseline = points.slice(-(window + 1), -1).map((point) => point.amountCny);
  const current = points.at(-1)?.amountCny;
  if (current === null || current === undefined || !Number.isFinite(current) || current < 0) return null;
  if (!baseline.every((value): value is number => value !== null && Number.isFinite(value) && value >= 0)) return null;
  const mean = baseline.reduce((sum, value) => sum + value / window, 0);
  if (mean <= 0) return null;
  const result = current / mean;
  return Number.isFinite(result) ? result : null;
}

export function normalizedSeries(points: PricePoint[]): Array<{ tradeDate: string; value: number }> {
  const first = points[0]?.close;
  if (!first || first <= 0) return [];
  return points.flatMap((point) => {
    if (!Number.isFinite(point.close) || point.close <= 0) return [];
    const value = (point.close / first) * 100;
    return Number.isFinite(value) ? [{ tradeDate: point.tradeDate, value }] : [];
  });
}
