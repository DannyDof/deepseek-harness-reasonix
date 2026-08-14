/**
 * 防腐层 Ports（稳定抽象）。
 *
 * bundle 业务代码只依赖本文件定义的稳定抽象；dsh 具体 API 波动
 * 封装在 adapter 实现之后（docs/architecture.md 12.6）。
 * M2 起按 dsh 实际接缝实现对应 adapter。
 */

/** 缓存优先循环：保证模型可见前缀字节稳定 */
export interface CachePolicyPort {
  /** 校验某步模型可见内容的不可变前缀是否与缓存键一致 */
  assertPrefixStable(sessionId: string, draft: { prefix: string; body: string }): boolean;
  /** 前缀将变时触发压缩而非重排 */
  compact(sessionId: string, reason: string): Promise<void>;
}

/** 工具调用修复管线：scavenge / flatten / truncation / storm */
export interface RepairPipelinePort {
  /** 从 reasoning_content 抽取遗漏的 tool_call */
  scavenge(sessionId: string, reasoning: string): Promise<unknown[]>;
  /** 非平衡 JSON 时闭合或请求续写 */
  flatten(sessionId: string, malformed: string): Promise<string>;
  /** 陈旧工具结果裁剪比例 */
  truncate(sessionId: string, ratio: number): Promise<void>;
  /** 滑动窗口内重复 (tool,args) 抑制并注入反思步 */
  storm(sessionId: string, recentCalls: Array<{ name: string; args: unknown }>): Promise<string | null>;
}

/** 分级成本管控：flash-first，pro 显式可见 */
export interface CostMeterPort {
  record(sessionId: string, inputTokens: number, outputTokens: number, tier: "flash" | "pro"): void;
  snapshot(sessionId: string): { turnCostUsd: number; sessionCostUsd: number; tier: "flash" | "pro" };
  /** 是否发生"无提示升级"到 pro */
  didSilentUpgrade(sessionId: string): boolean;
}

/** Agent 循环护栏：turn 准入 / stop 语义 */
export interface AgentLoopPort {
  canStartTurn(sessionId: string): boolean;
  stopTurn(sessionId: string, reason: string): Promise<void>;
}
