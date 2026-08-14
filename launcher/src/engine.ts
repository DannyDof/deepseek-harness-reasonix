import { Bridge } from "reasonix-bridge";
import type { ReasonixEvent } from "reasonix-bridge";
import { MemoryCostMeter, costLevelOf, prefixFingerprint } from "@reasonix/dsh-bundle-reasonix";

/**
 * 融合引擎：把 Reasonix 前端输入经桥接层 + dsh bundle 处理为可渲染事件流。
 * 本演示以"模拟 LLM 输出 + 缓存命中 usage"驱动管线；接入真实 dsh 后替换为
 * Sidecar 调用（见 bridge/src/sidecar.ts）。
 */

export interface TurnResult {
  events: ReasonixEvent[];
  costLevel: "green" | "amber" | "red";
  prefixStable: boolean;
}

const meter = new MemoryCostMeter();

/** 运行一轮会话：frontend(user_message) -> bridge -> dsh 事件 -> 投影回前端。 */
export function runTurn(sessionId: string, prompt: string): TurnResult {
  const bridge = new Bridge();
  const events: ReasonixEvent[] = [];
  bridge.onReasonix((ev) => events.push(ev));

  // 1) 前端用户消息 -> 上送 dsh
  bridge.emitReasonix({ type: "user_message", sessionId, content: prompt });

  // 2) 模拟 dsh 引擎：assistant 流式 + 完成 + 成本 usage（含缓存命中）
  for (const delta of ["好的", "，", "已完成", "。", ""]) {
    if (delta) bridge.emitDsh({ kind: "assistant/chunk", sessionId, delta });
  }
  bridge.emitDsh({ kind: "assistant/message", sessionId, content: "好的，已完成。", model: "deepseek-v4-flash" });

  // 前缀缓存命中：15000 缓存 + 5000 增量，输出 4000
  bridge.emitDsh({
    kind: "llm/usage",
    sessionId,
    provider: "deepseek-official",
    model: "deepseek-v4-flash",
    inputTokens: 5000,
    cacheReadTokens: 15000,
    outputTokens: 4000,
  });

  // 3) bundle 侧：计量 + 前缀指纹（缓存优先）
  meter.record(sessionId, { inputTokens: 5000, cacheReadTokens: 15000, outputTokens: 4000 }, "flash");
  const sessionCost = meter.snapshot(sessionId).sessionCostUsd;
  const costLevel = costLevelOf(sessionCost, { greenSessionUsd: 0.05, amberSessionUsd: 0.12 });

  const assembly = {
    sections: [
      { name: "reasonix:cache-prefix", order: 50, text: "cacheable prefix" },
      { name: "deployment:persona", order: 0, text: "persona" },
    ],
    contexts: [],
    tools: [],
    variables: {},
  };
  const fp = prefixFingerprint(assembly);
  const prefixStable = fp === prefixFingerprint(assembly);

  return { events, costLevel, prefixStable };
}
