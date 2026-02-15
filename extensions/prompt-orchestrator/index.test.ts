import type { OpenClawPluginApi, PluginHookHandlerMap } from "openclaw/plugin-sdk";
import { describe, expect, it } from "vitest";
import register, { classifyExecutionMode } from "./index.js";

type HookStore = {
  beforeAgentStart?: PluginHookHandlerMap["before_agent_start"];
  beforeToolCall?: PluginHookHandlerMap["before_tool_call"];
};

function createApi(overrides: Partial<OpenClawPluginApi> = {}): {
  api: OpenClawPluginApi;
  hooks: HookStore;
} {
  const hooks: HookStore = {};
  const api: OpenClawPluginApi = {
    id: "prompt-orchestrator",
    name: "prompt-orchestrator",
    source: "test",
    config: {},
    pluginConfig: {},
    // oxlint-disable-next-line typescript/no-explicit-any
    runtime: {} as any,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerTool() {},
    registerHook() {},
    registerHttpHandler() {},
    registerHttpRoute() {},
    registerChannel() {},
    registerGatewayMethod() {},
    registerCli() {},
    registerService() {},
    registerProvider() {},
    registerCommand() {},
    on(hookName, handler) {
      if (hookName === "before_agent_start") {
        hooks.beforeAgentStart = handler;
      }
      if (hookName === "before_tool_call") {
        hooks.beforeToolCall = handler;
      }
    },
    resolvePath: (input) => input,
    ...overrides,
  };

  return { api, hooks };
}

describe("prompt-orchestrator routing", () => {
  it("keeps simple prompts in direct mode", () => {
    const result = classifyExecutionMode("Summarize this file", { complexityThreshold: 8 });
    expect(result.mode).toBe("direct");
  });

  it("routes high-complexity prompts to orchestrator", () => {
    const prompt =
      "Refactor auth flow across src/a.ts src/b.ts src/c.ts, then deploy and add rollback plan for production";
    const result = classifyExecutionMode(prompt, { complexityThreshold: 3 });
    expect(result.mode).toBe("orchestrator_delegate");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

describe("prompt-orchestrator hooks", () => {
  it("injects structured context and blocks risky tools without confirmation", () => {
    const { api, hooks } = createApi({
      pluginConfig: {
        complexityThreshold: 3,
        requireConfirmationForMutations: true,
        highRiskTools: ["exec"],
      },
    });

    register(api);

    const beforeAgentStart = hooks.beforeAgentStart;
    const beforeToolCall = hooks.beforeToolCall;

    expect(beforeAgentStart).toBeTruthy();
    expect(beforeToolCall).toBeTruthy();

    const result = beforeAgentStart?.(
      { prompt: "Refactor and deploy this service", messages: [] },
      { sessionKey: "s1" },
    );

    expect(result).toHaveProperty("prependContext");
    expect(result?.prependContext).toContain("execution_mode");

    const blocked = beforeToolCall?.(
      { toolName: "exec", params: { cmd: "rm -rf /tmp/x" } },
      { toolName: "exec", sessionKey: "s1" },
    );

    expect(blocked?.block).toBe(true);
  });
});
