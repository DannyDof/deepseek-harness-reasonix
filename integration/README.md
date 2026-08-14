# 真实 dsh 集成验证

验证 `bundle-reasonix` 的插件在**真实** `@deepseek-ai/*` 包（cordis / dsh-llm / dsh-system-prompt）上工作，而非 `src/dsh.ts` 类型镜像。

## 前置

- Node 20+（dsh 为 ESM，Node 16 无法运行）
- 已构建 workspace：`npm run build --workspaces`（产出 `bundle-reasonix/dist`）

## 运行

```bash
cd integration
npm install --legacy-peer-deps   # 安装真实 dsh 包（peer 依赖需 legacy）
npm run typecheck                # 编译期：镜像类型 vs 真实类型双向可赋值
npm run smoke                    # 运行时：cost + cache-first 在真实 cordis/dsh 上冒烟
```

## 覆盖

- `src/typecheck.ts`：`TokenUsage` / `PromptSection` / `PromptAssembly` / `FinishReason` 镜像与真实类型双向可赋值。
- `src/smoke.mjs`：
  - cost 插件经真实 `LlmRuntime` 的 `llm/stream` 瀑布计量 usage；
  - cache-first 插件经真实 `SystemPrompt.section` 注册 + `system-prompt/assemble` 计算前缀指纹。

带 branded id 的类型（`ContentBlock` / `StreamChunk` / `GenerateOptions`）因 nominal branding 无法跨包结构断言，由 `smoke.mjs` 运行时验证。
