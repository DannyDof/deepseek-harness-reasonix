import type { ContextLike, PromptAssembly } from "../dsh";

/**
 * 缓存优先插件（方案 4.2.1），对齐真实接缝：
 * - ctx.systemPrompt.section()：注册字节稳定的不可变前缀段；
 * - system-prompt/assemble 瀑布：捕获前缀指纹，漂移时触发压缩而非重排。
 * 前缀 = 系统提示段（sections）+ 工具 schema（tools）；动态内容走 contexts（用户快照），
 * 与 dsh 的"模型可见即已记录"不变式一致。
 */

export interface CacheFirstOptions {
  /** 前缀漂移时是否请求压缩（默认 true） */
  compactOnDrift?: boolean;
}

export const DEFAULT_CACHE_FIRST_OPTIONS: Required<CacheFirstOptions> = {
  compactOnDrift: true,
};

/** 会话级前缀状态存储（M2 内存实现；M3 可挂 session 检查点） */
export interface CacheStateStore {
  getPrefix(key: string): string | undefined;
  setPrefix(key: string, fingerprint: string): void;
}

/** 计算"不可变前缀"指纹：系统提示段（按序）+ 工具 schema 名（排序），字节可比 */
export function prefixFingerprint(assembly: PromptAssembly): string {
  const sections = assembly.sections.map((s) => `${s.name}\u0000${s.text}`);
  const tools = (assembly.tools ?? []).map((t) => t.name).sort();
  return JSON.stringify({ sections, tools });
}

/** 前缀漂移处理器（返回 true 表示已受理并请求压缩） */
export interface CacheDriftHandler {
  (key: string, previous: string, current: string): boolean | void;
}

export interface CacheFirstPlugin {
  /** 计算不可变前缀指纹 */
  prefixFingerprint(assembly: PromptAssembly): string;
  /** 在 dsh ctx 上挂载监听（M3 集成调用）。返回卸载函数。 */
  register(ctx: ContextLike, store: CacheStateStore, onDrift?: CacheDriftHandler): () => void;
}

export function createCacheFirstPlugin(options: CacheFirstOptions = {}): CacheFirstPlugin {
  const opts = { ...DEFAULT_CACHE_FIRST_OPTIONS, ...options };

  return {
    prefixFingerprint(assembly: PromptAssembly): string {
      return prefixFingerprint(assembly);
    },

    register(ctx: ContextLike, store: CacheStateStore, onDrift?: CacheDriftHandler): () => void {
      // 1) 注册不可变前缀段：固定文本，order 位于 persona(0) 与 tool guidance(100-199) 之间
      const disposeSection = ctx.systemPrompt.section({
        name: "reasonix:cache-prefix",
        order: 50,
        text: "Cacheable prefix: system prompt, tool schemas and few-shots must stay byte-stable across turns.",
      });

      // 2) 监听 system-prompt/assemble 瀑布：透传并守护前缀
      const onAssemble = async (
        _assembly: unknown,
        _context: unknown,
        next: () => Promise<unknown>,
      ): Promise<unknown> => {
        const out = (await next()) as PromptAssembly;
        const key = "default";
        const fp = prefixFingerprint(out);
        const previous = store.getPrefix(key);
        if (previous !== undefined && previous !== fp) {
          const accepted = onDrift?.(key, previous, fp);
          if (opts.compactOnDrift && !accepted) {
            ctx.compaction?.request(key as never, "reasonix:cache-prefix drifted");
          }
        }
        store.setPrefix(key, fp);
        return out;
      };
      ctx.on("system-prompt/assemble", onAssemble as (...args: unknown[]) => unknown);

      return () => {
        disposeSection();
      };
    },
  };
}
