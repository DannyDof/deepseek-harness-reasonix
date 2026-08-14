/**
 * 运行时冒烟：验证 bundle-reasonix 插件在真实 cordis / dsh 运行时上工作。
 *
 * 覆盖：
 * 1. cost 插件：真实 LlmRuntime 的 llm/stream 瀑布，usage 分片计量；
 * 2. cache-first 插件：真实 SystemPrompt.section 注册 + system-prompt/assemble 前缀指纹。
 *
 * 运行（Node 20+）：
 *   npm install --legacy-peer-deps
 *   npm run build --workspaces  （先构建 bundle-reasonix）
 *   npm run smoke
 */
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const costMod = require('../../bundle-reasonix/dist/plugins/cost.js');
const cacheMod = require('../../bundle-reasonix/dist/plugins/cache-first.js');
const { installCostMeter, MemoryCostMeter } = costMod;
const { createCacheFirstPlugin } = cacheMod;

let failures = 0;

function check(name, ok, detail = '') {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name} ${detail}`);
  }
}

async function costSmoke() {
  const ctx = new Context();
  await ctx.plugin(LlmRuntime);
  const meter = new MemoryCostMeter();
  installCostMeter(ctx, meter);

  class MockAdapter extends LlmAdapter {
    async *stream() {
      yield { type: 'text-delta', index: 0, text: 'hi' };
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 20 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['mock'], new MockAdapter());
  for await (const _c of ctx.llm.stream({ provider: 'mock', model: 'deepseek-v4-flash', messages: [], sessionId: 's1' })) { /* consume */ }

  const snap = meter.snapshot('s1');
  check('cost 插件在真实 dsh llm/stream 瀑布计量', snap.tier === 'flash' && snap.turnCostUsd > 0, JSON.stringify(snap));
}

async function cacheFirstSmoke() {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);

  const store = {
    map: new Map(),
    getPrefix(k) { return this.map.get(k); },
    setPrefix(k, v) { this.map.set(k, v); },
  };
  const plugin = createCacheFirstPlugin();
  plugin.register(ctx, store);

  const assembly = await ctx.systemPrompt.assemble();
  const names = assembly.sections.map((s) => s.name);
  const fp = plugin.prefixFingerprint(assembly);
  check('cache-first 注册 reasonix:cache-prefix 段', names.includes('reasonix:cache-prefix'));
  check('cache-first 前缀指纹含真实段', fp.includes('reasonix:cache-prefix'), fp);
  check('cache-first 指纹已记录', store.getPrefix('default') === fp);
}

await costSmoke();
await cacheFirstSmoke();

console.log(failures === 0 ? '\n结果: 真实 dsh 集成冒烟全部通过' : `\n结果: ${failures} 失败`);
if (failures > 0) process.exitCode = 1;
