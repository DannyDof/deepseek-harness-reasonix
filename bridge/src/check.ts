/**
 * 事件映射与协议自检（M1 验收脚本）。
 * 运行：npm run check
 */
import * as assert from "assert";
import {
  mapReasonixToDsh,
  mapDshToReasonix,
  DEFAULT_COST_THRESHOLDS,
} from "./mapping/event-map";
import { JsonRpcClient, JsonRpcServer, RpcTransport, JsonRpcMessage } from "./protocol/jsonrpc";
import { AcpClient } from "./protocol/acp";
import { Bridge } from "./index";

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

function makeLoopbackTransport(): { left: RpcTransport; right: RpcTransport } {
  const listeners = {
    left: new Set<(m: JsonRpcMessage) => void>(),
    right: new Set<(m: JsonRpcMessage) => void>(),
  };
  const left: RpcTransport = {
    send: (m) => { for (const l of listeners.right) l(m); },
    onMessage: (l) => void listeners.left.add(l),
  };
  const right: RpcTransport = {
    send: (m) => { for (const l of listeners.left) l(m); },
    onMessage: (l) => void listeners.right.add(l),
  };
  return { left, right };
}

console.log("== Reasonix -> dsh ==");
test("user_message 映射为 user/message", () => {
  const out = mapReasonixToDsh({ type: "user_message", sessionId: "s1", content: "hi" });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, "user/message");
  assert.strictEqual((out[0] as { content: string }).content, "hi");
});

test("tool_call 映射为 tool/call 且保留 callId", () => {
  const out = mapReasonixToDsh({ type: "tool_call", sessionId: "s1", callId: "c1", name: "bash", arguments: { cmd: "ls" } });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, "tool/call");
  assert.strictEqual((out[0] as { callId: string }).callId, "c1");
});

test("cost_updated 属引擎下行，不回传", () => {
  const out = mapReasonixToDsh({ type: "cost_updated", sessionId: "s1", turnCostUsd: 0, sessionCostUsd: 0.01, tier: "flash", level: "green" });
  assert.strictEqual(out.length, 0);
});

console.log("== dsh -> Reasonix ==");
test("agent/request(plan) 映射为 approval_request(kind=plan)", () => {
  const out = mapDshToReasonix({ kind: "agent/request", sessionId: "s1", requestId: "r1", requestType: "plan", summary: "plan?" });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].type, "approval_request");
  assert.strictEqual((out[0] as { kind: string }).kind, "plan");
});

test("telemetry/cost 映射为 cost_updated 且按阈值分级", () => {
  const green = mapDshToReasonix({ kind: "telemetry/cost", sessionId: "s1", turnCostUsd: 0.001, sessionCostUsd: 0.01, tier: "flash", inputTokens: 10, outputTokens: 20 })[0];
  assert.strictEqual((green as { level: string }).level, "green");
  const amber = mapDshToReasonix({ kind: "telemetry/cost", sessionId: "s1", turnCostUsd: 0.02, sessionCostUsd: 0.08, tier: "pro", inputTokens: 10, outputTokens: 20 })[0];
  assert.strictEqual((amber as { level: string }).level, "amber");
  const red = mapDshToReasonix({ kind: "telemetry/cost", sessionId: "s1", turnCostUsd: 0.05, sessionCostUsd: 0.3, tier: "pro", inputTokens: 10, outputTokens: 20 })[0];
  assert.strictEqual((red as { level: string }).level, "red");
});

test("agent/pre-step 对前端不可见", () => {
  const out = mapDshToReasonix({ kind: "agent/pre-step", sessionId: "s1", stepIndex: 1 });
  assert.strictEqual(out.length, 0);
});

console.log("== Bridge 门面 ==");
test("Bridge 双向流转：reasonix -> dsh -> reasonix 闭环", () => {
  const bridge = new Bridge();
  const received: string[] = [];
  bridge.onReasonix((ev) => received.push(ev.type));
  const upstream = bridge.emitReasonix({ type: "user_message", sessionId: "s1", content: "hi" });
  assert.strictEqual(upstream.length, 1);
  const back = bridge.emitDsh(upstream[0] as never);
  assert.strictEqual(back.length, 1);
  assert.strictEqual(received[0], "user_message");
});

console.log("== JSON-RPC ==");
test("JSON-RPC 请求/响应往返", async () => {
  const t = makeLoopbackTransport();
  const server = new JsonRpcServer(t.right);
  server.registerMethod("echo", async (p) => p);
  const client = new JsonRpcClient(t.left);
  const result = await client.request("echo", { x: 1 });
  assert.deepStrictEqual(result, { x: 1 });
});

test("JSON-RPC 未知名方法报错", async () => {
  const t = makeLoopbackTransport();
  const server = new JsonRpcServer(t.right);
  server.registerMethod("known", async () => "ok");
  const client = new JsonRpcClient(t.left);
  await assert.rejects(async () => client.request("nope"), /method not found/);
});

test("ACP client initialize 走 JSON-RPC", async () => {
  const t = makeLoopbackTransport();
  const server = new JsonRpcServer(t.right);
  server.registerMethod("initialize", async () => ({
    protocolVersion: "2025-03-26",
    agentVersion: "dsh-dev",
    capabilities: { tools: true, permissions: true, planning: true },
  }));
  const acp = new AcpClient(t.left);
  const init = await acp.initialize();
  assert.strictEqual(init.agentVersion, "dsh-dev");
});

console.log("== 阈值常量 ==");
test("默认阈值存在且有序", () => {
  assert.ok(DEFAULT_COST_THRESHOLDS.greenSessionUsd < DEFAULT_COST_THRESHOLDS.amberSessionUsd);
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exitCode = 1;
