import type { ContextLike, PromptAssembly } from "../dsh";

/**
 * 缓存优先插件（方案 4.2.1），对齐真实接缝：
 * - ctx.systemPrompt.section()：注册字节稳定的不可变前缀段；
 * - system-prompt/assemble 瀑布：捕获前缀指纹，漂移时触发压缩而非重排。
 * M2 以独立类型编译；M3 集成时经 register() 挂到真实 ctx。
 */

export interface CacheFirstOptions {
  /** 不可变前缀段 order 集合（dsh 语义：-100 identity / 0 persona / 100-199 tool guidance） */
  immutableOrders?: number[];
  /** 指纹统计上限 order（默认 199：工具指引区之后为动态内容） */
  maxPrefixOrder?: number;
  /** 前缀漂移时是否请求压缩（默认 true） */
  compactOnDrift?: boolean;
}

export const DEFAULT_CACHE_FIRST_OPTIONS: Required<CacheFirstOptions> = {
  immutableOrders: [-100, 0, 100, 199],
  maxPrefixOrder: 199,
  compactOnDrift: true,
};

/** 会话级前缀状态存储（M2 内存实现；M3 可挂 session 检查点） */
export interface CacheStateStore {
  getPrefix(key: string): string | undefined;
  setPrefix(key: string, fingerprint: string): void;
}

/** 计算"不可变前缀区"指纹：仅统计 order <= maxPrefixOrder 的段，保证字节可比 */
export function prefixFingerprint(assembly: PromptAssembly, maxPrefixOrder = DEFAULT_CACHE_FIRST_OPTIONS.maxPrefixOrder): string {
  const prefix = assembly.sections
    .filter((s) => s.order <= maxPrefixOrder)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((s) => `${s.order}:${s.name}:${s.text}`);
  return JSON.stringify(prefix);
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
      return prefixFingerprint(assembly, opts.maxPrefixOrder);
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
        const fp = this.prefixFingerprint(out);
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
