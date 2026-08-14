# DeepSeek Harness × Reasonix

用 DeepSeek Harness（dsh）的 Cordis 插件运行时替换 DeepSeek-Reasonix 后端 Agent 的落地实现仓库。

本仓库按《用 DeepSeek Harness 替换 DeepSeek-Reasonix 后端 Agent 技术方案书》推进，M1–M5 已全部完成，并落地 **融合应用 + 上游持续融合 + GitHub 直接构建 Windows 安装包**。

## 目标架构

```
┌────────────────────────────────────────────┐
│ 前端层  reasonix-frontend（保留：CLI/TUI/桌面） │
└───────────────┬────────────────────────────┘
                │ ACP / JSON-RPC
┌───────────────▼────────────────────────────┐
│ 桥接层  bridge（本仓库）                      │
│   事件映射 · 协议适配 · 进程编排（Sidecar）      │
└───────────────┬────────────────────────────┘
                │ SessionEvent / agent/*
┌───────────────▼────────────────────────────┐
│ 引擎层  dsh（Cordis 插件树）                  │
│   dsh-base + dsh-bundle-reasonix（本仓库）     │
└────────────────────────────────────────────┘
```

## 仓库结构

| 目录 | 层 | 说明 |
|---|---|---|
| `bridge/` | 桥接层 | Reasonix/dsh 事件模型、双向映射、ACP/JSON-RPC 协议骨架、Sidecar 进程编排、后端切换/回滚、Session 双向导出 |
| `bundle-reasonix/` | 引擎层 | dsh profile bundle：`cordis.patch.yml` 清单 + 缓存优先/成本/修复管线/Coordinator 插件 + DeepSeek 适配器配置映射 + 配置兼容(reasonix.toml→profile) + 基准验证 |
| `launcher/` | 融合应用 | Reasonix 风格 web 前端 + dsh 事件管线（HTTP/JSON-RPC 服务），`npm start` 即开即用 |
| `apps/desktop/` | 安装包 | Electron 桌面壳（CI 封装 NSIS Windows 安装包） |
| `scripts/` | 工具 | 上游同步、esbuild 打包 |
| `upstream/` | 融合 | 上游版本 pins（dsh / reasonix） |
| `.github/workflows/` | CI | 上游同步、契约检查、Windows 安装包构建 |
| `docs/` | — | 架构说明与方案摘要 |

## 快速开始

```bash
npm install          # 安装依赖（typescript 等）
npm run build        # 编译各 workspace（tsc）
npm run check        # 运行事件映射 + 插件 + 配置 + 基准自检
npm run bench --workspace bundle-reasonix   # 运行基准验证

# 融合应用（Reasonix 风格前端 + dsh 事件管线）
npm run build --workspace launcher
node launcher/dist/main.js        # 打开 http://127.0.0.1:8787
```

## 持续融合两项目高频更新

- `upstream/pins.json`：钉住 dsh 与 reasonix 的默认分支提交。
- `node scripts/sync-upstream.mjs [--write]`：拉取上游最新提交并比对/更新 pins。
- `.github/workflows/upstream-sync.yml`：每 6 小时检测上游更新，更新后自动跑契约检查 + 基准，变更则开 PR。
- `.github/workflows/contract-check.yml`：每日对上游 dsh @ HEAD 跑"升级看板"（契约测试 + 基准）。

## 直接在 GitHub 构建 Windows 安装包

- `.github/workflows/build-windows.yml`：`workflow_dispatch` 或打 `v*` tag 触发，在 `windows-latest` 上构建 NSIS 安装包并上传为 artifact（tag 则自动发布 Release）。
- 产物：`apps/desktop/release/*.exe`。

## 设计文档

- [架构说明](docs/architecture.md)
- [技术方案摘要](docs/design-plan.md)

## 里程碑

- [x] M1 桥接层 + 事件映射原型（Sidecar）
- [x] M2 dsh-bundle-reasonix：缓存优先 + DeepSeek 适配器（对齐真实接缝）
- [x] M3 修复管线 + Coordinator（接入 `tools/*` / `ctx.subagents`）
- [x] M4 配置兼容 + 基准验证达标
- [x] M5 默认切换 + 回滚通道冻结

## 参考

- 上游：<https://github.com/esengine/DeepSeek-Reasonix>
- 上游：<https://github.com/deepseek-ai/deepseek-harness>
