import { DshEvent } from "../events/dsh";

/**
 * Session 双向导出（方案 8.3 + M5）：
 * dsh SessionEvent 日志 <-> Reasonix 检查点格式，使会话可迁移回原 Go 内核。
 * Reasonix 检查点为本方案定义的互通契约（v1），集成时对齐 Go 侧检查点实现。
 */

export interface ReasonixToolCall {
  id: string;
  name: string;
  args: unknown;
}

export type ReasonixCheckpointMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ReasonixToolCall[] }
  | { role: "tool"; callId: string; output: string };

export interface ReasonixCheckpoint {
  format: "reasonix-checkpoint";
  version: 1;
  sessionId: string;
  title?: string;
  messages: ReasonixCheckpointMessage[];
}

/** dsh SessionEvent -> Reasonix 检查点（降维到对话表面 + 工具调用）。 */
export function exportCheckpoint(events: readonly DshEvent[]): ReasonixCheckpoint {
  const cp: ReasonixCheckpoint = { format: "reasonix-checkpoint", version: 1, sessionId: "", messages: [] };

  let chunkBuffer = "";
  const pendingToolCalls: ReasonixToolCall[] = [];

  const flushAssistant = () => {
    if (chunkBuffer.length === 0 && pendingToolCalls.length === 0) return;
    const msg: ReasonixCheckpointMessage = { role: "assistant", content: chunkBuffer };
    if (pendingToolCalls.length > 0) msg.toolCalls = pendingToolCalls.splice(0);
    cp.messages.push(msg);
    chunkBuffer = "";
  };

  for (const ev of events) {
    switch (ev.kind) {
      case "session/created":
        cp.sessionId = ev.sessionId;
        if (ev.title) cp.title = ev.title;
        break;
      case "user/message":
        flushAssistant();
        cp.messages.push({ role: "user", content: ev.content });
        break;
      case "assistant/chunk":
        chunkBuffer += ev.delta;
        break;
      case "assistant/message":
        if (chunkBuffer.length === 0) chunkBuffer = ev.content;
        break;
      case "tool/call":
        pendingToolCalls.push({ id: ev.callId, name: ev.name, args: ev.arguments });
        break;
      case "tool/result":
        flushAssistant();
        cp.messages.push({ role: "tool", callId: ev.callId, output: ev.output });
        break;
      default:
        break;
    }
  }
  flushAssistant();
  return cp;
}

/** Reasonix 检查点 -> dsh SessionEvent 序列（含会话/回合包装）。 */
export function importCheckpoint(cp: ReasonixCheckpoint): DshEvent[] {
  const events: DshEvent[] = [];
  events.push({ kind: "session/created", sessionId: cp.sessionId, title: cp.title });
  events.push({ kind: "turn/start", sessionId: cp.sessionId, seq: 1 });

  for (const m of cp.messages) {
    switch (m.role) {
      case "user":
        events.push({ kind: "user/message", sessionId: cp.sessionId, seq: events.length + 1, content: m.content });
        break;
      case "assistant":
        events.push({ kind: "assistant/message", sessionId: cp.sessionId, content: m.content });
        for (const tc of m.toolCalls ?? []) {
          events.push({ kind: "tool/call", sessionId: cp.sessionId, callId: tc.id, name: tc.name, arguments: tc.args });
        }
        break;
      case "tool":
        events.push({ kind: "tool/result", sessionId: cp.sessionId, callId: m.callId, ok: true, output: m.output });
        break;
    }
  }

  events.push({ kind: "turn/end", sessionId: cp.sessionId, seq: events.length + 1, reason: "completed" });
  return events;
}
