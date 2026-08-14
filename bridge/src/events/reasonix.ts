/**
 * Reasonix 事件模型（event.Sink 侧）
 *
 * 对应上游 Reasonix internal/event 的传输无关事件流。
 * 桥接层以该模型为"前端契约"（见 docs/architecture.md 第 5 节），
 * 前端只消费本模型投影后的渲染事件。
 */

/** 会话/回合上下文元信息 */
export interface SessionMeta {
  sessionId: string;
  tabId?: string;
}

/** 用户消息 */
export interface ReasonixUserMessage extends SessionMeta {
  type: "user_message";
  content: string;
  images?: string[];
}

/** 助手流式分片 */
export interface ReasonixAssistantChunk extends SessionMeta {
  type: "assistant_chunk";
  delta: string;
}

/** 助手完整消息 */
export interface ReasonixAssistantMessage extends SessionMeta {
  type: "assistant_message";
  content: string;
  model?: string;
}

/** 工具调用发起 */
export interface ReasonixToolCall extends SessionMeta {
  type: "tool_call";
  callId: string;
  name: string;
  arguments: unknown;
}

/** 工具调用结果 */
export interface ReasonixToolResult extends SessionMeta {
  type: "tool_result";
  callId: string;
  ok: boolean;
  output: string;
}

/** 回合开始 */
export interface ReasonixTurnStarted extends SessionMeta {
  type: "turn_started";
}

/** 回合结束 */
export interface ReasonixTurnDone extends SessionMeta {
  type: "turn_done";
}

/** 运行状态变化（running / idle） */
export interface ReasonixStatusChanged extends SessionMeta {
  type: "status_changed";
  status: "running" | "idle";
}

/** 成本更新（绿/黄/红徽标数据） */
export interface ReasonixCostUpdated extends SessionMeta {
  type: "cost_updated";
  turnCostUsd: number;
  sessionCostUsd: number;
  tier: "flash" | "pro";
  /** 分级阈值：green < amber < red */
  level: "green" | "amber" | "red";
}

/** 审批请求（工具 / 写操作 / 计划） */
export interface ReasonixApprovalRequest extends SessionMeta {
  type: "approval_request";
  requestId: string;
  kind: "tool" | "write" | "plan" | "memory";
  summary: string;
  payload?: unknown;
}

/** 审批结果 */
export interface ReasonixApprovalResult extends SessionMeta {
  type: "approval_result";
  requestId: string;
  approved: boolean;
}

/** 会话生命周期 */
export interface ReasonixSessionOpened extends SessionMeta {
  type: "session_opened";
  title?: string;
}
export interface ReasonixSessionClosed extends SessionMeta {
  type: "session_closed";
}

/** 桥接/引擎错误 */
export interface ReasonixError extends SessionMeta {
  type: "error";
  code: string;
  message: string;
}

export type ReasonixEvent =
  | ReasonixUserMessage
  | ReasonixAssistantChunk
  | ReasonixAssistantMessage
  | ReasonixToolCall
  | ReasonixToolResult
  | ReasonixTurnStarted
  | ReasonixTurnDone
  | ReasonixStatusChanged
  | ReasonixCostUpdated
  | ReasonixApprovalRequest
  | ReasonixApprovalResult
  | ReasonixSessionOpened
  | ReasonixSessionClosed
  | ReasonixError;
