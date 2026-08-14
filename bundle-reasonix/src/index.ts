/**
 * @reasonix/dsh-bundle-reasonix 入口。
 *
 * 按 dsh 官方 bundle 惯例（manifest dsh.bundle.patch + cordis.patch.yml）组织：
 * - cordis.patch.yml 覆盖 dsh-base 行并插入本 bundle 插件行；
 * - 本入口提供组合安装 installBundle(ctx, config)：挂载缓存优先与成本插件。
 * M3 集成时以真实 @deepseek-ai/* 类型替换 src/dsh.ts 镜像。
 */
import type { ContextLike } from "./dsh";
import { createCacheFirstPlugin, CacheFirstOptions, CacheStateStore } from "./plugins/cache-first";
import { createCostPlugin, CostTierThresholds } from "./plugins/cost";

export * from "./ports";
export * from "./llm/deepseek";
export { createCacheFirstPlugin, prefixFingerprint, DEFAULT_CACHE_FIRST_OPTIONS } from "./plugins/cache-first";
export type { CacheFirstOptions, CacheStateStore, CacheDriftHandler } from "./plugins/cache-first";
export { createCostPlugin, MemoryCostMeter, SessionCostAccumulator, costLevelOf, tierOfModel, installCostMeter, DEFAULT_PRICING } from "./plugins/cost";
export type { CostPlugin, CostTierThresholds, CostLevel, Pricing } from "./plugins/cost";
export { createCoordinatorConfig, createCoordinatorPlugin } from "./plugins/coordinator";

/** Reasonix bundle 组合配置 */
export interface ReasonixBundleConfig {
  cacheFirst?: CacheFirstOptions;
  cost?: CostTierThresholds;
  /** 前缀状态存储（缺省用内存实现） */
  prefixStore?: CacheStateStore;
}

/** 内存前缀状态存储 */
export class MemoryPrefixStore implements CacheStateStore {
  private readonly map = new Map<string, string>();
  getPrefix(key: string): string | undefined {
    return this.map.get(key);
  }
  setPrefix(key: string, fingerprint: string): void {
    this.map.set(key, fingerprint);
  }
}

/**
 * 在 dsh ctx 上安装 Reasonix bundle（M3 集成）。返回卸载函数。
 * 对应 cordis.patch.yml 中 reasonix-cache-first / reasonix-cost 两行插件的代码侧。
 */
export function installBundle(ctx: ContextLike, config: ReasonixBundleConfig = {}): () => void {
  const disposers: Array<() => void> = [];

  const cacheFirst = createCacheFirstPlugin(config.cacheFirst ?? {});
  disposers.push(cacheFirst.register(ctx, config.prefixStore ?? new MemoryPrefixStore()));

  const cost = createCostPlugin(config.cost ?? { greenSessionUsd: 0.05, amberSessionUsd: 0.12 });
  disposers.push(cost.install(ctx));

  return () => {
    for (const dispose of disposers) dispose();
  };
}

/**
 * bundle 消费的 dsh 接缝清单（docs/architecture.md 表 12-2）。
 * 用于契约测试与升级影响面评估：任何字段/时序变动都应在此登记。
 */
export interface DshSeamConsumed {
  ctxAgentLoop: boolean;
  ctxAgents: boolean;
  ctxTools: boolean;
  ctxLlm: boolean;
  sessionEvent: boolean;
  agentEvents: boolean;
  systemPromptSegments: boolean;
  telemetrySeam: boolean;
}

export const DEFAULT_SEAM_CONSUMED: DshSeamConsumed = {
  ctxAgentLoop: true,
  ctxAgents: true,
  ctxTools: true,
  ctxLlm: true,
  sessionEvent: true,
  agentEvents: true,
  systemPromptSegments: true,
  telemetrySeam: true,
};
