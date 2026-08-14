/**
 * DeepSeek 模型适配层（方案 4.3 + 配置映射 6.1）。
 *
 * dsh 官方已提供 @deepseek-ai/dsh-llm-deepseek 适配器（provider: deepseek-official，
 * 模型 deepseek-v4-flash / deepseek-v4-pro）。本模块只负责"Reasonix 侧配置 ->
 * 官方适配器 Config"的映射，并对齐第三方兼容端点的路径补全（issue #8836/#8781 回归项）。
 */

export type ReasonixModelTier = "flash" | "pro";

/** reasonix.toml provider 段（本方案消费子集） */
export interface ReasonixLlmConfig {
  default_model?: ReasonixModelTier;
  apiKeyEnv?: string;
  baseURL?: string;
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "off" | "high" | "max";
  maxTokens?: number;
  defaultContextWindow?: number;
}

/** dsh 官方适配器 Config（@deepseek-ai/dsh-llm-deepseek） */
export interface DeepSeekAdapterConfig {
  apiKeyEnv?: string;
  baseURL?: string;
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "off" | "high" | "max";
  maxTokens?: number;
  defaultContextWindow?: number;
  models?: DeepSeekCatalogModel[];
  streamIdleTimeoutMs?: number;
}

/** 官方模型目录条目 */
export interface DeepSeekCatalogModel {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  maxTokens?: number;
}

export const DEEPSEEK_PROVIDER = "deepseek-official";
export const DEEPSEEK_MODELS: Record<ReasonixModelTier, string> = {
  flash: "deepseek-v4-flash",
  pro: "deepseek-v4-pro",
};

export const DEFAULT_DEEPSEEK_CATALOG: DeepSeekCatalogModel[] = [
  { id: DEEPSEEK_MODELS.flash, name: "DeepSeek-V4-Flash", contextWindow: 1_000_000, maxTokens: 256_000 },
  { id: DEEPSEEK_MODELS.pro, name: "DeepSeek-V4-Pro", contextWindow: 1_000_000, maxTokens: 256_000 },
];

/** 模型档位选择（flash-first 默认，pro 显式可见） */
export interface ReasonixModelSelection {
  provider: string;
  model: string;
  reasoningEffort: "off" | "high" | "max";
}

export function defaultModelSelection(defaultModel: ReasonixModelTier = "flash"): ReasonixModelSelection {
  return {
    provider: DEEPSEEK_PROVIDER,
    model: DEEPSEEK_MODELS[defaultModel],
    reasoningEffort: "high",
  };
}

/** 第三方兼容端点路径补全：确保 baseURL 以 /v1 结尾可拼接 /chat/completions（issue #8781） */
export function normalizeBaseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.replace(/\/+$/, "");
  if (/\/v\d+$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

/** reasonix.toml -> dsh 官方 DeepSeek 适配器 Config */
export function resolveDeepSeekAdapterConfig(cfg: ReasonixLlmConfig): DeepSeekAdapterConfig {
  const out: DeepSeekAdapterConfig = {
    apiKeyEnv: cfg.apiKeyEnv ?? "DEEPSEEK_API_KEY",
    thinking: cfg.thinking ?? "enabled",
    reasoningEffort: cfg.reasoningEffort ?? "high",
    maxTokens: cfg.maxTokens ?? 256_000,
    defaultContextWindow: cfg.defaultContextWindow ?? 1_000_000,
    models: DEFAULT_DEEPSEEK_CATALOG,
  };
  if (cfg.baseURL) out.baseURL = normalizeBaseUrl(cfg.baseURL);
  return out;
}
