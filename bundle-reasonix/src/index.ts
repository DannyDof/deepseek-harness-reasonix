/**
 * dsh-bundle-reasonix 入口。
 *
 * 导出防腐层 Ports 与四个能力插件的工厂；M2/M3 按 dsh 实际
 * 接缝（table 12-2）实现 adapter 并在此注册。
 */
export * from "./ports";
export { createCacheFirstPlugin } from "./plugins/cache-first";
export { createRepairPlugin } from "./plugins/repair";
export { createCostPlugin } from "./plugins/cost";
export { createCoordinatorConfig, createCoordinatorPlugin } from "./plugins/coordinator";

/**
 * bundle 消费的 dsh 接缝清单（docs/architecture.md 表 12-2）。
 * 用于契约测试与升级影响面评估：任何字段/时序变动都应在此登记。
 */
export interface DshSeamConsumed {
  ctxAgentLoop: boolean;
  ctxAgents: boolean;
  ctxTools: boolean;
  ctxLlm: boolean;
  sessionEvent: boolean;
  agentEvents: boolean;
  systemPromptSegments: boolean;
  telemetrySeam: boolean;
}

export const DEFAULT_SEAM_CONSUMED: DshSeamConsumed = {
  ctxAgentLoop: true,
  ctxAgents: true,
  ctxTools: true,
  ctxLlm: true,
  sessionEvent: true,
  agentEvents: true,
  systemPromptSegments: true,
  telemetrySeam: true,
};
