import { CostMeterPort } from "../ports";

/** 成本分级阈值（与桥接层 DEFAULT_COST_THRESHOLDS 对齐） */
export interface CostTierThresholds {
  greenSessionUsd: number;
  amberSessionUsd: number;
}

/** 分级成本管控插件（4.2.3）。挂载点：telemetry/* 接缝。 */
export function createCostPlugin(
  meter: CostMeterPort,
  thresholds: CostTierThresholds = { greenSessionUsd: 0.05, amberSessionUsd: 0.12 },
) {
  return {
    onTelemetry(sessionId: string, inputTokens: number, outputTokens: number, tier: "flash" | "pro") {
      meter.record(sessionId, inputTokens, outputTokens, tier);
      const snap = meter.snapshot(sessionId);
      let level: "green" | "amber" | "red";
      if (snap.sessionCostUsd < thresholds.greenSessionUsd) level = "green";
      else if (snap.sessionCostUsd < thresholds.amberSessionUsd) level = "amber";
      else level = "red";
      return {
        ...snap,
        level,
        silentUpgrade: meter.didSilentUpgrade(sessionId),
      };
    },
  };
}
