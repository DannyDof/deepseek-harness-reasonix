/**
 * 本地类型镜像：@deepseek-ai/* 真实 API 的抽象（仅供 M2 独立编译）。
 *
 * 字段名与载荷来自对 dsh master 源码的接缝调研（docs/architecture.md 表 12-2）。
 * 集成构建（M3）时以真实包导入替换本文件，并以此文件作为契约测试基准：
 * 任何字段/时序漂移都应在此登记。
 */

/** Cordis 服务键：llm / sessions / systemPrompt / agentLoop / agents */
export interface ContextLike {
  llm: LlmRuntimeLike;
  sessions: SessionStoreLike;
  systemPrompt: SystemPromptLike;
  agentLoop: unknown;
  agents: unknown;
  compaction?: CompactionLike;
  on(event: string, handler: (...args: unknown[]) => unknown): void;
  plugin(plugin: unknown, config?: unknown): void;
}

export type SessionId = string & { readonly __brand: "SessionId" };
export type CallId = string & { readonly __brand: "CallId" };

// ===== system-prompt 接缝 =====
export interface PromptSection {
  readonly name: string;
  readonly order: number;
  readonly text: string | ((context: unknown) => string);
  readonly complete?: boolean;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface PromptAssembly {
  sections: Array<{ name: string; order: number; text: string }>;
  contexts: unknown[];
  tools: ToolSchema[];
  variables: Record<string, string | undefined>;
}

export interface SystemPromptLike {
  section(section: PromptSection): () => void;
  assemble(context?: unknown): Promise<PromptAssembly>;
}

// ===== session 接缝 =====
export type SessionEventType =
  | "turn/start"
  | "turn/end"
  | "step/start"
  | "step/end"
  | "user/message"
  | "assistant/chunk"
  | "assistant/message"
  | "tool/call"
  | "tool/result"
  | "request/header"
  | "request/context"
  | "todo/write"
  | "session/end-seed";

export interface SessionEvent {
  type: SessionEventType;
  seq: number;
  time: number;
  data: Record<string, unknown>;
}

export interface SessionLike {
  id: SessionId;
  append(type: SessionEventType, data: Record<string, unknown>): void;
}

export interface SessionStoreLike {
  get(id: SessionId): SessionLike | undefined;
}

// ===== llm 接缝 =====
export type ContentBlockType = "text" | "reasoning" | "tool-call" | "tool-result" | "image";

export interface ContentBlock {
  type: ContentBlockType;
  text?: string;
  id?: CallId;
  name?: string;
  arguments?: string;
  toolCallId?: CallId;
}

export interface Message {
  id: string;
  role: "system" | "user" | "assistant";
  content: ContentBlock[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export type FinishReason =
  | "stop"
  | "tool-calls"
  | "max-tokens"
  | { kind: "aborted" | "error"; failure: { code: string; message: string } };

export type StreamChunk =
  | { type: "block-start"; index: number; blockType: ContentBlockType }
  | { type: "text-delta"; index: number; text: string }
  | { type: "reasoning-delta"; index: number; text: string }
  | { type: "tool-call-delta"; index: number; id: CallId; name?: string; argumentsDelta: string }
  | { type: "block-end"; index: number; block: ContentBlock }
  | { type: "usage"; usage: TokenUsage }
  | { type: "finish"; reason: FinishReason; replayState?: unknown };

export interface GenerateOptions {
  provider: string;
  model: string;
  reasoningEffort?: string;
  messages: Message[];
  system?: string;
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  signal?: AbortSignal;
  sessionId?: SessionId;
  purpose?: "compaction" | "session-title";
}

export interface LlmCallConfig {
  provider: string;
  model: string;
  reasoningEffort?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

export interface LlmRuntimeLike {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
  prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<{ stream(options: GenerateOptions): AsyncIterable<StreamChunk> }>;
}

// ===== agent 接缝 =====
export type PreStepDecision = { kind: "reject" } | { kind: "enter"; messages: Message[] };

export interface AgentPreStepPayload {
  agent: unknown;
  messages: Message[];
  turn: number;
  step: number;
  signal: AbortSignal;
}

// ===== 压缩接缝（base bundle 挂载 compaction-basic） =====
export interface CompactionLike {
  request(sessionId: SessionId, reason: string): Promise<void>;
}
