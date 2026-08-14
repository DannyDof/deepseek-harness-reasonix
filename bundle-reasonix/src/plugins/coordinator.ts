import type { ContentBlock, ContextLike, ModelSelection, SubagentResult } from "../dsh";

/**
 * 双模型 Coordinator（方案 4.2.4），对齐真实 ctx.subagents 子 Agent 接缝：
 * - planner 作为低频次 one-shot 子 Agent，经 outputSchema 产出结构化计划；
 * - executor 作为完整工具使用子 Agent，依据计划执行；
 * - 二者经 installModelSelection（真实 seam）绑定各自模型。
 * M2 独立类型编译；M3 集成时 parent 为真实 Agent。
 */

export interface CoordinatorConfig {
  provider?: "spawn" | "fork";
  plannerModel?: string;
  executorModel?: string;
  reasoningEffort?: "off" | "high" | "max";
  maxDepth?: number;
  planApproval?: boolean;
  /** planner 输出 schema（结构化计划） */
  planSchema?: Record<string, unknown>;
}

export const DEFAULT_COORDINATOR_CONFIG: Required<Pick<CoordinatorConfig, "provider" | "maxDepth" | "planApproval">> = {
  provider: "spawn",
  maxDepth: 1,
  planApproval: false,
};

export const DEFAULT_PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    goal: { type: "string" },
    steps: { type: "array", items: { type: "string" } },
    constraints: { type: "array", items: { type: "string" } },
  },
  required: ["goal", "steps"],
};

export interface CoordinatorPlan {
  goal?: string;
  steps?: string[];
  constraints?: string[];
}

export interface CoordinatorResult {
  planText: string;
  planStructured: unknown;
  resultText: string;
  stopReason: SubagentResult["stopReason"];
}

export function textBlock(text: string): ContentBlock {
  return { type: "text", text };
}

export function finalText(output: readonly ContentBlock[] | unknown): string {
  if (!Array.isArray(output)) return "";
  let s = "";
  for (const b of output) {
    const c = b as ContentBlock;
    if (c.type === "text" && c.text) s += c.text;
  }
  return s;
}

function renderPlan(structured: unknown): string {
  if (!structured || typeof structured !== "object") return "";
  const p = structured as CoordinatorPlan;
  const steps = (p.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join("\n");
  const constraints = (p.constraints ?? []).map((c) => `- ${c}`).join("\n");
  return [`Goal: ${p.goal ?? ""}`, steps ? `Steps:\n${steps}` : "", constraints ? `Constraints:\n${constraints}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

export class Coordinator {
  constructor(
    private readonly ctx: ContextLike,
    private readonly config: CoordinatorConfig = {},
  ) {}

  plannerSelection(): ModelSelection {
    return {
      provider: "deepseek-official",
      model: this.config.plannerModel ?? "deepseek-v4-pro",
      reasoningEffort: this.config.reasoningEffort ?? "high",
    };
  }

  executorSelection(): ModelSelection {
    return {
      provider: "deepseek-official",
      model: this.config.executorModel ?? "deepseek-v4-flash",
      reasoningEffort: this.config.reasoningEffort ?? "high",
    };
  }

  /** 规划 + 执行：planner 子 Agent 产出结构化计划，executor 子 Agent 依计划执行。 */
  async planAndExecute(
    task: string,
    options: { parent?: unknown; signal?: AbortSignal } = {},
  ): Promise<CoordinatorResult> {
    const signal = options.signal ?? new AbortController().signal;
    const provider = this.config.provider ?? DEFAULT_COORDINATOR_CONFIG.provider;
    const maxDepth = this.config.maxDepth ?? DEFAULT_COORDINATOR_CONFIG.maxDepth;
    const planSchema = this.config.planSchema ?? DEFAULT_PLAN_SCHEMA;

    const planRun = await this.ctx.subagents.start(provider, {
      label: "reasonix-planner",
      prompt: [textBlock(`Draft a concise plan for the following task:\n\n${task}`)],
      parent: options.parent,
      signal,
      outputSchema: planSchema,
      maxDepth,
      agentOptions: {
        provider: this.plannerSelection().provider,
        model: this.plannerSelection().model,
      },
    });

    const plan = await planRun.result;
    const planText = renderPlan(plan.structured) || finalText(plan.output);

    const execRun = await this.ctx.subagents.start(provider, {
      label: "reasonix-executor",
      prompt: [textBlock(`Task:\n${task}\n\nPlan:\n${planText}`)],
      parent: options.parent,
      signal,
      maxDepth,
      agentOptions: {
        provider: this.executorSelection().provider,
        model: this.executorSelection().model,
      },
    });

    const exec = await execRun.result;
    await execRun.dispose().catch(() => void 0);

    return {
      planText,
      planStructured: plan.structured,
      resultText: finalText(exec.output),
      stopReason: exec.stopReason,
    };
  }
}

/** 便捷构造：以 ctx + 配置创建 Coordinator。 */
export function createCoordinator(ctx: ContextLike, config: CoordinatorConfig = {}): Coordinator {
  return new Coordinator(ctx, config);
}
