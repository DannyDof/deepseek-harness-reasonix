import { CachePolicyPort } from "../ports";

/**
 * 缓存优先循环插件（4.2.1）。
 * 挂载点：core/system-prompt 段装配 + agent/pre-step。
 * 本文件为结构骨架，M2 接入 dsh 具体接缝。
 */
export function createCacheFirstPlugin(cache: CachePolicyPort) {
  return {
    /** agent/pre-step：校验不可变前缀字节稳定 */
    onAgentPreStep(sessionId: string, stepIndex: number, modelVisible: { prefix: string; body: string }) {
      const stable = cache.assertPrefixStable(sessionId, modelVisible);
      return { stable, stepIndex };
    },
    /** 前缀将变：触发压缩而非重排 */
    onPrefixAboutToChange(sessionId: string, reason: string) {
      return cache.compact(sessionId, reason);
    },
  };
}
