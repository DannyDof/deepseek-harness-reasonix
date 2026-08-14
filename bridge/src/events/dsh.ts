/**
 * dsh 事件模型（session/event + agent/* + telemetry/* 侧）
 *
 * 依据 DeepSeek Harness 的 SessionEvent 日志事实与 Cordis 类型化事件。
 * 桥接层以该模型为"引擎契约"（见 docs/architecture.md 第 12.2 节），
 * 任何引擎字段/广播时机变动都应先反映在这里并触发契约测试。
 */

/** dsh 会话标识 */
export interface DshSessionId {
  sessionId: string;
}

/** 用户消息写入 SessionEvent 日志 */
export interface DshUserMessage extends DshSessionId {
  kind: "user/message";
  role: "user";
  content: string;
}

/** 助手流式分片 */
export interface DshAssistantChunk extends DshSessionId {
  kind: "assistant/chunk";
  delta: string;
}

/** 助手完整消息 */
export interface DshAssistantMessage extends DshSessionId {
  kind: "assistant/message";
  content: string;
  model?: string;
}

/** 工具调用 */
export interface DshToolCall extends DshSessionId {
  kind: "tool/call";
  callId: string;
  name: string;
  arguments: unknown;
}

/** 工具结果 */
export interface DshToolResult extends DshSessionId {
  kind: "tool/result";
  callId: string;
  ok: boolean;
  output: string;
}

/** 会话开始 */
export interface DshSessionStarted extends DshSessionId {
  kind: "session/started";
  title?: string;
}

/** 会话停止 */
export interface DshSessionStopped extends DshSessionId {
  kind: "session/stopped";
}

/** agent 状态（running / idle） */
export interface DshAgentStatus extends DshSessionId {
  kind: "agent/status";
  status: "running" | "idle";
}

/** agent 回合边界事件（step 前） */
export interface DshAgentPreStep extends DshSessionId {
  kind: "agent/pre-step";
  stepIndex: number;
}

/** agent turn 终止信号 */
export interface DshAgentTurnStopping extends DshSessionId {
  kind: "agent/turn-stopping";
  reason: string;
}

/** agent 请求（审批等，宿主可见） */
export interface DshAgentRequest extends DshSessionId {
  kind: "agent/request";
  requestId: string;
  requestType: "approval" | "plan";
  summary: string;
  payload?: unknown;
}

/** agent 校验 */
export interface DshAgentValidation extends DshSessionId {
  kind: "agent/validation";
  ok: boolean;
  detail?: string;
}

/** 遥测成本事件 */
export interface DshTelemetryCost extends DshSessionId {
  kind: "telemetry/cost";
  turnCostUsd: number;
  sessionCostUsd: number;
  tier: "flash" | "pro";
  inputTokens: number;
  outputTokens: number;
}

export type DshEvent =
  | DshUserMessage
  | DshAssistantChunk
  | DshAssistantMessage
  | DshToolCall
  | DshToolResult
  | DshSessionStarted
  | DshSessionStopped
  | DshAgentStatus
  | DshAgentPreStep
  | DshAgentTurnStopping
  | DshAgentRequest
  | DshAgentValidation
  | DshTelemetryCost;
