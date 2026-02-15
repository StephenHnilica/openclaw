You are Codex. Your task is to DESIGN and IMPLEMENT OpenClaw plugins correctly.

Treat this document as the ground-truth contract for OpenClaw plugins. Do not invent APIs. If you’re unsure about a method name, locate it in the OpenClaw docs or in the installed OpenClaw codebase (node_modules) before writing code.

# Authoritative docs (use these first)

- Plugins: https://docs.openclaw.ai/plugins
- Plugin manifest (openclaw.plugin.json): https://docs.openclaw.ai/plugins/manifest
- Plugin agent tools: https://docs.openclaw.ai/plugins/agent-tools
- Agent loop + hook points: https://docs.openclaw.ai/concepts/agent-loop
- Hooks (Gateway hooks): https://docs.openclaw.ai/automation/hooks
- CLI plugin management: https://docs.openclaw.ai/cli/plugins
- Example plugin docs (Voice Call): https://docs.openclaw.ai/plugins/voice-call
- Example plugin docs (Zalo Personal channel plugin): https://docs.openclaw.ai/plugins/zalouser

──────────────────────────────────────────────────────────────────────────────

## 1) Concepts: “skills” vs “hooks” vs “plugins”

OpenClaw has multiple extension mechanisms. Pick the right one:

### A) Skill (SKILL.md)

- A skill is documentation/instructions for the LLM on how to use tools or follow a procedure.
- Skills are NOT executable code. They can be installed/published separately (ClawHub is the public skill registry).
- A plugin can ship skills by listing skill directories in its plugin manifest and/or by keeping skills in repo under skills/<name>/SKILL.md.

### B) Hook (Gateway hook pack)

- Hooks are small TypeScript scripts triggered by events like /new, /reset, /stop, agent:bootstrap, gateway startup, etc.
- Hooks are discovered from hook directories and enabled via config/CLI.
- Hook structure: a directory with HOOK.md (YAML frontmatter + docs) and handler.ts (exports HookHandler).
- Hooks run inside the Gateway when events fire.
- Plugins can also bundle hooks (plugin-managed hooks) without separate hook pack installs.

### C) Plugin (Gateway extension)

A plugin is executable TypeScript loaded into the Gateway process (in-process).
Plugins can register:

- Agent tools (LLM-callable tools)
- Gateway RPC methods
- CLI commands (openclaw <yourcmd> ...)
- Auto-reply “slash commands” that bypass the LLM (processed before built-ins and before the agent)
- Background services (start/stop lifecycle)
- Messaging channels (new chat surfaces; config under channels.<id>)
- Model providers/auth flows (for `openclaw models auth login ...`)
- Hooks (bundled hook packs, plus “plugin hooks” inside the agent loop/gateway pipeline)

──────────────────────────────────────────────────────────────────────────────

## 2) What plugins CAN do (capabilities)

✅ Add LLM-callable tools

- Register JSON-schema tools exposed to the agent during runs.
- Tools can be required (always available) or optional (explicit opt-in).
- Tool availability is controlled by allow/deny policy at global tools config and per-agent tools config.

✅ Add “auto-reply commands” (slash commands that bypass the LLM)

- Use when you want deterministic behavior: status, toggles, small actions.
- These commands are processed before built-in commands and before the AI agent.
- They’re global across channels.

✅ Add Gateway RPC methods

- A plugin can expose RPC endpoints callable via the Gateway.

✅ Add top-level CLI commands

- A plugin can add commands to the CLI (openclaw <cmd> ...).

✅ Run background services

- Start background loops/daemons inside Gateway process lifetime.

✅ Add model provider auth flows

- Register providers and auth methods (OAuth, API key, device code, etc.) for `openclaw models auth login ...`.

✅ Add new messaging channels (new chat surfaces)

- Implement a channel plugin contract and register it.
- Channel config lives under channels.<id> and is validated by the channel plugin code.
- Channel IDs should be declared in the plugin manifest so config validation accepts channels.<id> keys.

✅ Bundle hooks inside a plugin

- Plugin can register hook directories (HOOK.md + handler.ts) from within plugin code.
- Plugin-managed hooks show up as plugin:<id> in hook listings; they can’t be enabled/disabled individually via openclaw hooks CLI—enable/disable the plugin instead.

✅ Intercept the agent loop via “plugin hooks”

OpenClaw supports “plugin hooks” that run inside the agent loop and gateway pipeline. Hook names include:

- before_agent_start
- agent_end
- before_compaction / after_compaction
- before_tool_call / after_tool_call
- tool_result_persist (must be synchronous; transform tool results before transcript persistence)
- message_received / message_sending / message_sent
- session_start / session_end
- gateway_start / gateway_stop

IMPORTANT: The docs list these hook names and semantics, but the exact registration API may live in openclaw/plugin-sdk or core types. DO NOT GUESS the function name; locate it in installed code or official examples.

──────────────────────────────────────────────────────────────────────────────

## 3) What plugins CANNOT do / hard constraints / gotchas

🚫 Plugins are NOT sandboxed by default

- Plugins run in-process with the Gateway. Treat them as trusted code only.
- Installing a plugin is like running code on your Gateway host.

🚫 Plugin installs from npm are “registry-only”

- Plugin install specs are npm registry packages (name + optional version/tag). Git/URL/file specs are rejected for npm installs.
- You can install from local path/tar/zip; but “npm spec” installs are registry-only.

🚫 Manifest + schema are mandatory

- Every plugin MUST include openclaw.plugin.json in the plugin root.
- It MUST include an inline JSON Schema (configSchema), even if empty.
- Config validation uses manifest/schema WITHOUT executing plugin code.
- Missing/invalid manifest/schema blocks config validation and the plugin won’t load.

🚫 Config changes require Gateway restart

- Changing plugins.entries.\* or plugin config requires restarting the Gateway to apply.

🚫 Unknown ids are validation errors

- Unknown plugin ids referenced in config (plugins.entries / allow / deny / slots) are errors.
- Unknown channels.<id> keys are errors unless the channel id is declared in a plugin manifest.

🚫 Command limitations

- Reserved command names cannot be overridden by plugins.
- Duplicate command registration across plugins fails with a diagnostic error.
- Command names are case-insensitive and must match allowed characters.

🚫 Tool naming conflicts are skipped

- Tool names must not clash with core tool names; conflicts are skipped.
- Plugin ids used in tool allowlists must not clash with core tool names.

🚫 Native-module / postinstall caveat

- openclaw plugins install uses npm install --ignore-scripts (no lifecycle scripts).
- Avoid dependencies requiring postinstall builds (native modules). If unavoidable, document explicit build steps (e.g., pnpm allow-build-scripts, pnpm rebuild).

🚫 Plugin-managed hooks can’t be toggled via openclaw hooks

- If hooks are bundled/managed by a plugin, you enable/disable them by enabling/disabling the plugin, not via hook CLI.

──────────────────────────────────────────────────────────────────────────────

## 4) Discovery & precedence (how OpenClaw finds plugins)

OpenClaw scans in this order (higher wins):

1. Config paths: plugins.load.paths (file or directory)
2. Workspace extensions:
   <workspace>/.openclaw/extensions/_.ts
   <workspace>/.openclaw/extensions/_/index.ts
3. Global extensions:
   ~/.openclaw/extensions/_.ts
   ~/.openclaw/extensions/_/index.ts
4. Bundled extensions (ship with OpenClaw; disabled by default):
   <openclaw>/extensions/\*

If multiple plugins resolve to the same id, the first match wins; lower-precedence copies are ignored.

──────────────────────────────────────────────────────────────────────────────

## 5) Required files and recommended plugin skeleton

Minimal plugin (local dev):
my-plugin/
openclaw.plugin.json
index.ts (or src/index.ts with pack entry)
package.json (optional but recommended if you have deps)

Recommended publishable plugin:
my-plugin/
openclaw.plugin.json
package.json (must include openclaw.extensions)
src/
index.ts
skills/
my-skill/
SKILL.md (optional)
hooks/
my-hook/
HOOK.md
handler.ts (optional)
README.md
tsconfig.json / build config
dist/ (built JS output for publish, if you compile)

### openclaw.plugin.json (required)

- Required keys: id, configSchema
- Optional: kind, channels, providers, skills, name, description, uiHints, version

Example:

{
"id": "my-plugin",
"name": "My Plugin",
"description": "Short summary",
"channels": ["acmechat"],
"providers": ["acme"],
"skills": ["skills/my-skill"],
"configSchema": {
"type": "object",
"additionalProperties": false,
"properties": {
"apiKey": { "type": "string" },
"region": { "type": "string" }
},
"required": ["apiKey"]
},
"uiHints": {
"apiKey": { "label": "API Key", "sensitive": true },
"region": { "label": "Region", "placeholder": "us-east-1" }
}
}

### package.json for publish (openclaw.extensions contract)

Example:

{
"name": "@yourscope/my-plugin",
"version": "0.1.0",
"type": "module",
"openclaw": {
"extensions": ["./dist/index.js"]
}
}

Notes:

- Entry files can be .js or .ts (OpenClaw loads TS at runtime via jiti, but publishable plugins usually point to dist JS).
- openclaw plugins install <npm-spec> uses npm pack, extracts into ~/.openclaw/extensions/<id>/, and enables it in config.

──────────────────────────────────────────────────────────────────────────────

## 6) Plugin module shapes (how code is exported)

Plugins export either:

A) A default function: (api) => { ... }
B) An object: { id, name, configSchema, register(api) { ... } }

Choose A for simplicity. Choose B when you want metadata co-located in code (still must ship openclaw.plugin.json for config validation).

──────────────────────────────────────────────────────────────────────────────

## 7) Core API patterns (examples from official docs)

### 7.1 Register an agent tool (LLM-callable)

- Use registerTool({ name, description, parameters, execute })
- Tools can be optional: registerTool(toolDef, { optional: true })
- Optional tools are never auto-enabled; user must allowlist them.

Example tool:

import { Type } from "@sinclair/typebox";

export default function (api) {
api.registerTool({
name: "my_tool",
description: "Do a thing",
parameters: Type.Object({
input: Type.String(),
}),
async execute(\_id, params) {
return { content: [{ type: "text", text: params.input }] };
},
});
}

### 7.2 Register an auto-reply slash command (bypass the LLM)

Use when you want deterministic behavior without invoking the agent.

export default function (api) {
api.registerCommand({
name: "mystatus",
description: "Show plugin status",
handler: (ctx) => ({ text: `Plugin is running! Channel: ${ctx.channel}` }),
});
}

Constraints:

- Runs before built-in commands and before the AI agent.
- Reserved command names cannot be overridden.
- Duplicate command registration across plugins fails.

### 7.3 Register a Gateway RPC method

export default function (api) {
api.registerGatewayMethod("myplugin.status", ({ respond }) => {
respond(true, { ok: true });
});
}

Naming: pluginId.action (example voicecall.status)

### 7.4 Register CLI commands

export default function (api) {
api.registerCli(
({ program }) => {
program.command("mycmd").action(() => console.log("Hello"));
},
{ commands: ["mycmd"] },
);
}

### 7.5 Register a background service

export default function (api) {
api.registerService({
id: "my-service",
start: () => api.logger.info("ready"),
stop: () => api.logger.info("bye"),
});
}

### 7.6 Register a provider (model auth flows)

Use api.registerProvider({ id, label, auth:[...] }) to support:
openclaw models auth login --provider <id> [--method <id>]

Provider auth methods can run OAuth/API key/device code flows and return profiles + optional configPatch + defaultModel.
(Use official docs as reference; do not guess shape beyond docs.)

### 7.7 Register a messaging channel

- Channel config lives under channels.<id> (NOT plugins.entries).
- Include channels:["<id>"] in openclaw.plugin.json so config validation accepts channels.<id> keys.

Example:

const plugin = {
id: "acmechat",
meta: { id:"acmechat", label:"AcmeChat", selectionLabel:"AcmeChat (API)", docsPath:"/channels/acmechat", blurb:"demo channel plugin.", aliases:["acme"] },
capabilities: { chatTypes: ["direct"] },
config: {
listAccountIds: (cfg) => Object.keys(cfg.channels?.acmechat?.accounts ?? {}),
resolveAccount: (cfg, accountId) => cfg.channels?.acmechat?.accounts?.[accountId ?? "default"] ?? { accountId },
},
outbound: {
deliveryMode: "direct",
sendText: async ({ text }) => ({ ok: true }),
},
};

export default function (api) {
api.registerChannel({ plugin });
}

Optional channel adapters include setup wizard, security (dmPolicy/pairing), status probes, gateway login/start, threading, streaming, message actions, etc.

### 7.8 Runtime helpers

Plugins can access selected helpers via api.runtime (example: telephony TTS helper exists in core).

──────────────────────────────────────────────────────────────────────────────

## 8) Hooks: bundling hooks inside a plugin vs agent-loop “plugin hooks”

### 8.1 Bundling normal hook packs inside a plugin

You can bundle hook directories and register them at runtime:

import { registerPluginHooksFromDir } from "openclaw/plugin-sdk";
export default function register(api) {
registerPluginHooksFromDir(api, "./hooks");
}

- Hook directories must follow HOOK.md + handler.ts (or index.ts).
- Eligibility rules still apply (bins/env/config/OS requirements).
- Plugin-managed hooks show as plugin:<id> and can’t be toggled via openclaw hooks CLI.

### 8.2 Agent-loop “plugin hooks” (deep interception)

OpenClaw’s agent loop supports plugin hooks with these names (see agent-loop docs):

- before_agent_start (inject context / override system prompt)
- agent_end (inspect final messages + metadata)
- before_compaction / after_compaction
- before_tool_call / after_tool_call
- tool_result_persist (must be synchronous; transform before persistence)
- message_received / message_sending / message_sent
- session_start / session_end
- gateway_start / gateway_stop

IMPORTANT:

- The docs guarantee these hook points exist and what they do.
- The docs do NOT fully show the registration function on the plugin page.

Action for you (Codex): find the hook registration API in installed OpenClaw sources:

- Search node_modules/openclaw (or the OpenClaw repo) for “before_agent_start” or “plugin hooks” types.
- Implement hooks using the official types; do not invent a new API.

──────────────────────────────────────────────────────────────────────────────

## 9) Operational rules (dev loop)

- Use openclaw plugins install -l ./my-plugin for local dev (link, no copy), then restart Gateway.
- Always include openclaw.plugin.json in root.
- Keep dependency trees “pure JS/TS” (avoid postinstall/native builds), because installs use npm install --ignore-scripts.
- Prefer optional tools for side-effectful actions and require explicit allowlisting.
- Prefer plugins.allow allowlists in config for safety.
- When adding a channel plugin: declare its id in manifest (channels: ["..."]) or config validation will reject channels.<id>.
- Validate that commands/tools don’t conflict with core names.
- Ship tests (Vitest in-repo, or your own CI in standalone plugin).

──────────────────────────────────────────────────────────────────────────────

## 10) “Complex plugin” pattern to emulate (Voice Call plugin)

Voice Call demonstrates a real multi-surface plugin:

- Runs inside Gateway process
- Adds CLI namespace: openclaw voicecall ...
- Adds LLM tool: voice_call (actions: initiate_call, continue_call, speak_to_user, end_call, get_status)
- Adds Gateway RPC methods: voicecall.initiate/continue/speak/end/status
- Uses plugin config under plugins.entries.voice-call.config
- Exposes webhook server configuration (port/path), plus security allowlists for forwarded headers/proxies, plus TTS integration with core messages.tts.

Use it as a reference when designing “complex” plugins (service + tool + CLI + RPC + config + security).

──────────────────────────────────────────────────────────────────────────────

## Output requirements when you implement a plugin

When you create/modify plugin code, always produce:

1. openclaw.plugin.json (valid JSON Schema; no unknown properties; additionalProperties false unless intended)
2. entry file(s) referenced by openclaw.extensions (if publishable) or a single entry file if local extension
3. minimal README (install, config, enablement, tool/command names, security notes)
4. one example config snippet showing where config belongs:
   - plugins.entries.<id>.config for plugin config
   - channels.<id> for channel config
   - tools/agents allowlists for optional tools
5. restart requirement callout
6. tests or at least a test plan (smoke steps + commands)

END.
