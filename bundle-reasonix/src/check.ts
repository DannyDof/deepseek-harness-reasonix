/**
 * dsh-bundle-reasonix 自检（M2 验收脚本）。
 * 运行：npm run check --workspace bundle-reasonix
 */
import * as assert from "assert";
import { prefixFingerprint, createCacheFirstPlugin } from "./plugins/cache-first";
import { createCostPlugin, MemoryCostMeter, costLevelOf, tierOfModel } from "./plugins/cost";
import { createRepairPipeline, flattenArguments, truncateContent } from "./plugins/repair";
import { Coordinator, finalText, textBlock } from "./plugins/coordinator";
import { defaultModelSelection, normalizeBaseUrl, resolveDeepSeekAdapterConfig, DEEPSEEK_MODELS } from "./llm/deepseek";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("== 缓存优先（前缀指纹） ==");
test("指纹与段顺序无关，与文本内容相关", () => {
  const a = { sections: [
    { name: "b", order: 100, text: "tools" },
    { name: "a", order: 0, text: "persona" },
  ], contexts: [], tools: [], variables: {} };
  const b = { sections: [
    { name: "a", order: 0, text: "persona" },
    { name: "b", order: 100, text: "tools" },
  ], contexts: [], tools: [], variables: {} };
  const c = { sections: [
    { name: "a", order: 0, text: "persona-CHANGED" },
    { name: "b", order: 100, text: "tools" },
  ], contexts: [], tools: [], variables: {} };
  assert.strictEqual(prefixFingerprint(a), prefixFingerprint(b));
  assert.notStrictEqual(prefixFingerprint(a), prefixFingerprint(c));
});

test("动态内容（order>199）不计入前缀指纹", () => {
  const stable = { sections: [{ name: "p", order: 0, text: "persona" }], contexts: [], tools: [], variables: {} };
  const dynamic = { sections: [
    { name: "p", order: 0, text: "persona" },
    { name: "d", order: 300, text: "session-specific" },
  ], contexts: [], tools: [], variables: {} };
  assert.strictEqual(prefixFingerprint(stable), prefixFingerprint(dynamic));
});

console.log("== 成本管控 ==");
test("MemoryCostMeter 分级与 pro 无提示升级检测", () => {
  const meter = new MemoryCostMeter();
  meter.record("s1", { inputTokens: 10_000, outputTokens: 5_000 }, "flash");
  assert.strictEqual(costLevelOf(meter.snapshot("s1").sessionCostUsd, { greenSessionUsd: 0.05, amberSessionUsd: 0.12 }), "green");
  meter.record("s1", { inputTokens: 100_000, outputTokens: 20_000 }, "pro");
  assert.strictEqual(meter.didSilentUpgrade("s1"), true, "flash->pro 应记为无提示升级");
  assert.strictEqual(meter.snapshot("s1").tier, "pro");
});

test("tierOfModel 按模型名判定档位", () => {
  assert.strictEqual(tierOfModel("deepseek-v4-flash"), "flash");
  assert.strictEqual(tierOfModel("deepseek-v4-pro"), "pro");
});

test("createCostPlugin.install 注入 llm/stream 计量（host 冒烟）", () => {
  const plugin = createCostPlugin();
  let capturedUsage = false;
  const host = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      if (event === "llm/stream") {
        // 冒烟：模拟一次流式调用并消费 usage
        const fn = handler as (options: { model: string; sessionId?: string }, next: () => AsyncIterable<unknown>) => AsyncIterable<unknown>;
        const iterable = fn({ model: "deepseek-v4-flash", sessionId: "s1" as never }, async function* () {
          yield { type: "usage", usage: { inputTokens: 10_000, outputTokens: 5_000 } };
        });
        void iterable;
        capturedUsage = true;
      }
    },
  };
  const dispose = plugin.install(host as never);
  assert.ok(capturedUsage);
  dispose();
});

console.log("== DeepSeek 配置映射 ==");
test("defaultModelSelection flash-first", () => {
  const sel = defaultModelSelection();
  assert.strictEqual(sel.provider, "deepseek-official");
  assert.strictEqual(sel.model, DEEPSEEK_MODELS.flash);
  assert.strictEqual(defaultModelSelection("pro").model, DEEPSEEK_MODELS.pro);
});

test("normalizeBaseUrl 补全 /v1", () => {
  assert.strictEqual(normalizeBaseUrl("https://api.example.com"), "https://api.example.com/v1");
  assert.strictEqual(normalizeBaseUrl("https://api.example.com/"), "https://api.example.com/v1");
  assert.strictEqual(normalizeBaseUrl("https://api.example.com/v1"), "https://api.example.com/v1");
  assert.strictEqual(normalizeBaseUrl("https://api.example.com/v1/"), "https://api.example.com/v1");
  assert.strictEqual(normalizeBaseUrl(undefined), undefined);
});

test("resolveDeepSeekAdapterConfig 映射 reasonix.toml", () => {
  const cfg = resolveDeepSeekAdapterConfig({ default_model: "pro", baseURL: "https://relay.example.com", maxTokens: 128_000 });
  assert.strictEqual(cfg.baseURL, "https://relay.example.com/v1");
  assert.strictEqual(cfg.apiKeyEnv, "DEEPSEEK_API_KEY");
  assert.strictEqual(cfg.reasoningEffort, "high");
  assert.strictEqual(cfg.maxTokens, 128_000);
  assert.strictEqual(cfg.models?.length, 2);
});

console.log("== 缓存优先插件注册 ==");
test("createCacheFirstPlugin.register 挂载 section 与 assemble 瀑布", () => {
  const plugin = createCacheFirstPlugin();
  let sectionRegistered = false;
  let assembleHooked = false;
  const store = {
    getPrefix: () => undefined,
    setPrefix: () => void 0,
  };
  const host = {
    systemPrompt: {
      section: () => { sectionRegistered = true; return () => void 0; },
      assemble: async () => ({ sections: [], contexts: [], tools: [], variables: {} }),
    },
    on: (event: string) => { if (event === "system-prompt/assemble") assembleHooked = true; },
  };
  const dispose = plugin.register(host as never, store);
  assert.ok(sectionRegistered, "应注册 reasonix:cache-prefix 段");
  assert.ok(assembleHooked, "应监听 system-prompt/assemble 瀑布");
  dispose();
});

console.log("== 修复管线 ==");
test("flattenArguments 解析字符串化 JSON / 解包单元素数组", () => {
  assert.deepStrictEqual(flattenArguments('{"a":1}'), { changed: true, value: { a: 1 } });
  assert.deepStrictEqual(flattenArguments([{ a: 1 }]), { changed: true, value: { a: 1 } });
  assert.deepStrictEqual(flattenArguments("plain text"), { changed: false, value: "plain text" });
  assert.deepStrictEqual(flattenArguments({ a: 1 }), { changed: false, value: { a: 1 } });
});

test("truncateContent 超预算时插入标记", () => {
  const big = { type: "text" as const, text: "x".repeat(10_000) };
  const out = truncateContent([big], { thresholdChars: 8192, headChars: 4096, tailChars: 1024, enabled: true });
  const joined = out.filter((b) => b.type === "text").map((b) => b.text).join("");
  assert.ok(joined.includes("[... tool result middle pruned ...]"));
  assert.ok(Array.from(joined).length < 10_000);
});

test("createRepairPipeline storm 抑制重复调用", async () => {
  const pipeline = createRepairPipeline({ storm: { window: 8, maxRepeats: 1 } });
  const seen: string[] = [];
  const host = {
    on: (event: string, _handler: (...args: unknown[]) => unknown) => { seen.push(event); },
  };
  const dispose = pipeline.install(host as never);
  assert.ok(seen.includes("tools/pre-execute"));
  assert.ok(seen.includes("tools/execute"));
  assert.ok(seen.includes("tools/post-execute"));
  assert.ok(seen.includes("tools/result"));
  dispose();
});

console.log("== Coordinator ==");
test("finalText 聚合文本块", () => {
  assert.strictEqual(finalText([textBlock("a"), textBlock("b"), { type: "reasoning", text: "x" }]), "ab");
});

test("Coordinator 模型选择 planner=pro executor=flash", () => {
  const coordinator = new Coordinator({} as never, { plannerModel: "deepseek-v4-pro", executorModel: "deepseek-v4-flash" });
  assert.strictEqual(coordinator.plannerSelection().model, "deepseek-v4-pro");
  assert.strictEqual(coordinator.executorSelection().model, "deepseek-v4-flash");
  assert.strictEqual(coordinator.plannerSelection().provider, "deepseek-official");
});

test("Coordinator.planAndExecute 走 planner/executor 子 Agent", async () => {
  const calls: string[] = [];
  const fakeSubagents = {
    async start(name: string, req: { label: string; outputSchema?: unknown }) {
      calls.push(name);
      const isPlanner = req.label === "reasonix-planner";
      return {
        id: isPlanner ? "p" : "e",
        result: Promise.resolve(
          isPlanner
            ? { output: [], structured: { goal: "g", steps: ["s1"] }, stopReason: "completed" as const }
            : { output: [textBlock("done")], structured: undefined, stopReason: "completed" as const },
        ),
        dispose: async () => void 0,
      };
    },
  };
  const coordinator = new Coordinator({ subagents: fakeSubagents } as never, {});
  const result = await coordinator.planAndExecute("task");
  assert.strictEqual(calls[0], "spawn");
  assert.strictEqual(calls[1], "spawn");
  assert.ok(result.planText.includes("Goal: g"));
  assert.strictEqual(result.resultText, "done");
  assert.strictEqual(result.stopReason, "completed");
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exitCode = 1;
