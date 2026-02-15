# Prompt Engineering Review: Telegram + CLI Message-to-Action Pipeline

## Scope

This review focuses on how inbound user messages from Telegram and ACP/CLI flows are transformed into model prompts and eventually tool calls.

## What the current pipeline gets right

- Telegram context already separates display envelope metadata (`Body`) from the model-facing raw user text (`BodyForAgent`).
- ACP/CLI supports prompt-to-chat routing with attachments and session binding.
- The system prompt contains explicit safety language and explicit tool inventory.
- Untrusted context can be appended with a warning label.

## Key problems observed

### 1. Prompt bloat and instruction density

The default system prompt packs many concerns (tooling, policy, messaging, safety, docs, update rules, runtime, workspace, sandbox, etc.) into one large static block. This increases cognitive load for weaker models and makes instruction priority less reliable.

### 2. Safety policy is mostly declarative, not procedural

Safety guidance is present, but mutating actions are not consistently forced through a compact "confirm plan before dangerous action" routine. Lower-capability models may skip safety intent checks when overloaded.

### 3. User message + context shaping is still high-noise in complex sessions

In `get-reply-run`, thread history, system events, media guidance, and untrusted context are concatenated into one prompt string. This can drown the user's actual request and increase instruction collisions.

### 4. ACP/CLI prefixing may add noisy context at the wrong layer

ACP prefixes `[Working directory: ...]` directly into the user message body. This is useful metadata but competes with user intent when models are weak.

### 5. The system lacks a strict action-gating preflight for dangerous edits

Current behavior relies on broad safety instructions and tool policies, but there is no mandatory, model-independent preflight stage that classifies risk before mutation.

## Recommended architecture changes (high impact)

## A. Introduce a two-stage "intent -> execution" prompt architecture

1. **Stage 1 (Intent Parse, short prompt):**
   - Produce a structured intent object:
     - goal
     - constraints
     - ambiguity flags
     - risk tier (`read_only`, `safe_write`, `dangerous_write`, `external_side_effect`)
   - No tool calls allowed in this stage.

2. **Stage 2 (Execution, constrained prompt):**
   - Feed only normalized intent + essential context.
   - Enforce risk-tier policy before tool invocation.

This reduces instruction overload and makes weaker models behave more predictably.

## B. Add deterministic risk preflight before mutating tools

Before `write/edit/apply_patch/exec` with mutating commands:

- Evaluate against a rule set outside the model (deterministic code path):
  - touches critical paths?
  - destructive shell pattern?
  - broad/glob deletes?
  - config/release/publish operations?
- If risky and user confirmation not explicit in current turn, require confirmation.

This should be enforced in runtime/tool middleware, not only in prompts.

## C. Build prompt profiles by model capability

Use a prompt budget strategy:

- **compact profile** for weaker/smaller models (Telegram default candidate)
- **full profile** for stronger models
- **surgical profile** for subagents

Keep non-critical sections out of compact mode (docs links, long CLI references, verbose tool narration policy).

## D. Structure context as typed blocks, not one concatenated text

Replace large stitched strings with explicit block roles:

- `user_message`
- `conversation_context`
- `system_events`
- `untrusted_context`
- `runtime_metadata`

Even if transport requires text, serialize with strict block delimiters and precedence notes so parsing is deterministic.

## E. Move channel metadata out of user message text where possible

For ACP/CLI and Telegram, prefer passing metadata as separate structured fields rather than inline text prefixes. The model should see user intent first.

## F. Add safety-specific regression tests for weak-model behavior

Create adversarial tests that emulate low-capability compliance failures:

- prompt injection in forwarded/quoted text
- ambiguous destructive requests
- mixed benign + dangerous instruction bundles
- conflicting context blocks (system event vs user command)

Gate releases on these tests for prompt/pipeline changes.

## Concrete implementation plan

1. **Prompt budgeting + profiles (fastest win)**
   - Add capability-aware prompt mode selection.
   - Start with compact mode for Telegram + ACP sessions using weaker models.

2. **Risk preflight middleware (safety win)**
   - Add deterministic gate before mutating tool execution.
   - Return confirmation request payload when blocked.

3. **Intent stage (quality win)**
   - Add optional first-pass parser (small schema output).
   - Execution stage consumes schema, not raw concatenated context.

4. **Context block refactor (stability win)**
   - Replace concatenated `prefixedCommandBody` assembly with block serializer.

5. **Eval harness (confidence win)**
   - Add replay tests from real Telegram/CLI transcripts + synthetic adversarial set.

## Suggested telemetry to validate improvements

Track before/after by channel and model:

- dangerous-action confirmation rate
- unintended mutation incidents
- tool-call misfire rate
- user correction turns per task
- first-pass success rate
- token count per successful task

## Expected outcomes

- Fewer dangerous edits from weaker models.
- Lower misinterpretation rate in noisy Telegram/CLI sessions.
- Better consistency under long-running sessions.
- Lower token cost for simple tasks.
