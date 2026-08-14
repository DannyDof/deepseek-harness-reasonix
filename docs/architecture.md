# 架构说明

对应技术方案书第 3–5、12–13 章。本仓库当前实现的是 **桥接层** 与 **dsh bundle 骨架**。

## 三层结构

- **前端层 `reasonix-frontend`**（不在本仓库）：保留 Reasonix CLI/TUI/桌面，只消费桥接层投影的渲染事件。
- **桥接层 `bridge/`**：本仓库 M1 交付物。
  - `events/reasonix.ts`：Reasonix `event.Sink` 事件模型（前端契约）。
  - `events/dsh.ts`：dsh `session/event` + `agent/*` + `telemetry/*` 事件模型（引擎契约）。
  - `mapping/event-map.ts`：双向映射与成本分级。
  - `protocol/jsonrpc.ts`：JSON-RPC 2.0（无依赖）。
  - `protocol/acp.ts`：ACP 客户端骨架。
  - `sidecar.ts`：dsh Sidecar 进程编排。
  - `index.ts`：`Bridge` 门面，两路高频上游之间唯一的缓冲层。
- **引擎层 `bundle-reasonix/`**：dsh 插件 bundle 骨架。
  - `ports.ts`：防腐层稳定抽象（CachePolicyPort / RepairPipelinePort / CostMeterPort / AgentLoopPort）。
  - `plugins/`：缓存优先、修复管线、成本、Coordinator 四个能力插件脚手架。

## 事件映射要点

| Reasonix（前端契约） | dsh（引擎契约） | 方向 |
|---|---|---|
| `user_message` | `user/message` | 上送 |
| `tool_call` / `tool_result` | `tool/call` / `tool/result` | 上送 |
| `session_opened/closed` | `session/started/stopped` | 上送 |
| `approval_result` | `agent/validation` | 上送 |
| `assistant_chunk/message` | `assistant/chunk/message` | 投影 |
| `status_changed` | `agent/status` | 投影 |
| `approval_request` | `agent/request` | 投影 |
| `cost_updated`（绿/黄/红） | `telemetry/cost` | 投影（按阈值分级） |
| （不可见） | `agent/pre-step` `agent/turn-stopping` | 丢弃 |

引擎内部机制事件（`agent/pre-step` 等）不对前端渲染，满足 dsh“模型可见即已记录”不变式。

## 高频更新适配（两路上游 + 一个缓冲层）

- **dsh 升版**：见技术方案第 12 章。`bundle-reasonix/src/index.ts` 的 `DshSeamConsumed` 即影响面清单；契约测试对齐 `bridge/src/check.ts`。
- **Reasonix 前端升版**：见第 13 章。前端契约（`events/reasonix.ts`）变动只在 `mapping/event-map.ts` 吸收。
- 原则：任一侧变动都不要求另一侧同步改。
