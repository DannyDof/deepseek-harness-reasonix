import type { ContextLike, GenerateOptions, StreamChunk, TokenUsage } from "../dsh";
import type { CostMeterPort, CostSnapshot, TokenMeter } from "../ports";

/**
 * 分级成本管控插件（方案 4.2.3），对齐真实接缝：llm/stream 瀑布。
 * 在 usage 分片到达时计量，并按会话成本分级（绿/黄/红）。
 */

export interface CostTierThresholds {
  greenSessionUsd: number;
  amberSessionUsd: number;
}

export type CostLevel = "green" | "amber" | "red";

/** Reasonix 参考定价（每百万 token 美元；可经配置覆盖） */
export interface Pricing {
  flash: { inputUsd: number; outputUsd: number };
  pro: { inputUsd: number; outputUsd: number };
  /** 缓存命中输入按比例计费 */
  cacheReadFactor: number;
}

export const DEFAULT_PRICING: Pricing = {
  flash: { inputUsd: 0.1, outputUsd: 0.4 },
  pro: { inputUsd: 2.0, outputUsd: 8.0 },
  cacheReadFactor: 0.1,
};

/** 会话累计器：累计输入/输出 token 与最近一次 usage（turn 维度简化处理） */
export class SessionCostAccumulator {
  private input = 0;
  private output = 0;
  private cacheRead = 0;
  private lastTurnInput = 0;
  private lastTurnOutput = 0;
  private lastTier: "flash" | "pro" = "flash";
  private silentUpgrades = 0;

  constructor(private readonly pricing: Pricing) {}

  record(usage: TokenMeter, tier: "flash" | "pro"): void {
    this.input += usage.inputTokens;
    this.output += usage.outputTokens;
    this.cacheRead += usage.cacheReadTokens ?? 0;
    if (this.lastTier === "flash" && tier === "pro") this.silentUpgrades++;
    this.lastTier = tier;
    this.lastTurnInput = usage.inputTokens;
    this.lastTurnOutput = usage.outputTokens;
  }

  private usd(input: number, output: number, tier: "flash" | "pro"): number {
    const p = tier === "flash" ? this.pricing.flash : this.pricing.pro;
    return (input * p.inputUsd + output * p.outputUsd) / 1_000_000;
  }

  snapshot(): CostSnapshot {
    const sessionInput = this.input + this.cacheRead * this.pricing.cacheReadFactor;
    return {
      turnCostUsd: this.usd(this.lastTurnInput, this.lastTurnOutput, this.lastTier),
      sessionCostUsd: this.usd(sessionInput, this.output, this.lastTier),
      tier: this.lastTier,
    };
  }

  silentUpgradeCount(): number {
    return this.silentUpgrades;
  }
}

/** 内存 CostMeterPort 实现 */
export class MemoryCostMeter implements CostMeterPort {
  private readonly sessions = new Map<string, SessionCostAccumulator>();

  constructor(private readonly pricing: Pricing = DEFAULT_PRICING) {}

  record(sessionId: string, usage: TokenMeter, tier: "flash" | "pro"): void {
    this.accumulator(sessionId).record(usage, tier);
  }

  snapshot(sessionId: string): CostSnapshot {
    return this.accumulator(sessionId).snapshot();
  }

  didSilentUpgrade(sessionId: string): boolean {
    return this.accumulator(sessionId).silentUpgradeCount() > 0;
  }

  private accumulator(sessionId: string): SessionCostAccumulator {
    let acc = this.sessions.get(sessionId);
    if (!acc) {
      acc = new SessionCostAccumulator(this.pricing);
      this.sessions.set(sessionId, acc);
    }
    return acc;
  }
}

export function costLevelOf(sessionCostUsd: number, t: CostTierThresholds): CostLevel {
  if (sessionCostUsd < t.greenSessionUsd) return "green";
  if (sessionCostUsd < t.amberSessionUsd) return "amber";
  return "red";
}

export function tierOfModel(model: string): "flash" | "pro" {
  return /pro/i.test(model) ? "pro" : "flash";
}

/** 在 dsh ctx 上挂载 llm/stream 计量（M3 集成调用）。返回卸载函数。 */
export function installCostMeter(
  ctx: ContextLike,
  meter: CostMeterPort,
): () => void {
  const onLlmStream = (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> => {
    return (async function* meterStream() {
      const source = next();
      for await (const chunk of source) {
        if (chunk.type === "usage") {
          const sid = options.sessionId;
          if (sid) {
            const u = chunk.usage as TokenUsage;
            meter.record(String(sid), { inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens }, tierOfModel(options.model));
          }
        }
        yield chunk;
      }
    })();
  };
  ctx.on("llm/stream", onLlmStream as (...args: unknown[]) => unknown);
  return () => void 0;
}

export interface CostPlugin {
  meter: CostMeterPort;
  levelOf(sessionId: string, thresholds?: CostTierThresholds): CostLevel;
  install(ctx: ContextLike): () => void;
}

export function createCostPlugin(thresholds: CostTierThresholds = { greenSessionUsd: 0.05, amberSessionUsd: 0.12 }): CostPlugin {
  const meter = new MemoryCostMeter();
  return {
    meter,
    levelOf(sessionId: string, t: CostTierThresholds = thresholds): CostLevel {
      return costLevelOf(meter.snapshot(sessionId).sessionCostUsd, t);
    },
    install(ctx: ContextLike): () => void {
      return installCostMeter(ctx, meter);
    },
  };
}
