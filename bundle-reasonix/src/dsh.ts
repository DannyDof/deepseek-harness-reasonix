/**
 * 本地类型镜像：@deepseek-ai/* 真实 API 的抽象（仅供 M2 独立编译）。
 *
 * 字段名与载荷来自对 dsh master 源码的接缝调研（docs/architecture.md 表 12-2）。
 * 集成构建（M3）时以真实包导入替换本文件，并以此文件作为契约测试基准：
 * 任何字段/时序漂移都应在此登记。
 */

/** Cordis 服务键：llm / sessions / systemPrompt / agentLoop / agents / tools / subagents */
export interface ContextLike {
  llm: LlmRuntimeLike;
  sessions: SessionStoreLike;
  systemPrompt: SystemPromptLike;
  agentLoop: unknown;
  agents: unknown;
  tools: ToolRuntimeLike;
  subagents: SubagentRuntimeLike;
  planMode?: unknown;
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
  readonly text: string | ((context: any) => string);
  readonly complete?: boolean;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** 已装配段（对齐 @deepseek-ai/dsh-system-prompt 的 AssembledSection：仅 name+text，无 order） */
export interface AssembledSection {
  name: string;
  text: string;
}

export interface PromptAssembly {
  sections: AssembledSection[];
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

/** 文本块 */
export interface TextBlock {
  type: "text";
  text: string;
}
/** 推理/思考内容块 */
export interface ReasoningBlock {
  type: "reasoning";
  text: string;
}
/** 图像块（attachment 引用，本镜像以 unknown 占位） */
export interface ImageBlock {
  type: "image";
  attachment: unknown;
}
/** 模型发起的工具调用块 */
export interface ToolCallBlock {
  type: "tool-call";
  id: CallId;
  name: string;
  arguments: string;
}
/** 工具调用结果块 */
export interface ToolResultBlock {
  type: "tool-result";
  toolCallId: CallId;
  content: ContentBlock[];
  isError?: boolean;
}

/** 内容块可辨识联合（对齐 @deepseek-ai/dsh-llm 的 ContentBlockMap） */
export type ContentBlock = TextBlock | ReasoningBlock | ImageBlock | ToolCallBlock | ToolResultBlock;

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

export interface LlmFailure {
  code: string;
  message: string;
}

/** 结束原因可辨识联合（对齐 @deepseek-ai/dsh-llm 的 FinishReasonMap） */
export type FinishReason =
  | { kind: "stop" }
  | { kind: "tool-calls" }
  | { kind: "max-tokens" }
  | { kind: "aborted"; failure: LlmFailure }
  | { kind: "error"; failure: LlmFailure };

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

// ===== 工具接缝（修复管线） =====
export interface ToolDefinitionLike {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolExecutionInput {
  callId: CallId;
  rootCallId?: CallId;
  name: string;
  arguments: unknown;
  agent?: unknown;
  parent?: unknown;
  signal: AbortSignal;
}

export interface ToolExecution extends ToolExecutionInput {
  rootCallId: CallId;
  token: unknown;
}

export interface ToolExecutionSuccess {
  isError: false;
  value: unknown;
  content: ContentBlock[];
  meta?: unknown;
  additionalContexts?: unknown[];
  concludesTurn?: true;
}

export interface ToolExecutionFailure {
  isError: true;
  error: { message: string; info?: { name: string; code: string } };
  content: ContentBlock[];
  meta?: unknown;
  additionalContexts?: unknown[];
}

export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure;

export type PreToolDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "ask"; reason?: string };

export type PostToolDecision =
  | { kind: "accept"; content?: ContentBlock[]; value?: never; additionalContexts?: unknown[] }
  | { kind: "accept"; value: unknown; content?: never; additionalContexts?: unknown[] }
  | { kind: "block"; feedback: ContentBlock[]; additionalContexts?: unknown[] };

export interface ToolRuntimeLike {
  register?(definition: ToolDefinitionLike): () => void;
  execute(input: ToolExecutionInput): Promise<ToolExecutionResult>;
  get(name: string): ToolDefinitionLike | undefined;
}

// ===== 子 Agent 接缝（Coordinator） =====
export interface ModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface SubagentStartRequest {
  label?: string;
  prompt: ContentBlock[];
  parent: unknown;
  signal: AbortSignal;
  agentOptions?: { provider?: string; model?: string };
  outputSchema?: Record<string, unknown>;
  maxDepth?: number;
  persona?: string;
  toolFilter?: unknown;
}

export interface SubagentResult {
  output: ContentBlock[];
  structured?: unknown;
  stopReason: "completed" | "aborted" | "error" | "max-tokens" | "refusal";
}

export interface SubagentRun {
  id: SessionId;
  result: Promise<SubagentResult>;
  dispose(): Promise<void>;
}

export interface SubagentRuntimeLike {
  start(name: string, request: SubagentStartRequest): Promise<SubagentRun>;
  startContinuable?(spec: unknown): Promise<unknown>;
  followup?(parent: unknown, childId: SessionId, content: ContentBlock[], options?: unknown): Promise<unknown>;
}
