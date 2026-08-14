import { runTurn } from "./engine";
import type { ReasonixEvent } from "reasonix-bridge";

/**
 * ACP/JSON-RPC 方法处理（融合应用对外接口）。
 * 方法：initialize / session/new / session/prompt。
 */

export interface RpcErrorShape {
  code: number;
  message: string;
}

export interface SessionRecord {
  sessionId: string;
  events: ReasonixEvent[];
}

export class RpcHandler {
  private seq = 1;
  private readonly sessions = new Map<string, SessionRecord>();

  initialize(): unknown {
    return {
      protocolVersion: "2025-03-26",
      agentVersion: "reasonix-fused-0.1.0",
      capabilities: { tools: true, permissions: true, planning: true },
    };
  }

  sessionNew(): unknown {
    const sessionId = `s${this.seq++}`;
    this.sessions.set(sessionId, { sessionId, events: [] });
    return { sessionId };
  }

  sessionPrompt(params: { sessionId?: string; prompt: string }): unknown {
    const sessionId = params.sessionId ?? `s${this.seq++}`;
    const rec = this.sessions.get(sessionId) ?? { sessionId, events: [] };
    this.sessions.set(sessionId, rec);

    const turn = runTurn(sessionId, params.prompt);
    rec.events.push(...turn.events);

    return {
      messageId: `m${this.seq++}`,
      sessionId,
      costLevel: turn.costLevel,
      prefixStable: turn.prefixStable,
      events: turn.events,
    };
  }

  dispatch(method: string, params: unknown): unknown {
    switch (method) {
      case "initialize":
        return this.initialize();
      case "session/new":
        return this.sessionNew();
      case "session/prompt":
        return this.sessionPrompt(params as { sessionId?: string; prompt: string });
      default:
        throw new RpcError(-32601, `method not found: ${method}`);
    }
  }
}

export class RpcError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = "RpcError";
  }
}
