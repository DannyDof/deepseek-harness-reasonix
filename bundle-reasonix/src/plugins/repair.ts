import { RepairPipelinePort } from "../ports";

/**
 * 工具调用修复管线插件（4.2.2）。
 * 挂载点：tools/pre-execute、agent/pre-step、tools/* 能力接缝。
 * 本文件为结构骨架，M3 按 dsh 实际事件签名实现瀑布监听。
 */
export function createRepairPlugin(repair: RepairPipelinePort) {
  return {
    /** 工具执行前：scavenge 抽取遗漏 tool_call */
    onPreExecute(sessionId: string, reasoning: string) {
      return repair.scavenge(sessionId, reasoning);
    },
    /** 检测到非平衡 JSON：flatten 闭合或请求续写 */
    onMalformedToolArgs(sessionId: string, malformed: string) {
      return repair.flatten(sessionId, malformed);
    },
    /** 前缀裁剪：按比例截断陈旧结果 */
    onCompactPrefix(sessionId: string, ratio: number) {
      return repair.truncate(sessionId, ratio);
    },
    /** 滑动窗口 storm 抑制 */
    onToolResult(sessionId: string, recent: Array<{ name: string; args: unknown }>) {
      return repair.storm(sessionId, recent);
    },
  };
}
