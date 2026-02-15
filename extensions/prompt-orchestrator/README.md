# Prompt Orchestrator Plugin (MVP)

This plugin begins execution of the prompt-orchestrator plan with a plugin-first approach:

- composes compact structured prompt context in `before_agent_start`
- classifies requests into `direct`, `simple_delegate`, or `orchestrator_delegate`
- blocks high-risk tool calls by default unless `params.confirmed=true`
- trims persisted tool-result text for anti-bloat
- exposes `/prompt-improver run` for advisory recommendations
- runs a daily (configurable) advisory service logger

## Install (local workspace)

```bash
openclaw plugins install -l ./extensions/prompt-orchestrator
```

After enabling, restart the gateway for config/plugin changes to apply.

## Config

Plugin config belongs under:

- `plugins.entries.prompt-orchestrator.config`

Example:

```json
{
  "plugins": {
    "entries": {
      "prompt-orchestrator": {
        "enabled": true,
        "config": {
          "simpleDelegateAgentId": "simple-worker",
          "orchestratorAgentId": "orchestrator",
          "maxPromptChars": 1800,
          "maxMemoryChars": 600,
          "complexityThreshold": 8,
          "requireConfirmationForMutations": true,
          "highRiskTools": ["bash", "exec", "write", "edit", "delete", "patch", "rm"],
          "improver": {
            "mode": "advisory",
            "runEveryHours": 24,
            "allowedWritePaths": [
              "extensions/prompt-orchestrator/**",
              "heartbeat.md",
              ".learnings/**"
            ]
          }
        }
      }
    }
  }
}
```

Optional tool safety policy can be layered in core config allow/deny lists for stricter control.

## Command

- `/prompt-improver run` — emits a current advisory recommendation snapshot.

## Security notes

- Plugin runs in-process with Gateway.
- High-risk tools are blocked by default unless explicitly confirmed.
- Advisory mode does not auto-apply code changes.
