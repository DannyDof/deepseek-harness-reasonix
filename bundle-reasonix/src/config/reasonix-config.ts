import { resolveDeepSeekAdapterConfig, DeepSeekAdapterConfig, ReasonixModelTier } from "../llm/deepseek";

/**
 * 配置兼容（方案 6.1 + M4）：reasonix.toml -> dsh profile。
 * - 解析 reasonix.toml 子集（平铺键 + [section] + [[array-of-tables]]）；
 * - 映射为 dsh profile 配置（agent-default-model / llm-deepseek / system-prompt /
 *   approval / tools / coordinator / mcp_servers）；
 * - 渲染为 cordis.patch.yml 文本，可直接落地到 reasonix.profile。
 */

export interface McpServer {
  name: string;
  command: string;
  args: string[];
}

/** reasonix.toml 本方案消费子集 */
export interface ReasonixConfig {
  default_model?: ReasonixModelTier;
  planner_model?: ReasonixModelTier;
  api_key_env?: string;
  base_url?: string;
  thinking?: "enabled" | "disabled";
  reasoning_effort?: "off" | "high" | "max";
  max_tokens?: number;
  default_context_window?: number;
  max_tool_output_bytes?: number;
  tool_result_snip_ratio?: number;
  permission_rules?: "ask" | "never";
  mcp_servers?: McpServer[];
}

export const REASONIX_DEFAULTS: Required<Pick<ReasonixConfig,
  "default_model" | "planner_model" | "max_tool_output_bytes" | "tool_result_snip_ratio" | "permission_rules">> = {
  default_model: "flash",
  planner_model: "pro",
  max_tool_output_bytes: 256_000,
  tool_result_snip_ratio: 0.5,
  permission_rules: "ask",
};

/** 映射后的 dsh profile 配置 */
export interface ReasonixProfileConfig {
  agentDefaultModel: { provider: string; model: string; reasoningEffort: string };
  llmDeepseek: DeepSeekAdapterConfig;
  systemPrompt: { persona: string };
  approvalPolicy: "ask" | "never";
  tools: { maxToolOutputBytes: number };
  repair: { truncation: { thresholdChars: number } };
  coordinator: { provider: string; plannerModel: string; executorModel: string; maxDepth: number };
  mcpServers: McpServer[];
}

function modelIdOf(tier: ReasonixModelTier): string {
  return tier === "pro" ? "deepseek-v4-pro" : "deepseek-v4-flash";
}

/** reasonix.toml -> dsh profile 配置 */
export function resolveProfileConfig(cfg: ReasonixConfig): ReasonixProfileConfig {
  const defaults = REASONIX_DEFAULTS;
  const defaultModel = cfg.default_model ?? defaults.default_model;
  const plannerModel = cfg.planner_model ?? defaults.planner_model;
  const adapter = resolveDeepSeekAdapterConfig({
    default_model: defaultModel,
    apiKeyEnv: cfg.api_key_env,
    baseURL: cfg.base_url,
    thinking: cfg.thinking,
    reasoningEffort: cfg.reasoning_effort,
    maxTokens: cfg.max_tokens,
    defaultContextWindow: cfg.default_context_window,
  });

  return {
    agentDefaultModel: {
      provider: "deepseek-official",
      model: modelIdOf(defaultModel),
      reasoningEffort: cfg.reasoning_effort ?? "high",
    },
    llmDeepseek: adapter,
    systemPrompt: {
      persona: "You are Reasonix, a coding agent powered by the {{model}} model. Working directory: {{cwd}}.",
    },
    approvalPolicy: cfg.permission_rules ?? defaults.permission_rules,
    tools: { maxToolOutputBytes: cfg.max_tool_output_bytes ?? defaults.max_tool_output_bytes },
    repair: {
      truncation: { thresholdChars: cfg.max_tool_output_bytes ?? defaults.max_tool_output_bytes },
    },
    coordinator: {
      provider: "spawn",
      plannerModel: modelIdOf(plannerModel),
      executorModel: modelIdOf(defaultModel),
      maxDepth: 1,
    },
    mcpServers: cfg.mcp_servers ?? [],
  };
}

/** 渲染 cordis.patch.yml 文本 */
export function renderCordisPatch(profile: ReasonixProfileConfig): string {
  const lines: string[] = [];
  lines.push("# 由 reasonix.toml 生成（M4 配置兼容）");
  lines.push("");
  lines.push("- id: agent-default-model");
  lines.push("  config:");
  lines.push(`    provider: ${profile.agentDefaultModel.provider}`);
  lines.push(`    model: ${profile.agentDefaultModel.model}`);
  lines.push(`    reasoningEffort: ${profile.agentDefaultModel.reasoningEffort}`);
  lines.push("");
  lines.push("- id: system-prompt");
  lines.push("  config:");
  lines.push(`    persona: >-`);
  lines.push(`      ${profile.systemPrompt.persona}`);
  lines.push("");
  lines.push("- id: llm-deepseek");
  lines.push("  config:");
  const llm = profile.llmDeepseek;
  lines.push(`    apiKeyEnv: ${llm.apiKeyEnv ?? "DEEPSEEK_API_KEY"}`);
  if (llm.baseURL) lines.push(`    baseURL: ${llm.baseURL}`);
  lines.push(`    thinking: ${llm.thinking ?? "enabled"}`);
  lines.push(`    reasoningEffort: ${llm.reasoningEffort ?? "high"}`);
  lines.push(`    maxTokens: ${llm.maxTokens ?? 256000}`);
  lines.push(`    defaultContextWindow: ${llm.defaultContextWindow ?? 1000000}`);
  lines.push("");
  lines.push("- id: approval");
  lines.push("  config:");
  lines.push(`    policy: ${profile.approvalPolicy}`);
  lines.push("");
  lines.push("- insert:");
  lines.push("    - id: reasonix-cache-first");
  lines.push("      name: '@reasonix/dsh-bundle-reasonix/cache-first'");
  lines.push("      inject: [systemPrompt, sessions, agentLoop]");
  lines.push("");
  lines.push("    - id: reasonix-repair");
  lines.push("      name: '@reasonix/dsh-bundle-reasonix/repair'");
  lines.push("      inject: [tools]");
  lines.push("      config:");
  lines.push("        truncation:");
  lines.push(`          thresholdChars: ${profile.repair.truncation.thresholdChars}`);
  lines.push("");
  lines.push("    - id: reasonix-coordinator");
  lines.push("      name: '@reasonix/dsh-bundle-reasonix/coordinator'");
  lines.push("      inject: [subagents, agents]");
  lines.push("      config:");
  lines.push(`        provider: ${profile.coordinator.provider}`);
  lines.push(`        plannerModel: ${profile.coordinator.plannerModel}`);
  lines.push(`        executorModel: ${profile.coordinator.executorModel}`);
  lines.push(`        maxDepth: ${profile.coordinator.maxDepth}`);
  for (const mcp of profile.mcpServers) {
    lines.push("");
    lines.push(`    - id: mcp-${mcp.name}`);
    lines.push("      name: '@deepseek-ai/dsh-mcp'");
    lines.push("      config:");
    lines.push(`        name: ${mcp.name}`);
    lines.push(`        command: ${mcp.command}`);
    lines.push(`        args: [${mcp.args.map((a) => JSON.stringify(a)).join(", ")}]`);
  }
  lines.push("");
  return lines.join("\n");
}

// ===== 极简 TOML 子集解析 =====

function parseValue(raw: string): unknown {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.startsWith("[")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((x) => parseValue(x.trim()));
  }
  const n = Number(v);
  if (Number.isFinite(n) && v !== "") return n;
  return v;
}

/** 解析 reasonix.toml 子集（平铺键 + [section] + [[array-of-tables]]）。 */
export function parseReasonixToml(text: string): ReasonixConfig {
  const root: Record<string, unknown> = {};
  let section: Record<string, unknown> = root;
  let arrayTable: Array<Record<string, unknown>> | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("[[") && line.endsWith("]]")) {
      const name = line.slice(2, -2).trim();
      const arr: Array<Record<string, unknown>> = [];
      root[name] = arr;
      const entry: Record<string, unknown> = {};
      arr.push(entry);
      section = entry;
      arrayTable = arr;
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      const name = line.slice(1, -1).trim();
      const sec: Record<string, unknown> = {};
      root[name] = sec;
      section = sec;
      arrayTable = null;
      continue;
    }

    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = parseValue(line.slice(eq + 1));
    if (arrayTable) section[key] = value;
    else section[key] = value;
  }

  return {
    default_model: (root.default_model as ReasonixModelTier) ?? undefined,
    planner_model: (root.planner_model as ReasonixModelTier) ?? undefined,
    api_key_env: (root.api_key_env as string) ?? undefined,
    base_url: (root.base_url as string) ?? undefined,
    thinking: (root.thinking as ReasonixConfig["thinking"]) ?? undefined,
    reasoning_effort: (root.reasoning_effort as ReasonixConfig["reasoning_effort"]) ?? undefined,
    max_tokens: (root.max_tokens as number) ?? undefined,
    default_context_window: (root.default_context_window as number) ?? undefined,
    max_tool_output_bytes: (root.max_tool_output_bytes as number) ?? undefined,
    tool_result_snip_ratio: (root.tool_result_snip_ratio as number) ?? undefined,
    permission_rules: (root.permission_rules as ReasonixConfig["permission_rules"]) ?? undefined,
    mcp_servers: (root.mcp_servers as McpServer[] | undefined) ?? undefined,
  };
}
