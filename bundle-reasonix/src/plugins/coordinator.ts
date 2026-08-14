import { AgentLoopPort } from "../ports";

/**
 * 双模型 Coordinator（4.2.4）。
 * planner 为低频次子 Agent（维持自身前缀稳定），executor 为完整工具使用 Agent。
 * 本文件为配置骨架，M3 接入 ctx.agents 子 Agent 委派接缝。
 */
export interface CoordinatorConfig {
  plannerModel: string;
  executorModel: string;
  /** 是否启用 planner 上行审批（plan for approval） */
  planApproval: boolean;
  /** 自适应研究深度上限（0 表示不设固定上限，见 issue #8830/#8776 回归项） */
  maxResearchRounds: number;
}

export function createCoordinatorConfig(
  overrides: Partial<CoordinatorConfig> = {},
): CoordinatorConfig {
  return {
    plannerModel: "deepseek-v4-flash",
    executorModel: "deepseek-v4-flash",
    planApproval: false,
    maxResearchRounds: 0,
    ...overrides,
  };
}

/** Coordinator 插件：回合边界护栏（turn 准入 / stop 语义） */
export function createCoordinatorPlugin(loop: AgentLoopPort, cfg: CoordinatorConfig) {
  return {
    canStartTurn(sessionId: string) {
      return loop.canStartTurn(sessionId);
    },
    onTurnStopping(sessionId: string, reason: string) {
      return loop.stopTurn(sessionId, reason);
    },
    config: cfg,
  };
}
