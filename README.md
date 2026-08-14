# DeepSeek Harness × Reasonix

用 DeepSeek Harness（dsh）的 Cordis 插件运行时替换 DeepSeek-Reasonix 后端 Agent 的落地实现仓库。

本仓库按《用 DeepSeek Harness 替换 DeepSeek-Reasonix 后端 Agent 技术方案书》推进，当前处于 **M2（引擎层骨架对齐真实 dsh 接缝）**。

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
| `bridge/` | 桥接层 | Reasonix/dsh 事件模型、双向映射、ACP/JSON-RPC 协议骨架、Sidecar 进程编排 |
| `bundle-reasonix/` | 引擎层 | dsh profile bundle：`cordis.patch.yml` 清单 + 缓存优先/成本插件 + DeepSeek 适配器配置映射 |
| `docs/` | — | 架构说明与方案摘要 |

## 快速开始

```bash
npm install          # 安装依赖（typescript 等）
npm run build        # 编译各 workspace（tsc）
npm run check        # 运行事件映射自检
```

## 设计文档

- [架构说明](docs/architecture.md)
- [技术方案摘要](docs/design-plan.md)

## 里程碑

- [x] M1 桥接层 + 事件映射原型（Sidecar）
- [x] M2 dsh-bundle-reasonix：缓存优先 + DeepSeek 适配器（对齐真实接缝）
- [ ] M3 修复管线 + 成本管控 + Coordinator
- [ ] M4 配置兼容 + 基准验证达标
- [ ] M5 默认切换 + 回滚通道冻结

## 参考

- 上游：<https://github.com/esengine/DeepSeek-Reasonix>
- 上游：<https://github.com/deepseek-ai/deepseek-harness>
