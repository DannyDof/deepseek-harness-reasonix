/**
 * 类型镜像保真校验（编译期）。
 *
 * 校验 bundle-reasonix/src/dsh.ts 的镜像类型与真实 @deepseek-ai/* 类型
 * 双向可赋值。带 branded id 的 ContentBlock / StreamChunk / GenerateOptions
 * 因 nominal branding 无法跨包结构断言，改由运行时 smoke 验证。
 *
 * 运行：npm run typecheck --workspace integration
 */
import type { TokenUsage as RTokenUsage, FinishReason as RFinishReason } from '@deepseek-ai/dsh-llm';
import type { PromptSection as RPromptSection, PromptAssembly as RPromptAssembly } from '@deepseek-ai/dsh-system-prompt';
import type { TokenUsage, FinishReason, PromptSection, PromptAssembly } from '../../bundle-reasonix/dist/dsh';

type Assert<T extends true> = T;
type Assignable<A, B> = [A] extends [B] ? true : false;

type _t1 = Assert<Assignable<RTokenUsage, TokenUsage>>;
type _t2 = Assert<Assignable<TokenUsage, RTokenUsage>>;
type _t3 = Assert<Assignable<RPromptSection, PromptSection>>;
type _t4 = Assert<Assignable<RPromptAssembly, PromptAssembly>>;
type _t5 = Assert<Assignable<RFinishReason, FinishReason>>;
type _t6 = Assert<Assignable<FinishReason, RFinishReason>>;

export const TYPES_MATCH: true = true;
