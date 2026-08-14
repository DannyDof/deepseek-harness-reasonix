/**
 * dsh 事件模型（引擎契约）
 *
 * 对齐 dsh master 真实事件词汇（session/event 广播 + agent/* 主题事件）：
 * - session/event：turn/start、step/start、user/message、assistant/*、tool/*、request/*；
 * - agent/*：agent/status、agent/session-start、agent/pre-step、agent/request、
 *   agent/request-error、agent/turn-stopping、agent/error；
 * - 审批：dsh-user-approval 落盘的 approval/asked；
 * - 成本：由 llm/stream 瀑布的 usage 分片推导（llm/usage）。
 * 任何引擎字段/广播时机变动都应先反映在这里并触发契约测试（docs/architecture.md 12.7）。
 */

/** dsh 会话标识 */
export interface DshSessionId {
  sessionId: string;
}

/** 会话生命周期（dsh SessionStore 广播） */
export interface DshSessionCreated extends DshSessionId {
  kind: "session/created";
  cwd?: string;
  title?: string;
}
export interface DshSessionDisposed extends DshSessionId {
  kind: "session/disposed";
}

/** 回合生命周期 */
export interface DshTurnStart extends DshSessionId {
  kind: "turn/start";
  seq: number;
}
export interface DshTurnEnd extends DshSessionId {
  kind: "turn/end";
  seq: number;
  reason: "completed" | "aborted" | "blocked" | "error" | "max-tokens" | "interrupted";
}

/** 消息事件 */
export interface DshUserMessage extends DshSessionId {
  kind: "user/message";
  seq: number;
  content: string;
  images?: string[];
}
export interface DshAssistantChunk extends DshSessionId {
  kind: "assistant/chunk";
  delta: string;
}
export interface DshAssistantMessage extends DshSessionId {
  kind: "assistant/message";
  content: string;
  model?: string;
}

/** 工具事件 */
export interface DshToolCall extends DshSessionId {
  kind: "tool/call";
  callId: string;
  name: string;
  arguments: unknown;
}
export interface DshToolResult extends DshSessionId {
  kind: "tool/result";
  callId: string;
  ok: boolean;
  output: string;
}

/** 审批事件（dsh-user-approval 会话事件投影） */
export interface DshApprovalAsked extends DshSessionId {
  kind: "approval/asked";
  requestId: string;
  kindOf: "tool" | "write" | "plan" | "memory";
  summary: string;
  payload?: unknown;
}
export interface DshApprovalResolved extends DshSessionId {
  kind: "approval/resolved";
  requestId: string;
  approved: boolean;
}

/** agent 主题事件 */
export interface DshAgentStatus extends DshSessionId {
  kind: "agent/status";
  status: "running" | "idle";
}
export interface DshAgentSessionStart extends DshSessionId {
  kind: "agent/session-start";
  source: "startup" | "resume" | "clear" | "compact";
}
export interface DshAgentPreStep extends DshSessionId {
  kind: "agent/pre-step";
  turn: number;
  step: number;
}
export interface DshAgentTurnStopping extends DshSessionId {
  kind: "agent/turn-stopping";
  turn: number;
  reason: string;
}
export interface DshAgentError extends DshSessionId {
  kind: "agent/error";
  turn: number;
  step: number;
  message: string;
}

/** 成本：由 llm/stream 瀑布 usage 分片推导（TokenUsage 语义） */
export interface DshLlmUsage extends DshSessionId {
  kind: "llm/usage";
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export type DshEvent =
  | DshSessionCreated
  | DshSessionDisposed
  | DshTurnStart
  | DshTurnEnd
  | DshUserMessage
  | DshAssistantChunk
  | DshAssistantMessage
  | DshToolCall
  | DshToolResult
  | DshApprovalAsked
  | DshApprovalResolved
  | DshAgentStatus
  | DshAgentSessionStart
  | DshAgentPreStep
  | DshAgentTurnStopping
  | DshAgentError
  | DshLlmUsage;
