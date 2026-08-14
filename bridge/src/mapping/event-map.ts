import {
  ReasonixEvent,
  ReasonixCostUpdated,
} from "../events/reasonix";
import { DshEvent } from "../events/dsh";

/**
 * 成本分级阈值配置（对应 Reasonix StatsPanel 绿/黄/红着色）。
 * 默认参考值：会话成本 <0.05 绿，<0.12 黄，否则红（阈值可经配置覆盖）。
 */
export interface CostThresholds {
  greenSessionUsd: number;
  amberSessionUsd: number;
}

export const DEFAULT_COST_THRESHOLDS: CostThresholds = {
  greenSessionUsd: 0.05,
  amberSessionUsd: 0.12,
};

function costLevel(sessionCostUsd: number, t: CostThresholds): ReasonixCostUpdated["level"] {
  if (sessionCostUsd < t.greenSessionUsd) return "green";
  if (sessionCostUsd < t.amberSessionUsd) return "amber";
  return "red";
}

/**
 * Reasonix 事件 -> dsh 事件（单向映射）。
 * 返回空数组表示该事件仅前端本地语义，无需上送引擎。
 */
export function mapReasonixToDsh(ev: ReasonixEvent): DshEvent[] {
  switch (ev.type) {
    case "user_message":
      return [{ kind: "user/message", sessionId: ev.sessionId, role: "user", content: ev.content }];
    case "assistant_chunk":
      return [{ kind: "assistant/chunk", sessionId: ev.sessionId, delta: ev.delta }];
    case "tool_call":
      return [{ kind: "tool/call", sessionId: ev.sessionId, callId: ev.callId, name: ev.name, arguments: ev.arguments }];
    case "tool_result":
      return [{ kind: "tool/result", sessionId: ev.sessionId, callId: ev.callId, ok: ev.ok, output: ev.output }];
    case "session_opened":
      return [{ kind: "session/started", sessionId: ev.sessionId, title: ev.title }];
    case "session_closed":
      return [{ kind: "session/stopped", sessionId: ev.sessionId }];
    case "approval_result":
      // 审批结果暂以 agent/validation 形式回传；如需精准请求回执，应扩展契约。
      return [{
        kind: "agent/validation",
        sessionId: ev.sessionId,
        ok: ev.approved,
        detail: `approval:${ev.requestId}`,
      }];
    // 以下为引擎下行语义，前端不应回传
    case "assistant_message":
    case "turn_started":
    case "turn_done":
    case "status_changed":
    case "cost_updated":
    case "approval_request":
    case "error":
      return [];
  }
}

/**
 * dsh 事件 -> Reasonix 事件（单向映射）。
 * 返回数组为前端可渲染的事件序列；null 表示该引擎事件对前端不可见。
 */
export function mapDshToReasonix(ev: DshEvent, thresholds: CostThresholds = DEFAULT_COST_THRESHOLDS): ReasonixEvent[] {
  switch (ev.kind) {
    case "user/message":
      return [{ type: "user_message", sessionId: ev.sessionId, content: ev.content }];
    case "assistant/chunk":
      return [{ type: "assistant_chunk", sessionId: ev.sessionId, delta: ev.delta }];
    case "assistant/message":
      return [{ type: "assistant_message", sessionId: ev.sessionId, content: ev.content, model: ev.model }];
    case "tool/call":
      return [{ type: "tool_call", sessionId: ev.sessionId, callId: ev.callId, name: ev.name, arguments: ev.arguments }];
    case "tool/result":
      return [{ type: "tool_result", sessionId: ev.sessionId, callId: ev.callId, ok: ev.ok, output: ev.output }];
    case "session/started":
      return [{ type: "session_opened", sessionId: ev.sessionId, title: ev.title }];
    case "session/stopped":
      return [{ type: "session_closed", sessionId: ev.sessionId }];
    case "agent/status":
      return [{ type: "status_changed", sessionId: ev.sessionId, status: ev.status }];
    case "agent/request": {
      const rxs: ReasonixEvent[] = [{
        type: "approval_request",
        sessionId: ev.sessionId,
        requestId: ev.requestId,
        kind: ev.requestType === "plan" ? "plan" : "tool",
        summary: ev.summary,
        payload: ev.payload,
      }];
      return rxs;
    }
    case "telemetry/cost":
      return [{
        type: "cost_updated",
        sessionId: ev.sessionId,
        turnCostUsd: ev.turnCostUsd,
        sessionCostUsd: ev.sessionCostUsd,
        tier: ev.tier,
        level: costLevel(ev.sessionCostUsd, thresholds),
      }];
    // 内部机制事件：对前端渲染不可见
    case "agent/pre-step":
    case "agent/turn-stopping":
    case "agent/validation":
      return [];
  }
}

/** 双向事件映射器（可注入成本阈值） */
export class EventMapper {
  constructor(private readonly thresholds: CostThresholds = DEFAULT_COST_THRESHOLDS) {}

  reasonixToDsh(ev: ReasonixEvent): DshEvent[] {
    return mapReasonixToDsh(ev);
  }

  dshToReasonix(ev: DshEvent): ReasonixEvent[] {
    return mapDshToReasonix(ev, this.thresholds);
  }
}
