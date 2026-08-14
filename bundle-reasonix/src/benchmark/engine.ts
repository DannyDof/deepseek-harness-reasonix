import { Engine, TaskOutcome, TurnUsage, Baseline } from "./benchmark";

/**
 * 模拟 dsh 引擎 + E2E 任务套件 + 基线（M4 基准验证用）。
 * 集成真实 dsh 后以真实会话回放替换 createSimulatedEngine。
 */

export interface SimulatedEngineOptions {
  /** 不可变前缀 token 数（system prompt + tools + few-shots） */
  prefixTokens: number;
  /** 每 warm turn 新增输入 token */
  perTurnInputTokens: number;
  /** 每 turn 输出 token */
  outputTokens: number;
  /** 每任务 turn 数（1 cold + (turns-1) warm） */
  turns: number;
  /** 是否命中前缀缓存（false 模拟"无缓存"退化） */
  cacheEnabled: boolean;
}

export function simulateTurns(opts: SimulatedEngineOptions): TurnUsage[] {
  const turns: TurnUsage[] = [];
  for (let i = 0; i < opts.turns; i++) {
    if (i === 0) {
      // 冷启动：前缀整体上送（无缓存）
      turns.push({ inputTokens: opts.prefixTokens, cacheReadTokens: 0, outputTokens: opts.outputTokens });
    } else if (opts.cacheEnabled) {
      // 缓存命中：仅上送增量，前缀走缓存
      turns.push({
        inputTokens: opts.perTurnInputTokens,
        cacheReadTokens: opts.prefixTokens,
        outputTokens: opts.outputTokens,
      });
    } else {
      // 无缓存退化：前缀整体重发
      turns.push({
        inputTokens: opts.prefixTokens + opts.perTurnInputTokens,
        cacheReadTokens: 0,
        outputTokens: opts.outputTokens,
      });
    }
  }
  return turns;
}

export function createSimulatedEngine(opts: SimulatedEngineOptions): Engine {
  return {
    async runTask(id: string, _task: string): Promise<TaskOutcome> {
      const ok = id !== "e2e-fail";
      return { id, success: ok, turns: simulateTurns(opts), model: "flash" };
    },
  };
}

/** 默认 E2E 任务套件：5 项全应成功（含 1 项标记为易失败，供回归检测）。 */
export const E2E_TASKS: Baseline = {
  tasks: [
    { id: "e2e-scaffold", expected: true, baselineCostUsd: 0.005 },
    { id: "e2e-refactor", expected: true, baselineCostUsd: 0.005 },
    { id: "e2e-fix", expected: true, baselineCostUsd: 0.005 },
    { id: "e2e-test", expected: true, baselineCostUsd: 0.005 },
    { id: "e2e-fail", expected: false, baselineCostUsd: 0.005 },
  ],
};

export const DEFAULT_ENGINE_OPTIONS: SimulatedEngineOptions = {
  prefixTokens: 20_000,
  perTurnInputTokens: 1_000,
  outputTokens: 1_000,
  turns: 4,
  cacheEnabled: true,
};
