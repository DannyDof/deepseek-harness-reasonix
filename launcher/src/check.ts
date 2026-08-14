/**
 * 融合应用自检（M6 验收脚本）。
 * 运行：npm run check --workspace launcher
 */
import * as assert from "assert";
import { runTurn } from "./engine";
import { RpcHandler, RpcError } from "./rpc";

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

console.log("== 融合引擎 ==");
test("runTurn 产出 assistant_message 与 cost_updated", () => {
  const turn = runTurn("s1", "hello");
  const kinds = turn.events.map((e) => e.type);
  assert.ok(kinds.includes("assistant_chunk"));
  assert.ok(kinds.includes("assistant_message"));
  assert.ok(kinds.includes("cost_updated"));
});

test("runTurn 成本分级为绿 + 前缀稳定", () => {
  const turn = runTurn("s1", "hello");
  assert.strictEqual(turn.costLevel, "green");
  assert.strictEqual(turn.prefixStable, true);
});

console.log("== JSON-RPC ==");
test("initialize 返回能力集", () => {
  const h = new RpcHandler();
  const r = h.initialize() as { agentVersion: string };
  assert.ok(r.agentVersion.includes("reasonix"));
});

test("session/prompt 返回事件流", () => {
  const h = new RpcHandler();
  const created = h.sessionNew() as { sessionId: string };
  const r = h.sessionPrompt({ sessionId: created.sessionId, prompt: "hi" }) as { events: unknown[] };
  assert.ok(r.events.length > 0);
});

test("未知方法抛 RpcError", () => {
  const h = new RpcHandler();
  assert.throws(() => h.dispatch("nope", {}), (e) => e instanceof RpcError);
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exitCode = 1;
