import { JsonRpcClient, RpcTransport } from "./jsonrpc";

/**
 * ACP（Agent Client Protocol）客户端骨架。
 *
 * ACP 是基于 JSON-RPC 2.0 的协议；此处提供 Reasonix 前端最常消费的
 * 会话级方法（initialize / session/new / session/prompt / session/select），
 * 以及宿主可监听的通知。dsh 的 ACP 服务端若字段有差异，仅需在此适配，
 * 不扩散到前端（对应 docs/architecture.md 13.6 前端侧防腐层）。
 */

export interface AcpInitializeResult {
  protocolVersion: string;
  agentVersion: string;
  capabilities: { tools: boolean; permissions: boolean; planning: boolean };
}

export interface AcpSessionPromptParams {
  sessionId: string;
  prompt: string;
  attachments?: Array<{ name?: string; mimeType?: string; content?: string }>;
}

export type AcpNotification =
  | { method: "session/updated"; params: { sessionId: string; update: unknown } }
  | { method: "agent/message"; params: { sessionId: string; message: unknown } }
  | { method: "permission/request"; params: { sessionId: string; requestId: string; summary: string; payload?: unknown } };

export class AcpClient {
  private readonly rpc: JsonRpcClient;

  constructor(transport: RtpTransportAlias) {
    this.rpc = new JsonRpcClient(transport);
  }

  async initialize(): Promise<AcpInitializeResult> {
    return this.rpc.request<AcpInitializeResult>("initialize", { protocolVersion: "2025-03-26" });
  }

  async createSession(params: { cwd?: string; mcpServers?: Array<{ name: string; command: string; args: string[] }> }): Promise<{ sessionId: string }> {
    return this.rpc.request<{ sessionId: string }>("session/new", params);
  }

  async prompt(params: AcpSessionPromptParams): Promise<{ messageId: string }> {
    return this.rpc.request<{ messageId: string }>("session/prompt", params);
  }

  async select(sessionId: string): Promise<{ ok: boolean }> {
    return this.rpc.request<{ ok: boolean }>("session/select", { sessionId });
  }

  async interrupt(sessionId: string): Promise<{ ok: boolean }> {
    return this.rpc.request<{ ok: boolean }>("session/interrupt", { sessionId });
  }
}

/** 兼容别名：ACP 服务端同样基于 RpcTransport，后续可替换为专用传输 */
export type RtpTransportAlias = RpcTransport;
