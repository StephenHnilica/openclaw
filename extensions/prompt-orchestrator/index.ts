import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

type PromptMode = "direct" | "simple_delegate" | "orchestrator_delegate";

type BeforeAgentStartEvent = {
  prompt: string;
  messages?: unknown[];
};

type BeforeAgentStartResult = {
  prependContext?: string;
  systemPrompt?: string;
};

type PromptOrchestratorConfig = {
  simpleDelegateAgentId?: string;
  orchestratorAgentId?: string;
  maxPromptChars?: number;
  maxMemoryChars?: number;
  complexityThreshold?: number;
  requireConfirmationForMutations?: boolean;
  highRiskTools?: string[];
  improver?: {
    runEveryHours?: number;
    mode?: "advisory" | "gated_apply";
    allowedWritePaths?: string[];
  };
};

type RoutingDecision = {
  mode: PromptMode;
  complexityScore: number;
  reasons: string[];
};

const DEFAULT_MAX_PROMPT_CHARS = 1800;
const DEFAULT_MAX_MEMORY_CHARS = 600;
const DEFAULT_COMPLEXITY_THRESHOLD = 8;
const DEFAULT_IMPROVER_HOURS = 24;
const DEFAULT_HIGH_RISK_TOOLS = ["bash", "exec", "write", "edit", "delete", "patch", "rm"];
const COMPLEXITY_KEYWORDS = [
  "refactor",
  "migration",
  "orchestrator",
  "rollback",
  "security",
  "release",
  "deploy",
  "multi-step",
  "complex",
  "dangerous",
  "production",
];

function clip(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxChars - 1))}…`;
}

function cleanText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function parseConfig(pluginConfig: OpenClawPluginApi["pluginConfig"]): PromptOrchestratorConfig {
  return (pluginConfig ?? {}) as PromptOrchestratorConfig;
}

function scoreComplexity(prompt: string): RoutingDecision {
  const normalized = prompt.toLowerCase();
  const reasons: string[] = [];
  let complexityScore = 0;

  const fileMentions = (normalized.match(/\b[a-z0-9_/-]+\.(ts|tsx|js|json|md|yml|yaml)\b/g) ?? [])
    .length;
  if (fileMentions >= 3) {
    complexityScore += 3;
    reasons.push("multi-file scope");
  }

  const stepCues = (normalized.match(/\b(first|then|after|finally|next)\b/g) ?? []).length;
  if (stepCues >= 3) {
    complexityScore += 2;
    reasons.push("multi-step sequencing");
  }

  for (const keyword of COMPLEXITY_KEYWORDS) {
    if (normalized.includes(keyword)) {
      complexityScore += 1;
      reasons.push(`keyword:${keyword}`);
    }
  }

  if (prompt.length > 900) {
    complexityScore += 2;
    reasons.push("long request");
  }

  return {
    mode: "direct",
    complexityScore,
    reasons,
  };
}

export function classifyExecutionMode(
  prompt: string,
  cfg: PromptOrchestratorConfig,
): RoutingDecision {
  const baseline = scoreComplexity(prompt);
  const threshold = cfg.complexityThreshold ?? DEFAULT_COMPLEXITY_THRESHOLD;

  if (baseline.complexityScore >= threshold + 4) {
    return { ...baseline, mode: "orchestrator_delegate" };
  }

  if (baseline.complexityScore >= threshold) {
    return { ...baseline, mode: "simple_delegate" };
  }

  return baseline;
}

function renderPromptEnvelope(
  event: BeforeAgentStartEvent,
  decision: RoutingDecision,
  cfg: PromptOrchestratorConfig,
): BeforeAgentStartResult {
  const maxPromptChars = cfg.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
  const maxMemoryChars = cfg.maxMemoryChars ?? DEFAULT_MAX_MEMORY_CHARS;
  const normalizedIntent = clip(cleanText(event.prompt ?? ""), Math.floor(maxPromptChars * 0.65));
  const memoryBudget = clip(
    "No SlimRAG memory retrieved yet. Plugin execution started with bounded context only.",
    maxMemoryChars,
  );

  const toolPolicy =
    cfg.requireConfirmationForMutations === false
      ? "risky tools allowed by plugin config"
      : "mutating/risky tools require params.confirmed=true";

  return {
    prependContext: [
      "[prompt_orchestrator]",
      `task_intent: ${normalizedIntent}`,
      "success_criteria: execute safely, minimize prompt bloat, keep outputs concise",
      "hard_constraints: follow repo policies; avoid risky mutations without confirmation",
      `risk_flags: ${decision.reasons.join(",") || "none"}`,
      `tool_policy: ${toolPolicy}`,
      `retrieved_memory: ${memoryBudget}`,
      `execution_mode: ${decision.mode}`,
      "[/prompt_orchestrator]",
    ].join("\n"),
  };
}

function isHighRiskTool(toolName: string, configuredNames: string[]): boolean {
  const normalized = toolName.toLowerCase();
  return configuredNames.some((token) => normalized.includes(token.toLowerCase()));
}

function buildAdvisory(cfg: PromptOrchestratorConfig): string {
  const mode = cfg.improver?.mode ?? "advisory";
  const cadenceHours = cfg.improver?.runEveryHours ?? DEFAULT_IMPROVER_HOURS;
  const allowedPaths = cfg.improver?.allowedWritePaths ?? [
    "extensions/prompt-orchestrator/**",
    "heartbeat.md",
    ".learnings/**",
  ];

  return [
    "Prompt improver advisory",
    `mode: ${mode}`,
    `cadence_hours: ${cadenceHours}`,
    `allowed_paths: ${allowedPaths.join(", ")}`,
    "recommendation: capture overflow incidents and tighten per-block prompt caps before broadening memory injection",
  ].join("\n");
}

export default function register(api: OpenClawPluginApi): void {
  const cfg = parseConfig(api.pluginConfig);
  const perSessionMode = new Map<string, PromptMode>();

  api.on("before_agent_start", (event, ctx) => {
    const decision = classifyExecutionMode(event.prompt ?? "", cfg);
    if (ctx.sessionKey) {
      perSessionMode.set(ctx.sessionKey, decision.mode);
    }
    return renderPromptEnvelope(event, decision, cfg);
  });

  api.on("before_tool_call", (event, ctx) => {
    const risky = isHighRiskTool(event.toolName, cfg.highRiskTools ?? DEFAULT_HIGH_RISK_TOOLS);
    if (!risky) {
      return;
    }

    const sessionMode = ctx.sessionKey ? perSessionMode.get(ctx.sessionKey) : undefined;
    if (
      sessionMode === "orchestrator_delegate" &&
      event.toolName.toLowerCase() !== "sessions_spawn"
    ) {
      return {
        block: true,
        blockReason:
          "prompt-orchestrator: high-risk action blocked in orchestrator_delegate mode; delegate execution via sessions_spawn",
      };
    }

    const confirmed = event.params.confirmed === true;
    if (cfg.requireConfirmationForMutations === false || confirmed) {
      return;
    }

    return {
      block: true,
      blockReason:
        "prompt-orchestrator: mutating/high-risk tool call requires params.confirmed=true or delegation",
    };
  });

  api.on("tool_result_persist", (event) => {
    const rawMessage = event.message as unknown as Record<string, unknown>;
    const content = rawMessage.content;
    if (!Array.isArray(content)) {
      return;
    }

    const nextContent = content.map((block) => {
      if (!block || typeof block !== "object") {
        return block;
      }
      const typed = block as Record<string, unknown>;
      if (typed.type !== "text" || typeof typed.text !== "string") {
        return block;
      }
      return { ...typed, text: clip(cleanText(typed.text), 600) };
    });

    return {
      message: {
        ...rawMessage,
        content: nextContent,
      } as typeof event.message,
    };
  });

  api.registerCommand({
    name: "prompt-improver",
    description: "Run or inspect prompt-orchestrator advisory recommendations",
    acceptsArgs: true,
    handler: (ctx) => {
      const args = (ctx.args ?? "").trim().toLowerCase();
      if (args === "run") {
        return { text: buildAdvisory(cfg) };
      }
      return {
        text: [
          "Usage: /prompt-improver run",
          "Runs the advisory recommendation generator for prompt-orchestrator.",
        ].join("\n"),
      };
    },
  });

  let advisoryTimer: ReturnType<typeof setInterval> | undefined;

  api.registerService({
    id: "prompt-orchestrator-improver",
    start: () => {
      const hours = cfg.improver?.runEveryHours ?? DEFAULT_IMPROVER_HOURS;
      const intervalMs = Math.max(1, hours) * 60 * 60 * 1000;
      advisoryTimer = setInterval(() => {
        api.logger.info(buildAdvisory(cfg));
      }, intervalMs);
      advisoryTimer.unref?.();
      api.logger.info(`prompt-orchestrator improver scheduled every ${hours}h`);
    },
    stop: () => {
      if (advisoryTimer) {
        clearInterval(advisoryTimer);
        advisoryTimer = undefined;
      }
      api.logger.info("prompt-orchestrator improver stopped");
    },
  });
}
