import type {
  ContextLike,
  ContentBlock,
  PreToolDecision,
  PostToolDecision,
  ToolExecution,
  ToolExecutionInput,
  ToolExecutionResult,
} from "../dsh";

/**
 * 工具调用修复管线（方案 4.2.2），对齐真实 tools/* 接缝：
 * - scavenge：tools/result 观测，采集 INVALID_ARGS 类失败；
 * - flatten：tools/execute 包裹，对畸形参数做一次受控修复重派发；
 * - truncation：tools/post-execute 截断超预算结果内容（参考 dsh-compaction-tool-result-pruner）；
 * - storm：tools/pre-execute 滑动窗口去重，抑制重复 (name, args)。
 * M2 独立类型编译；M3 集成经 install() 挂到真实 ctx。
 */

export interface RepairConfig {
  enabled?: boolean;
  flatten?: { maxAttempts?: number };
  truncation?: { thresholdChars?: number; headChars?: number; tailChars?: number; enabled?: boolean };
  storm?: { window?: number; maxRepeats?: number };
}

export interface TruncationConfig {
  thresholdChars: number;
  headChars: number;
  tailChars: number;
  enabled: boolean;
}

export interface StormConfig {
  window: number;
  maxRepeats: number;
}

interface ResolvedRepairConfig {
  enabled: boolean;
  flatten: { maxAttempts: number };
  truncation: TruncationConfig;
  storm: StormConfig;
}

export const DEFAULT_REPAIR_CONFIG: RepairConfig = {
  enabled: true,
  flatten: { maxAttempts: 1 },
  truncation: { thresholdChars: 8192, headChars: 4096, tailChars: 1024, enabled: false },
  storm: { window: 8, maxRepeats: 2 },
};

export const TRUNCATE_MARKER = "\n\n[... tool result middle pruned ...]\n\n";

function resolveConfig(config: RepairConfig): ResolvedRepairConfig {
  return {
    enabled: config.enabled ?? true,
    flatten: { maxAttempts: config.flatten?.maxAttempts ?? 1 },
    truncation: {
      thresholdChars: config.truncation?.thresholdChars ?? 8192,
      headChars: config.truncation?.headChars ?? 4096,
      tailChars: config.truncation?.tailChars ?? 1024,
      enabled: config.truncation?.enabled ?? false,
    },
    storm: {
      window: config.storm?.window ?? 8,
      maxRepeats: config.storm?.maxRepeats ?? 2,
    },
  };
}

/** 观测到的失败（scavenge 采集） */
export interface ScavengedFailure {
  callId: string;
  name: string;
  code: string;
  message: string;
}

/** flatten：解析字符串化 JSON、解包单元素数组、去除 null/undefined */
export function flattenArguments(args: unknown): { changed: boolean; value: unknown } {
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return { changed: true, value: JSON.parse(trimmed) };
      } catch {
        return { changed: false, value: args };
      }
    }
    return { changed: false, value: args };
  }
  if (Array.isArray(args) && args.length === 1) {
    return { changed: true, value: args[0] };
  }
  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    const keys = Object.keys(record);
    for (const k of keys) {
      if (record[k] === null || record[k] === undefined) delete record[k];
    }
    return { changed: keys.length !== Object.keys(record).length, value: record };
  }
  return { changed: false, value: args };
}

/** truncation：文本块按 code point 做 head+marker+tail 截断，非文本块保序 */
export function truncateContent(content: ContentBlock[], cfg: TruncationConfig): ContentBlock[] {
  if (!cfg.enabled) return content;
  const texts: string[] = [];
  for (const b of content) if (b.type === "text" && b.text) texts.push(b.text);
  const total = texts.reduce((n, t) => n + Array.from(t).length, 0);
  if (total <= cfg.thresholdChars) return content;

  const chars = Array.from(texts.join(""));
  const pruned = chars.slice(0, cfg.headChars).join("") + TRUNCATE_MARKER + chars.slice(-cfg.tailChars).join("");

  const out: ContentBlock[] = [];
  let inserted = false;
  for (const b of content) {
    if (b.type === "text") {
      if (!inserted) {
        out.push({ type: "text", text: pruned });
        inserted = true;
      }
    } else {
      out.push(b);
    }
  }
  return out;
}

export interface RepairPipeline {
  /** 观测到的失败序列（scavenge 采集） */
  failures(): readonly ScavengedFailure[];
  /** 在 dsh ctx 上挂载（M3 集成调用）。返回卸载函数。 */
  install(ctx: ContextLike): () => void;
}

export function createRepairPipeline(config: RepairConfig = {}): RepairPipeline {
  const cfg = resolveConfig(config);
  const scavenged: ScavengedFailure[] = [];
  const window: Array<{ callId: string; key: string }> = [];
  const repaired = new Set<string>();

  return {
    failures: () => scavenged,

    install(ctx: ContextLike): () => void {
      if (!cfg.enabled) return () => void 0;

      // storm：pre-execute 滑动窗口去重
      const onPreExecute = async (
        exec: ToolExecution,
        next: () => Promise<PreToolDecision>,
      ): Promise<PreToolDecision> => {
        const decision = await next();
        if (decision.kind !== "allow") return decision;
        const key = `${exec.name}:${JSON.stringify(exec.arguments)}`;
        const repeats = window.filter((w) => w.key === key);
        if (repeats.length >= cfg.storm.maxRepeats) {
          return { kind: "deny", reason: `storm: repeated call suppressed (${exec.name})` };
        }
        window.push({ callId: String(exec.callId), key });
        if (window.length > cfg.storm.window) window.shift();
        return decision;
      };
      ctx.on("tools/pre-execute", onPreExecute as (...args: unknown[]) => unknown);

      // flatten：execute 包裹，受控修复重派发
      const onExecute = async (
        exec: ToolExecution,
        next: () => Promise<ToolExecutionResult>,
      ): Promise<ToolExecutionResult> => {
        const result = await next();
        if (!result.isError || result.error.info?.code !== "INVALID_ARGS") return result;
        if (repaired.has(String(exec.callId))) return result;
        const { changed, value } = flattenArguments(exec.arguments);
        if (!changed) return result;
        repaired.add(String(exec.callId));
        const retry: ToolExecutionInput = {
          callId: exec.callId,
          rootCallId: exec.rootCallId,
          name: exec.name,
          arguments: value,
          agent: exec.agent,
          signal: exec.signal,
        };
        return ctx.tools.execute(retry);
      };
      ctx.on("tools/execute", onExecute as (...args: unknown[]) => unknown);

      // truncation：post-execute 截断超预算内容
      const onPostExecute = async (
        _exec: ToolExecution,
        result: Readonly<ToolExecutionResult>,
        next: () => Promise<PostToolDecision>,
      ): Promise<PostToolDecision> => {
        const decision = await next();
        if (!cfg.truncation.enabled || decision.kind !== "accept" || decision.value !== undefined) {
          return decision;
        }
        const content = decision.content ?? result.content;
        return { kind: "accept", content: truncateContent(content, cfg.truncation) };
      };
      ctx.on("tools/post-execute", onPostExecute as (...args: unknown[]) => unknown);

      // scavenge：result 观测失败
      const onResult = (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): void => {
        if (result.isError) {
          scavenged.push({
            callId: String(exec.callId),
            name: exec.name,
            code: result.error.info?.code ?? "TOOL_ERROR",
            message: result.error.message,
          });
        }
      };
      ctx.on("tools/result", onResult as (...args: unknown[]) => unknown);

      return () => void 0;
    },
  };
}
