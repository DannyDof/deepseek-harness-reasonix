import { DEFAULT_PRICING, Pricing } from "../plugins/cost";

/**
 * 基准验证（方案 8.2 + M4）：缓存命中率 / 单任务成本 / E2E 成功率。
 * 提供指标计算与阈值判定；集成真实 dsh 后可注入真实 engine 替换模拟实现。
 */

export interface TurnUsage {
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export interface TaskOutcome {
  id: string;
  success: boolean;
  turns: TurnUsage[];
  model: "flash" | "pro";
}

/** 引擎抽象：M4 用模拟实现；集成时替换为真实 dsh 会话回放。 */
export interface Engine {
  runTask(id: string, task: string): Promise<TaskOutcome>;
}

export interface TaskBaseline {
  id: string;
  expected: boolean;
  /** Reasonix Go 内核记录的该任务成本（美元） */
  baselineCostUsd: number;
}

export interface Baseline {
  tasks: TaskBaseline[];
}

export interface TaskReport {
  id: string;
  success: boolean;
  costUsd: number;
  baselineCostUsd: number;
  costRatio: number;
}

export interface BenchmarkReport {
  tasks: TaskReport[];
  cacheHitRate: number;
  overallCostRatio: number;
  successRate: number;
  baselineSuccessRate: number;
}

/**
 * 前缀缓存命中率（稳态）：仅统计含缓存命中的 turn，
 * 命中率 = cacheReadTokens / (cacheReadTokens + inputTokens)。
 */
export function cacheHitRate(turns: TurnUsage[]): number {
  const warm = turns.filter((t) => t.cacheReadTokens > 0);
  if (warm.length === 0) return 0;
  let cache = 0;
  let total = 0;
  for (const t of warm) {
    cache += t.cacheReadTokens;
    total += t.cacheReadTokens + t.inputTokens;
  }
  return total === 0 ? 0 : cache / total;
}

/** 单任务成本（美元）：输入（含缓存折扣）+ 输出，按档位定价。 */
export function taskCostUsd(turns: TurnUsage[], model: "flash" | "pro", pricing: Pricing = DEFAULT_PRICING): number {
  const p = model === "flash" ? pricing.flash : pricing.pro;
  let cost = 0;
  for (const t of turns) {
    const inputBilled = t.inputTokens + t.cacheReadTokens * pricing.cacheReadFactor;
    cost += (inputBilled * p.inputUsd + t.outputTokens * p.outputUsd) / 1_000_000;
  }
  return cost;
}

export interface BenchThresholds {
  minCacheHitRate: number;
  maxCostRatio: number;
}

export const DEFAULT_BENCH_THRESHOLDS: BenchThresholds = {
  minCacheHitRate: 0.9,
  maxCostRatio: 1.1,
};

export function evaluate(engine: Engine, baseline: Baseline, pricing: Pricing = DEFAULT_PRICING): Promise<BenchmarkReport> {
  return (async () => {
    const tasks: TaskReport[] = [];
    for (const b of baseline.tasks) {
      const outcome = await engine.runTask(b.id, `task:${b.id}`);
      const cost = taskCostUsd(outcome.turns, outcome.model, pricing);
      tasks.push({
        id: outcome.id,
        success: outcome.success,
        costUsd: cost,
        baselineCostUsd: b.baselineCostUsd,
        costRatio: b.baselineCostUsd === 0 ? 1 : cost / b.baselineCostUsd,
      });
    }

    const allTurns = await (async () => {
      const turns: TurnUsage[] = [];
      for (const b of baseline.tasks) {
        const outcome = await engine.runTask(b.id, `task:${b.id}`);
        turns.push(...outcome.turns);
      }
      return turns;
    })();

    const successCount = tasks.filter((t) => t.success).length;
    const baselineSuccessCount = baseline.tasks.filter((t) => t.expected).length;
    const costSum = tasks.reduce((n, t) => n + t.costUsd, 0);
    const baselineSum = baseline.tasks.reduce((n, t) => n + t.baselineCostUsd, 0);

    return {
      tasks,
      cacheHitRate: cacheHitRate(allTurns),
      overallCostRatio: baselineSum === 0 ? 1 : costSum / baselineSum,
      successRate: tasks.length === 0 ? 0 : successCount / tasks.length,
      baselineSuccessRate: baseline.tasks.length === 0 ? 0 : baselineSuccessCount / baseline.tasks.length,
    };
  })();
}

/** 阈值校验，返回违规项（空表示通过）。 */
export function thresholdViolations(report: BenchmarkReport, thresholds: BenchThresholds = DEFAULT_BENCH_THRESHOLDS): string[] {
  const v: string[] = [];
  if (report.cacheHitRate < thresholds.minCacheHitRate) {
    v.push(`缓存命中率 ${(report.cacheHitRate * 100).toFixed(1)}% < ${(thresholds.minCacheHitRate * 100).toFixed(0)}%`);
  }
  if (report.overallCostRatio > thresholds.maxCostRatio) {
    v.push(`单任务成本比 ${report.overallCostRatio.toFixed(3)} > ${thresholds.maxCostRatio}`);
  }
  if (report.successRate < report.baselineSuccessRate) {
    v.push(`E2E 成功率 ${(report.successRate * 100).toFixed(0)}% 回退（基线 ${(report.baselineSuccessRate * 100).toFixed(0)}%）`);
  }
  return v;
}
