# 技术方案摘要

完整方案见《用 DeepSeek Harness 替换 DeepSeek-Reasonix 后端 Agent 技术方案书》。此处为落地仓库对应的要点摘录。

## 方案 C：插件化移植（推荐）

以 dsh 为引擎，将 Reasonix 三大独有能力移植为 `dsh-bundle-reasonix` bundle；Reasonix 前端改造为驱动 dsh 的薄客户端。

## 能力映射

| Reasonix | dsh | 本仓库 |
|---|---|---|
| `control.Controller` | `ctx.agentLoop` + `ctx.agents` | `bundle-reasonix` Coordinator 插件 |
| `tool.Registry` | `ctx.tools` | 桥接层工具事件 |
| `provider.Provider` | `ctx.llm` 适配器 | M2（DeepSeek adapter） |
| `plugin.Host`(MCP) | `tools/*` 接缝 | M2 |
| `event.Sink` | `session/event` + `agent/*` | `bridge/src/events/*` |
| 缓存优先前缀 | `ctx.systemPrompt` 段装配 | `cache-first` 插件 |
| 修复管线 | `agent/pre-step` / `tools/*` | `repair` 插件 |
| 分级成本管控 | `telemetry/*` | `cost` 插件 |

## 里程碑（全部完成）

- M1 桥接层 + 事件映射原型（Sidecar）— 已完成（`bridge/`）
- M2 dsh-bundle-reasonix：缓存优先 + DeepSeek 适配器 — 已完成（`bundle-reasonix/`）
- M3 修复管线 + Coordinator 接入真实 `tools/*` / `ctx.subagents` — 已完成
- M4 配置兼容（reasonix.toml → profile）+ 基准验证 — 已完成（`src/config/` + `src/benchmark/`）
- M5 默认切换 + 回滚通道冻结 — 已完成（`bridge/src/backend-switch.ts` + `bridge/src/session/checkpoint.ts`）

## 关键机制

- **回滚**：保留原 Go Controller，配置开关在 dsh / Go 后端间切换（第 8.3 节）。
- **dsh 高频更新适配**：profile pin 具体 commit、差异收敛到 `cordis.patch.yml`、防腐层 Ports 隔离 API 波动、`--dump-config` 快照 diff + 契约测试（第 12 章）。
- **前端高频更新适配**：契约版本协商（事件/命令/元数据三类稳定面）、变更分渲染/契约/桥接三类处置（第 13 章）。
- **Windows 分发**：Wails + NSIS，捆绑 Node 宿主与 dsh bundle，Authenticode 签名（第 11 章）。
