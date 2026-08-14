/**
 * 极简 JSON-RPC 2.0 实现（无依赖）。
 *
 * 用于桥接层与 dsh Sidecar 之间的协议承载（ACP 基于 JSON-RPC 2.0）。
 * Transport 抽象允许后续接入 stdio / WebSocket / HTTP 等具体通道。
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: number | string | null;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcSuccess | JsonRpcError;

export interface RpcTransport {
  send(message: JsonRpcMessage): void;
  onMessage(listener: (message: JsonRpcMessage) => void): void;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export interface NotifyHandler {
  (params: unknown): Promise<void> | void;
}

/**
 * JSON-RPC 2.0 服务端：接收请求、按方法表派发、回写响应与通知。
 */
type MethodHandler = (params: unknown) => Promise<unknown> | unknown;

export class JsonRpcServer {
  private readonly methods = new Map<string, MethodHandler>();
  private readonly notifications = new Map<string, NotifyHandler>();

  constructor(private readonly transport: RpcTransport) {
    this.transport.onMessage((msg) => {
      void this.handleMessage(msg);
    });
  }

  registerMethod(method: string, handler: MethodHandler): void {
    this.methods.set(method, handler);
  }

  registerNotification(method: string, handler: NotifyHandler): void {
    this.notifications.set(method, handler);
  }

  private async handleMessage(msg: JsonRpcMessage): Promise<void> {
    if (typeof msg !== "object" || msg === null || (msg as JsonRpcRequest).jsonrpc !== "2.0") {
      this.transport.send({ jsonrpc: "2.0", id: null, error: { code: INVALID_REQUEST, message: "invalid request" } });
      return;
    }
    const request = msg as JsonRpcRequest;
    if (typeof request.method !== "string") {
      this.transport.send({ jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "method required" } });
      return;
    }
    const isNotification = request.id === null || request.id === undefined;

    try {
      if (isNotification) {
        const handler = this.notifications.get(request.method);
        if (handler) await handler(request.params);
        return;
      }
      const handler = this.methods.get(request.method);
      if (!handler) {
        this.transport.send({
          jsonrpc: "2.0", id: request.id,
          error: { code: METHOD_NOT_FOUND, message: `method not found: ${request.method}` },
        });
        return;
      }
      const result = await handler(request.params);
      this.transport.send({ jsonrpc: "2.0", id: request.id, result });
    } catch (err) {
      this.transport.send({
        jsonrpc: "2.0", id: request.id,
        error: { code: INTERNAL_ERROR, message: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}

/**
 * JSON-RPC 2.0 客户端：维护递增 id、等待响应、支持通知。
 */
export class JsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, (msg: JsonRpcSuccess | JsonRpcError) => void>();

  constructor(private readonly transport: RpcTransport) {
    this.transport.onMessage((msg) => {
      if (!("id" in msg) || msg.id === null) return;
      const resolve = this.pending.get(msg.id as number);
      if (resolve) {
        this.pending.delete(msg.id as number);
        resolve(msg as JsonRpcSuccess | JsonRpcError);
      }
    });
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, (msg) => {
        if ("error" in msg) reject(new Error(msg.error.message));
        else resolve(msg.result as T);
      });
      this.transport.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.transport.send({ jsonrpc: "2.0", id: null, method, params });
  }
}

export { PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR };
