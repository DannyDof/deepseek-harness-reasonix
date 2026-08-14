# 架构说明

对应技术方案书第 3–5、12–13 章。本仓库已完成 **M1–M5**（桥接层 + 引擎层骨架 + 修复管线/Coordinator + 配置兼容/基准验证 + 回滚通道）。

## 三层结构

- **前端层 `reasonix-frontend`**（不在本仓库）：保留 Reasonix CLI/TUI/桌面，只消费桥接层投影的渲染事件。
- **桥接层 `bridge/`**（M1 交付）：
  - `events/reasonix.ts`：Reasonix `event.Sink` 事件模型（前端契约）。
  - `events/dsh.ts`：dsh 真实事件模型（引擎契约）。
  - `mapping/event-map.ts`：双向映射与成本分级。
  - `protocol/jsonrpc.ts`：JSON-RPC 2.0（无依赖）。
  - `protocol/acp.ts`：ACP 客户端骨架。
  - `sidecar.ts`：dsh Sidecar 进程编排。
  - `backend-switch.ts`：后端切换（dsh ↔ Go Controller）+ 回滚通道冻结（M5）。
  - `session/checkpoint.ts`：Session 双向导出（dsh SessionEvent ↔ Reasonix 检查点，M5）。
  - `index.ts`：`Bridge` 门面，两路高频上游之间唯一的缓冲层。
- **引擎层 `bundle-reasonix/`**（M2 交付，对齐真实接缝）：
  - `cordis.patch.yml`：dsh profile patch（覆盖 dsh-base 行 + 插入插件行）。
  - `src/dsh.ts`：`@deepseek-ai/*` 真实 API 的类型镜像（M3 以真实包替换）。
  - `src/llm/deepseek.ts`：reasonix.toml → 官方 `llm-deepseek` 适配器 Config 映射。
  - `src/plugins/cache-first.ts`：缓存优先插件（`systemPrompt.section` + `system-prompt/assemble` 瀑布）。
  - `src/plugins/cost.ts`：分级成本插件（`llm/stream` 瀑布 usage 计量）。
  - `src/plugins/repair.ts`：修复管线（`tools/pre-execute`/`execute`/`post-execute`/`result` 接缝：scavenge/flatten/truncation/storm）。
  - `src/plugins/coordinator.ts`：双模型 Coordinator（`ctx.subagents` 子 Agent：planner/executor）。
  - `src/config/reasonix-config.ts`：reasonix.toml → dsh profile 映射 + `cordis.patch.yml` 渲染（M4）。
  - `src/benchmark/`：基准验证（缓存命中率/成本比/成功率 + 阈值判定，M4）。
  - `src/ports.ts`：防腐层稳定抽象（CachePolicy/Repair/Cost/AgentLoop）。

## 真实 dsh 接缝（M2 调研结论）

| dsh 接缝 | 位置 | 本仓库对应 |
|---|---|---|
| `LlmAdapter` / `ctx.llm` | `packages/llm/llm` | 官方 `llm-deepseek` 已实现，本仓库只做配置映射 |
| 官方 DeepSeek 适配器 | `packages/llm/llm-deepseek` | `src/llm/deepseek.ts`（provider `deepseek-official`，模型 `deepseek-v4-flash/pro`） |
| `SystemPrompt.section()` + `system-prompt/assemble` | `packages/core/system-prompt` | `src/plugins/cache-first.ts` |
| `llm/stream` 瀑布（usage 分片） | `packages/llm/llm` | `src/plugins/cost.ts` |
| `tools/pre-execute` `tools/execute` `tools/post-execute` `tools/result` | `packages/core/tools` | `src/plugins/repair.ts` |
| `ctx.subagents` + `installModelSelection` | `packages/subagent` / `packages/core/agent` | `src/plugins/coordinator.ts` |
| `agent/*` 主题事件 | `packages/core/agent` | `bridge/events/dsh.ts` |
| `session/event` 广播 | `packages/core/session` | `bridge/events/dsh.ts` |
| bundle 清单 | `dsh.bundle.patch`（package.json） | `bundle-reasonix/cordis.patch.yml` |

关键事实：**dsh 官方已内置 DeepSeek 适配器**，M2 无需自写 adapter，改为配置映射 + bundle 装配；bundle 的形态是 npm 包 + `dsh.bundle.patch` 清单（`cordis.patch.yml` 覆盖/插入行），而非代码前缀 `dsh-bundle-`。

## 事件映射要点

| Reasonix（前端契约） | dsh（引擎契约，真实词汇） | 方向 |
|---|---|---|
| `user_message` | `user/message` | 上送 |
| `tool_call` / `tool_result` | `tool/call` / `tool/result` | 上送 |
| `session_opened/closed` | `session/created` / `session/disposed` | 上送 |
| `approval_result` | `approval/resolved` | 上送 |
| `assistant_chunk/message` | `assistant/chunk` / `assistant/message` | 投影 |
| `turn_started/turn_done` | `turn/start` / `turn/end` | 投影 |
| `status_changed` | `agent/status` | 投影 |
| `approval_request` | `approval/asked` | 投影 |
| `cost_updated`（绿/黄/红） | `llm/usage`（缓存折扣后计价） | 投影（按阈值分级） |
| （不可见） | `agent/pre-step` `agent/session-start` `agent/turn-stopping` `agent/error` | 丢弃 |

引擎内部机制事件不对前端渲染，满足 dsh"模型可见即已记录"不变式。

## 高频更新适配（两路上游 + 一个缓冲层）

- **dsh 升版**：见技术方案第 12 章。`bundle-reasonix/src/index.ts` 的 `DshSeamConsumed` 即影响面清单；契约测试对齐 `bridge/src/check.ts` + `bundle-reasonix/src/check.ts`。
- **Reasonix 前端升版**：见第 13 章。前端契约（`events/reasonix.ts`）变动只在 `mapping/event-map.ts` 吸收。
- 原则：任一侧变动都不要求另一侧同步改。
