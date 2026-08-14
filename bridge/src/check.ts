/**
 * 桥接层事件映射与协议自检（M1/M2 验收脚本）。
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
import { BackendSwitch } from "./backend-switch";
import { exportCheckpoint, importCheckpoint } from "./session/checkpoint";
import { DshEvent } from "./events/dsh";

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

test("approval_result 映射为 approval/resolved", () => {
  const out = mapReasonixToDsh({ type: "approval_result", sessionId: "s1", requestId: "r1", approved: true });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, "approval/resolved");
});

console.log("== dsh -> Reasonix ==");
test("approval/asked 映射为 approval_request(kind=plan)", () => {
  const out = mapDshToReasonix({ kind: "approval/asked", sessionId: "s1", requestId: "r1", kindOf: "plan", summary: "plan?" });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].type, "approval_request");
  assert.strictEqual((out[0] as { kind: string }).kind, "plan");
});

test("llm/usage 映射为 cost_updated 且按阈值分级（含缓存折扣）", () => {
  const green = mapDshToReasonix({ kind: "llm/usage", sessionId: "s1", provider: "deepseek-official", model: "deepseek-v4-flash", inputTokens: 10_000, outputTokens: 5_000 })[0];
  assert.strictEqual((green as { level: string }).level, "green");

  const amber = mapDshToReasonix({ kind: "llm/usage", sessionId: "s1", provider: "deepseek-official", model: "deepseek-v4-pro", inputTokens: 20_000, outputTokens: 2_000 })[0];
  assert.strictEqual((amber as { level: string }).level, "amber");

  const red = mapDshToReasonix({ kind: "llm/usage", sessionId: "s1", provider: "deepseek-official", model: "deepseek-v4-pro", inputTokens: 100_000, outputTokens: 20_000 })[0];
  assert.strictEqual((red as { level: string }).level, "red");

  const cached = mapDshToReasonix({ kind: "llm/usage", sessionId: "s1", provider: "deepseek-official", model: "deepseek-v4-flash", inputTokens: 1_000, cacheReadTokens: 9_000, outputTokens: 1_000 })[0] as { turnCostUsd: number };
  const uncached = mapDshToReasonix({ kind: "llm/usage", sessionId: "s1", provider: "deepseek-official", model: "deepseek-v4-flash", inputTokens: 10_000, outputTokens: 1_000 })[0] as { turnCostUsd: number };
  assert.ok(cached.turnCostUsd < uncached.turnCostUsd, "缓存命中应降低计费");
});

test("session/created -> session_opened, turn/start -> turn_started", () => {
  assert.strictEqual(mapDshToReasonix({ kind: "session/created", sessionId: "s1", title: "t" })[0].type, "session_opened");
  assert.strictEqual(mapDshToReasonix({ kind: "turn/start", sessionId: "s1", seq: 1 })[0].type, "turn_started");
});

test("agent/pre-step 与 agent/session-start 对前端不可见", () => {
  assert.strictEqual(mapDshToReasonix({ kind: "agent/pre-step", sessionId: "s1", turn: 1, step: 1 }).length, 0);
  assert.strictEqual(mapDshToReasonix({ kind: "agent/session-start", sessionId: "s1", source: "resume" }).length, 0);
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

console.log("== 后端切换与回滚（M5） ==");
test("BackendSwitch 默认 dsh，可切到 go 回滚", () => {
  const sw = new BackendSwitch();
  assert.strictEqual(sw.activeBackend, "dsh");
  sw.select("go");
  assert.strictEqual(sw.activeBackend, "go");
  sw.select("dsh");
  assert.strictEqual(sw.activeBackend, "dsh");
});

test("BackendSwitch.freezeRollback 锁定回滚通道", () => {
  const sw = new BackendSwitch({ rollbackEnabled: false });
  assert.throws(() => sw.select("go"));
  sw.freezeRollback();
  assert.ok(sw.isRollbackFrozen());
  sw.switchToRollback();
  assert.strictEqual(sw.activeBackend, "go");
});

console.log("== Session 双向导出 ==");
test("exportCheckpoint 汇总 assistant 分片与工具调用", () => {
  const events: DshEvent[] = [
    { kind: "session/created", sessionId: "s1", title: "t" },
    { kind: "turn/start", sessionId: "s1", seq: 1 },
    { kind: "user/message", sessionId: "s1", seq: 2, content: "hi" },
    { kind: "assistant/chunk", sessionId: "s1", delta: "Hel" },
    { kind: "assistant/chunk", sessionId: "s1", delta: "lo" },
    { kind: "tool/call", sessionId: "s1", callId: "c1", name: "bash", arguments: { cmd: "ls" } },
    { kind: "assistant/message", sessionId: "s1", content: "Hello" },
    { kind: "tool/result", sessionId: "s1", callId: "c1", ok: true, output: "ok" },
    { kind: "turn/end", sessionId: "s1", seq: 9, reason: "completed" },
  ];
  const cp = exportCheckpoint(events);
  assert.strictEqual(cp.sessionId, "s1");
  assert.strictEqual(cp.title, "t");
  assert.strictEqual(cp.messages[0].role, "user");
  const assistant = cp.messages.find((m) => m.role === "assistant");
  assert.ok(assistant && assistant.role === "assistant");
  assert.strictEqual((assistant as { toolCalls?: unknown[] }).toolCalls?.length, 1);
  assert.ok(cp.messages.some((m) => m.role === "tool"));
});

test("importCheckpoint 逆向还原 dsh 事件（round-trip 保真）", () => {
  const cp = {
    format: "reasonix-checkpoint" as const,
    version: 1 as const,
    sessionId: "s2",
    title: "demo",
    messages: [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "world", toolCalls: [{ id: "c1", name: "bash", args: { cmd: "ls" } }] },
      { role: "tool" as const, callId: "c1", output: "file" },
    ],
  };
  const events = importCheckpoint(cp);
  assert.strictEqual(events[0].kind, "session/created");
  assert.ok(events.some((e) => e.kind === "user/message" && (e as { content: string }).content === "hello"));
  assert.ok(events.some((e) => e.kind === "assistant/message" && (e as { content: string }).content === "world"));
  assert.ok(events.some((e) => e.kind === "tool/call" && (e as { callId: string }).callId === "c1"));
  assert.ok(events.some((e) => e.kind === "tool/result" && (e as { output: string }).output === "file"));
  // round-trip
  const reexported = exportCheckpoint(importCheckpoint(cp));
  assert.strictEqual(reexported.sessionId, "s2");
  assert.strictEqual(reexported.messages.length, cp.messages.length);
});

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exitCode = 1;
