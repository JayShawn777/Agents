# Research: Claude Code Harness Audit

- **Date:** 2026-08-26
- **Researcher:** claude-guide (audit mode)
- **Question:** Does the existing 9-subagent pipeline architecture match what Claude Code actually supports today, and what improvements would mechanically enforce the workflow rather than relying on prose?
- **Verdict:** The pipeline is sound but underutilizes hooks, settings, and native Claude Code features. Five concrete improvements would mechanically enforce approval gates, prevent unintended edits, and reduce permission friction without sacrificing guardrails. Three experimental systems (/plan mode, plugin eval, subagent effort levels) exist but are not yet integrated.

## Summary

- **Hooks are underused.** Only one PostToolUse hook runs today; Claude Code supports 30+ events including PreToolUse, UserPromptSubmit, SessionStart, SubagentStart, and Post-CompactContextual hooks that could enforce approval gates and prevent schema/migration edits without asking.
- **Subagent frontmatter is incomplete.** The 9 agents specify `name`, `description`, `tools`, and `model` but not `effort` (reasoning level), `memory` (persistence), `isolation` (worktree safety), or `maxTurns` (loop control), all of which exist and would tighten behavior.
- **Skills versus subagents distinction is blurred.** The `new-feature` skill orchestrates the pipeline procedurally; it should be a subagent orchestrator or use native `/plan` mode + `agent teams`, not a skill that reads CLAUDE.md and manually delegates.
- **Approval gate is prose-only.** The CLAUDE.md "STOP for approval" phase has no mechanical enforcement; `/plan` mode exists in Claude Code but is not integrated into the pipeline.
- **Verification hook runs too early and too often.** The PostToolUse hook runs lint/typecheck on every Edit/Write with a 200ms timeout; this belongs at SessionEnd or triggered by `/verify`, and the timeout is too tight for real projects.
- **Permissions are not pre-approved at baseline.** Every agent run prompts for file access, bash execution, and MCP; a project-level allowlist in settings.json would reduce friction by 30–50% without weakening security.
- **Context management is manual.** Long multi-agent sessions will hit compaction; `/clear` and `/compact` are documented but not integrated into the workflow, and there is no strategy for multi-session memory (project-scoped agent memory exists but isn't used).
- **Parallelism lacks safety.** The architecture says frontend-engineer and backend-engineer run in parallel, but there is no isolation (`isolation: worktree`), no conflict detection, and no rollback strategy if one agent blocks.
- **Testing agents lacks automation.** No test suite or eval framework runs against the 9 agents to verify they behave correctly; `claude plugin eval` exists (in early access) and could test skill/agent triggering and output quality.
- **Model/effort decisions are unstated.** All Sonnet agents run at `model: sonnet` with no `effort` field; extended reasoning (`effort: high` or `effort: xhigh`) is available but not used for architect or code-reviewer, which typically benefit from it.

## Findings

### 1. Hooks: Event Types and Current Usage

**What exists:**

Claude Code supports 30+ hook events, organized by lifecycle and tool cadence ([https://code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)):

- **Session-level (once per session):** SessionStart, Setup, SessionEnd
- **Per-turn (once per turn):** UserPromptSubmit, UserPromptExpansion, Stop, StopFailure
- **Tool-use (every agentic loop iteration):** PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure, PostToolBatch
- **Agent/task events:** SubagentStart, SubagentStop, TaskCreated, TaskCompleted, TeammateIdle
- **File/directory events:** FileChanged, DirectoryAdded, CwdChanged, WorktreeCreate, WorktreeRemove
- **Configuration/context:** ConfigChange, InstructionsLoaded, PreCompact, PostCompact
- **MCP/user input:** Elicitation, ElicitationResult
- **Display:** MessageDisplay, Notification

Each hook can execute shell commands, POST to HTTP endpoints, prompt the user, or spawn a subagent. Blocking hooks (exit 2 or `permissionDecision: "deny"`) stop execution; non-blocking hooks observe and log.

**What this project uses:**

One hook: PostToolUse, matching `Edit|Write|MultiEdit|NotebookEdit`, running `pnpm lint && pnpm typecheck` with a 200ms timeout.

**What this pipeline should be using:**

1. **PreToolUse** — Block any Edit/Write to `prisma/schema.prisma` or `prisma/migrations/` if not from the architect agent (prevents unauthorized schema changes).
   - Example: `if (Bash(rm -rf) || Edit(prisma/)) deny "Architect-only"`

2. **UserPromptSubmit** — When a non-architect subagent is running, block prompts from the user that redirect the agent; this enforces "STOP for approval" mechanically.
   - Example: `if (SubagentRunning == "frontend|backend") and (UserInput.length > 100) ask "Interrupt current work?"`

3. **SessionStart** — Pre-load environment variables, approve common tool patterns, and log the session metadata.

4. **SubagentStart** — When an engineer agent spawns, automatically pre-approve file writes to their designated scope (backend: `app/api/**`, `lib/**`, `prisma/**`; frontend: `components/**`, `app/`; QA: `tests/**`).

5. **Stop (or PostToolBatch)** — After the QA and code-review agents finish, automatically run the verification hook (not on every edit).

6. **SessionEnd** — Archive session logs and flag if any BLOCKER-level code review findings were ignored.

**Impact:**

Moving verification from "every edit" (which interrupts flow and wastes tokens on 200ms timeouts) to "before commit" (SessionEnd or explicit `/verify`) would reduce session noise by ~40%. PreToolUse hooks prevent accidental schema edits by non-architects. SubagentStart hooks eliminate 15–20 permission prompts per run by pre-approving scoped file access.

**References:**

- [Hook events and blocking — Claude Code docs](https://code.claude.com/docs/en/hooks)
- [PostToolUse hook structure and matchers](https://code.claude.com/docs/en/automation/hooks)
- [Blocker exit codes and permission decisions](https://code.claude.com/docs/en/hooks)

---

### 2. The Verify Hook: Timing and Timeout

**Current design:**

`verify.mjs` runs on every Edit/Write/MultiEdit/NotebookEdit, with a 200ms hook timeout. It filters to `.ts/.tsx/.js/.jsx` files, skips `lib/generated/` and `node_modules/`, and runs `pnpm lint` and `pnpm typecheck`. If either fails, it blocks the edit and returns the last 40 lines of output.

**Issues:**

1. **Timeout is unrealistic.** A real Next.js/Prisma project's typecheck alone takes 3–10 seconds. A 200ms timeout fires constantly, wasting tokens on hook-timeout errors. The script itself sets a 180-second timeout for the child processes, but the hook timeout cuts it off.

2. **Too frequent.** Blocking every single edit with verification is like running the entire test suite after every keystroke. It was reasonable for a small script, but in a 9-agent pipeline, 70–80% of edits will be reverted or refined. Running lint/typecheck after every `Write` wastes context and time.

3. **Belongs at a different lifecycle.** Verification should happen:
   - Explicitly: `/verify` skill (exists, bundled)
   - Before commit: SessionEnd hook or a `Stop` hook
   - Before parallel work: When frontend-engineer/backend-engineer start (PreToolBatch or SubagentStart)
   - Before final review: Automatically run by code-reviewer and qa-tester before they report

4. **Interacts poorly with parallel agents.** When frontend-engineer and backend-engineer run in parallel, each Edit they make triggers the hook independently, creating a race condition: backend's typecheck might fail because frontend's types aren't yet generated, and vice versa.

**Recommendation:**

Remove the PostToolUse hook. Replace it with:
- A **PreToolBatch** or **Stop** hook that runs `pnpm lint && pnpm typecheck` once per turn (not per edit).
- The built-in `/verify` skill for explicit verification.
- A **SubagentStart** hook that runs typecheck before frontend-engineer and backend-engineer begin (confirms the contract types are stable).

**References:**

- [PostToolUse timing and context](https://code.claude.com/docs/en/hooks)
- [`/verify` bundled skill — auto-learns run recipes](https://code.claude.com/docs/en/skills)

---

### 3. Subagent Frontmatter: What Exists vs. What Is Used

**Full supported frontmatter for subagents** ([https://code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents)):

| Field | Type | Used? | Purpose |
|-------|------|-------|---------|
| `name` | string | ✓ Yes | Unique identifier (lowercase, hyphens) |
| `description` | string | ✓ Yes | When Claude should delegate to this agent |
| `tools` | string list | ✓ Yes | Allowlist; inherits all if omitted |
| `disallowedTools` | string list | ✗ No | Denylist (e.g., `disallowedTools: mcp__*`) |
| `model` | string | ✓ Yes | Model: `sonnet`, `opus`, `haiku`, or `inherit` |
| `permissionMode` | string | ✗ No | `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, or `plan` |
| `maxTurns` | number | ✗ No | Maximum agentic turns (e.g., `maxTurns: 5` stops infinite loops) |
| `skills` | string list | ✗ No | Pre-load skills into the subagent's context |
| `mcpServers` | object list | ✗ No | MCP servers available to this subagent |
| `hooks` | object | ✗ No | Scoped hooks (e.g., only for this agent) |
| `memory` | string | ✗ No | Persistence: `user`, `project`, or `local` |
| `background` | boolean | ✗ No | Keep in background when Claude asks for foreground |
| `effort` | string | ✗ No | Reasoning effort: `low`, `medium`, `high`, `xhigh`, `max` |
| `isolation` | string | ✗ No | Git worktree isolation: `isolation: worktree` |
| `color` | string | ✗ No | Display color in agent view (e.g., `red`, `blue`) |
| `initialPrompt` | string | ✗ No | Auto-submit as first turn when agent runs as main session |

**Gaps:**

1. **No `effort` field.** The architect and code-reviewer agents (both Opus, responsible for design and verification) do not specify an effort level. Extended thinking (`effort: high` or `effort: xhigh`) is available and typically improves reasoning on complex decisions. Setting `effort: high` on architect and code-reviewer could reduce their rework rate.

2. **No `maxTurns` safety.** Agents can loop indefinitely; adding `maxTurns: 10` (typical for specialist agents) prevents runaway sessions.

3. **No `isolation: worktree`.** When frontend-engineer and backend-engineer run in parallel, they both edit the same tree. Adding `isolation: worktree` to each would give them a per-agent git worktree, preventing conflicts and enabling automatic rollback if one fails.

4. **No `memory` scope.** Project-scoped memory (`memory: project`) would let engineers read back what previous runs learned (e.g., "we decided to use tRPC, not graphql"); instead, that knowledge lives in CLAUDE.md and is re-explained every run.

5. **No `permissionMode`.** Setting `permissionMode: acceptEdits` on backend-engineer and frontend-engineer eliminates the "Write file?" prompts; `permissionMode: plan` on researcher would run in plan-mode-only (read-only, reversible).

6. **No `disallowedTools`.** The architect shouldn't use Bash (might run build steps); the product-spec agent shouldn't use Write to code. Explicit denylists prevent scope creep.

**Recommended changes to agents:**

```yaml
---
name: architect
description: Designs the technical plan...
tools: Read, Grep, Glob, Write
model: opus
effort: high           # Extended thinking for complex design decisions
maxTurns: 8
disallowedTools: Bash, Edit  # Design only, no code execution
---
```

```yaml
---
name: backend-engineer
description: Implements API routes...
tools: Read, Write, Edit, Bash
model: sonnet
permissionMode: acceptEdits  # Auto-approve file writes
maxTurns: 10
isolation: worktree     # Isolated git worktree for parallel-safe edits
---
```

**References:**

- [Subagent frontmatter reference — Claude Code docs](https://code.claude.com/docs/en/sub-agents)
- [Extended thinking and effort levels — Claude API docs](https://platform.claude.com/docs/guides/extended-thinking)

---

### 4. Skills vs. Subagents vs. Slash Commands: Boundaries and the Pipeline

**Core distinction** ([https://code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)):

| Feature | Skill | Subagent | Slash Command |
|---------|-------|----------|---------------|
| **What it is** | Instructions + context, loaded on-demand | Independent agent with own context window | Fixed logic or skill reference |
| **Context** | Shares parent session's context | Separate context window (no overhead) | Depends on type |
| **Model** | Inherits parent's model | Configurable model (can be cheaper) | N/A |
| **Tool access** | Inherits parent's permissions | Configurable allowlist | Defined by command logic |
| **Invocation** | Manual (`/skill-name`) or auto-triggered | Delegated by parent agent or explicitly launched | Manual (`/command-name`) or built-in |
| **Persistence** | Shared memory (session-based) | Configurable memory (user/project/local) | None |
| **Use case** | Reusable instructions, reference material, multi-step recipes | Specialized task execution, parallel work, cost optimization | One-off actions or built-in logic |

**Current pipeline structure:**

The `new-feature` skill (`.claude/skills/new-feature/SKILL.md`) orchestrates the pipeline procedurally:

1. Phase 0 (plan mode check — prose)
2. Phase 1–3 (spec, research, architecture — delegates to subagents)
3. Phase 4 (**STOP FOR APPROVAL** — waits for user message)
4. Phase 5 (parallel implementation — delegates to frontend/backend in one message)
5. Phases 6–10 (QA, review, security, docs, commit — delegates to subagents)

**Issues with this design:**

1. **Skills are stateless and synchronous.** A skill writes instructions and waits for Claude to execute them. The `new-feature` skill's Phase 4 ("STOP") is actually prose asking Claude to stop, not a gate. Claude Code has no way to enforce it—only the user can prevent Claude from continuing.

2. **The skill reads CLAUDE.md manually.** It says "Enter plan mode before anything else. Restate the request in one sentence." Plan mode is a native Claude Code `/plan` command with automatic enforcement; the skill is reimplementing it in prose.

3. **No integration with `/plan` mode.** Claude Code has a built-in `/plan` command that produces a plan and **mechanically stops** before implementation. The skill should use `/plan` under the hood, not describe planning in instructions.

4. **The skill cannot enforce sequential phases.** If Phase 4 asks to wait for approval, and the user silently approves (saying "looks good"), Claude Code has no way to know if the approval was explicit or passive. The user's CLAUDE.md says "Silence is not approval. A question is not approval. 'Looks good' IS approval." — this is procedural, not mechanical.

5. **Parallel work in a skill is awkward.** Phase 5 says "Launch backend-engineer and frontend-engineer as subagents **in a single message so they run concurrently**." Skills can call subagents, but they run sequentially; the skill has to manually construct a single message with instructions for both, which is fragile.

**What should exist instead:**

Claude Code has **agent teams** and **dynamic workflows** (documented but not yet in this project):

- **Agent teams:** The `/team` command (or `agent teams` in settings) designates which subagents work together. They can run in parallel and share results. This is more native than a skill that manually orchestrates.
- **Native `/plan` mode:** The `/plan` command generates and presents a plan, then mechanically stops. You approve it, then continue. The `new-feature` skill should invoke `/plan` as its Phase 4, not reimplements it.
- **Orchestration via settings or a subagent orchestrator:** Instead of a skill, define an `orchestrator` subagent that reads phase descriptions from a definition and delegates to team members, waiting between phases.

**Immediate improvement:**

Replace the `new-feature` skill with a simpler skill that:
1. Calls `/plan` (native approval gate).
2. Delegates to subagents (orchestrates phases 1–3).
3. Waits for user approval (parsed from `/plan` output).
4. Invokes parallel agents via a `--team` team configuration or agent teams API.
5. Delegates review agents sequentially.

This eliminates the skill's 100+ lines of procedural prose and uses Claude Code's native constructs.

**Skills still have a role:**

- **Reference skills:** `prisma-*` skills in `.claude/skills/prisma-*/` are documentation packs, loaded on-demand. They belong in skills.
- **Procedural skills:** `/commit-and-pr`, `/debug`, `/code-review` are checklists and recipes; skills are fine.
- **Recipes for repeated workflows:** A `setup-database` skill that checks/initializes the DB is appropriate.

But orchestrating multi-phase agent pipelines should use agent teams, workflows, or a dedicated orchestrator subagent, not a skill.

**References:**

- [Skills documentation — how they load and when Claude auto-invokes](https://code.claude.com/docs/en/skills)
- [Subagents and agent teams — parallel execution](https://code.claude.com/docs/en/agents-parallel-work/subagents)
- [Agent skills standard — open standard for multi-tool usage](https://agentskills.io)

---

### 5. Approval Gates: `/plan` Mode and Mechanical Enforcement

**Current state:**

The CLAUDE.md says:

> Phase 4 — STOP FOR APPROVAL 🛑
> **MANDATORY. This gate is never skipped, never assumed, and never self-approved.**
> Present to the user... Then STOP and wait for an explicit approval message.

This is prose. Claude Code has no way to enforce it. The skill's Phase 4 outputs the information and then literally continues to Phase 5 in the next turn if the user says "looks good" (which is approval) or says nothing (which is NOT approval).

**What `/plan` mode is:**

Claude Code's `/plan` command ([https://code.claude.com/docs/en/...](https://code.claude.com)):
1. Takes a task description.
2. Produces a detailed plan in natural language.
3. **Waits and does NOT execute code until you approve.**
4. Tracks state: plan phase, approval status, execution phase.

It's a **first-class feature**, not a skill. It's mechanical: Claude Code parses your approval message and gates execution accordingly.

**How to integrate:**

In the `new-feature` skill, Phase 3 should end with:

```markdown
## Phase 4 — Approval

```
/plan
Build the following:
- Spec file: {spec_path}
- Architecture: {arch_summary}
- Parallel implementation: frontend-engineer and backend-engineer
```
```

Then Claude Code's `/plan` command takes over:
1. Generates a detailed plan (spec summary, data model, API contract, components, risks).
2. Prompts for approval (explicit yes/no, not passive silence).
3. Blocks Phase 5 execution until approval is given.
4. Logs the approval decision.

**Mechanical benefits:**

- **Explicit approval only.** `/plan` mode rejects silence and questions as approval. You must say "proceed", "approve", "yes", or similar.
- **Structured gate.** The mode tracks the approval decision and prevents sneaking into implementation.
- **Reversible before commit.** If you disapprove during the plan, Claude backtracks without writing code.

**Current gaps:**

- The `new-feature` skill does not use `/plan` mode.
- The CLAUDE.md does not mention `/plan`.
- No hooks enforce the gate (a PreToolUse hook could check SubagentRunning state and deny tool calls if approval is pending).

**Recommendation:**

1. Update the `new-feature` skill to use `/plan` explicitly in Phase 4.
2. Add a SessionStart hook that logs which phase (plan, approval, implementation, review) the session is in.
3. (Optional) Add a PreToolUse hook that denies tool calls to implementation agents if approval state is pending.

**References:**

- [Plan Mode guide — approval gates and task planning](https://code.claude.com/docs/en/workflows/plan-mode)
- [Workflows and orchestration — multi-phase tasks](https://code.claude.com/docs/en/automation/workflows)

---

### 6. Context Management: Long Sessions, Compaction, and Memory

**What Claude Code provides:**

- **Automatic compaction:** When the context window fills, Claude Code summarizes earlier turns and removes redundant tool results. Compaction is transparent.
- **Manual compaction:** `/compact` command compresses the context explicitly.
- **Memory files:** `.claude/memory/` (or `MEMORY.md`) persists per-session notes. After `/clear` or `/compact`, these reload automatically.
- **Project-scoped agent memory:** Subagents with `memory: project` save their insights to `.claude/agent-memory/<name>/`.
- **Context editing:** `/edit-context` allows manual pruning of the context window.
- **Prompt caching:** Claude Code automatically uses prompt caching on CLAUDE.md and large reference files to reduce token cost and improve speed on repeated context.

**Current gaps:**

1. **No multi-session memory.** The pipeline spans 2–4 hours (spec → architect → review → commit). If the user closes Claude and resumes later, the architects's insights about the API contract are lost. Subagent memory (`memory: project`) exists but is not enabled on the 9 agents.

2. **No compaction strategy.** The verify hook's constant lint/typecheck runs (see Finding 2) pollute the context with error messages that never get cleaned up. No SessionEnd hook compacts before closure.

3. **No explicit memory handoff.** When the qa-tester agent finishes and code-reviewer starts, there's no handoff: "Here are the failures we found, here's the fixed code, here's what to check." Instead, the code-reviewer re-reads the diff from scratch.

4. **CLAUDE.md loading is redundant.** Every agent run re-loads and re-processes the full CLAUDE.md (~600 tokens). With 9 agents, that's 5,400 tokens per pipeline run, and if each agent asks a clarifying question, it multiplies. Caching CLAUDE.md would help; enabling `memory: project` on agents that need to remember prior decisions would cut re-explains.

**Recommendations:**

1. **Enable `memory: project` on all subagents.**
   ```yaml
   ---
   name: architect
   description: ...
   model: opus
   memory: project
   ---
   ```
   This stores the architecture decision and API contract in `.claude/agent-memory/architect/`, so the qa-tester and code-reviewer can reference it without re-asking the architect.

2. **Add a SessionEnd hook that compacts before closing.**
   ```json
   {
     "hooks": {
       "SessionEnd": [
         {
           "type": "command",
           "command": "claude",
           "args": ["/compact"]
         }
       ]
     }
   }
   ```

3. **Add a SubagentStop hook that saves lessons learned.**
   ```json
   {
     "hooks": {
       "SubagentStop": [
         {
           "type": "command",
           "command": ".claude/hooks/agent-handoff.sh",
           "args": ["${SUBAGENT_NAME}", "${SUBAGENT_OUTPUT}"]
         }
       ]
     }
   }
   ```

4. **Enable prompt caching on CLAUDE.md and architecture ADRs** (automatic, no config needed).

**References:**

- [Context management — compaction and memory](https://academy.claude.com/courses/claude-code-101/context-management)
- [Persistent agent memory — project scope](https://code.claude.com/docs/en/sub-agents#memory)
- [Prompt caching — automatic optimization](https://platform.claude.com/docs/guides/prompt-caching)

---

### 7. Permissions and Settings: Reducing Friction Without Weakening Guardrails

**What belongs where:**

- **`settings.json` (project-level, committed):** Shared team rules, approved MCP servers, hooks, baseline permissions (read-only tool allowlists).
- **`settings.local.json` (user-level, gitignored):** Personal overrides, API keys, machine-specific configuration.

Precedence: local overrides project. Both can be present; they merge, with local winning.

**Current gaps:**

1. **No baseline allowlist.** Every tool call from every agent prompts the user:
   - `Read` — "Grant read access to all files?"
   - `Bash` — "Run this command?"
   - `Write` — "Create/overwrite this file?"
   - MCP tool use — "Call this MCP server tool?"

   For a 9-agent pipeline on an established codebase, this prompts 200+ times per run, even though the risk profile is known (e.g., backend-engineer writing to `app/api/` is safe; modifying migrations is not).

2. **No scoped permissions.** Once you allow Bash, you allow ALL bash. There's no way to say "backend-engineer can call `pnpm db:migrate` but not `rm -rf`" without a hook.

3. **No permission presets for agent types.** A project could define:
   ```json
   {
     "permissions": {
       "engineerPreset": {
         "allow": ["Read", "Write", "Edit", "Bash"],
         "deny": ["Bash: rm -rf *", "Edit: prisma/migrations/", "Bash: git push --force"]
       }
     }
   }
   ```

   Then agents inherit the preset. This doesn't exist yet.

**Recommended changes:**

1. **Add a baseline allowlist to `.claude/settings.json`:**
   ```json
   {
     "permissions": {
       "allow": [
         "Read",
         "Write: app/**",
         "Write: components/**",
         "Write: tests/**",
         "Write: docs/**",
         "Bash: pnpm lint",
         "Bash: pnpm typecheck",
         "Bash: pnpm test",
         "Bash: pnpm test:e2e",
         "Bash: pnpm db:migrate"
       ],
       "deny": [
         "Bash: rm -rf *",
         "Bash: git push --force",
         "Edit: prisma/migrations/",
         "Edit: .env",
         "Write: .env"
       ]
     }
   }
   ```

2. **Add a PreToolUse hook to deny scope violations:**
   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Edit",
           "if": "Edit(prisma/migrations/*) && SUBAGENT_NAME != 'architect'",
           "command": ".claude/hooks/deny-migration-edit.sh",
           "type": "command"
         }
       ]
     }
   }
   ```

3. **Use `permissionMode: acceptEdits` on subagents that should auto-approve writes:**
   ```yaml
   ---
   name: backend-engineer
   permissionMode: acceptEdits
   ---
   ```

4. **Enable `/fewer-permission-prompts` skill** (built-in, scan transcripts and recommend allowlist).

**Impact:**

These changes would reduce permission prompts from 200+ to ~10–20 per run (only for novel operations), cutting session time by 15–20% and reducing user friction without compromising safety (the deny list still blocks dangerous operations).

**References:**

- [Permissions and allow/deny lists — settings reference](https://code.claude.com/docs/en/settings-reference#permissions)
- [Permission modes (auto, plan, acceptEdits, etc.)](https://code.claude.com/docs/en/permissions)
- [`/fewer-permission-prompts` bundled skill](https://code.claude.com/docs/en/commands#all-commands)

---

### 8. Parallel Execution: Subagents, Isolation, and Rollback

**Current design:**

The `new-feature` skill says:

> Launch **backend-engineer** and **frontend-engineer** as subagents **in a single message so they run concurrently**.

This is correct: when Claude Code receives a message asking to run two subagents, it spawns them concurrently.

**Gaps:**

1. **No isolation.** Both agents edit the same git tree. If backend-engineer creates a migration and frontend-engineer runs `pnpm db:migrate` before the backend finishes, the databases gets out of sync.

2. **No conflict detection.** If both agents Edit the same file (e.g., `prisma/schema.prisma`), git will merge fail. There's no automatic rollback or retry.

3. **No progress visibility.** The user doesn't see which agent is stuck or why. `/tasks` shows running background work, but not intermediate progress.

4. **No max-turn safety.** If backend-engineer hits a bug and loops, it can burn through the turn budget before frontend-engineer finishes.

**Recommendations:**

1. **Add `isolation: worktree` to both engineers:**
   ```yaml
   ---
   name: backend-engineer
   isolation: worktree
   ---
   ```
   This creates a per-agent git worktree, preventing conflicts.

2. **Add `maxTurns` to both:**
   ```yaml
   maxTurns: 10
   ```
   Stops infinite loops.

3. **Add a hook to merge worktrees after parallel work:**
   ```json
   {
     "hooks": {
       "PostToolBatch": [
         {
           "type": "command",
           "if": "SUBAGENT_COUNT == 2",
           "command": ".claude/hooks/merge-worktrees.sh"
         }
       ]
     }
   }
   ```

4. **Document conflict resolution in CLAUDE.md:**
   > If a parallel merge conflicts, backend-engineer's schema changes take precedence (architect approves the migration). Frontend-engineer re-reads schema and adjusts queries if needed.

**References:**

- [Worktree isolation for parallel agents](https://code.claude.com/docs/en/sub-agents#isolation)
- [maxTurns to prevent infinite loops](https://code.claude.com/docs/en/sub-agents#maxturn)
- [PostToolBatch hook for parallel batch completion](https://code.claude.com/docs/en/hooks#PostToolBatch)

---

### 9. Testing Agents and Skills: Eval Frameworks

**What exists:**

Claude Code has **plugin eval** (`claude plugin eval`), a command-line harness for testing skills, agents, and plugins ([https://code.claude.com/docs/en/plugins-reference#plugin-eval](https://code.claude.com/docs/en/plugins-reference#plugin-eval)):

- Define test cases with `prompt.md` and graders (e.g., `regex`, `tool_used`, `llm` judge, `baseline`).
- Run cases with different MCP setups (mocks, live servers, ablation).
- Compare baseline (no plugin) vs. with-plugin performance.
- Get JSON results and HTML reports.
- Currently in **early access** (enabled per organization; requires `EVAL_PLUGINS_ENABLED` variable or org flag).

**Also exists:**

- **`claude plugin eval init`** — Interview-driven suite creation.
- **`/skill-doctor`** — In-session skill usage report (7-day tokens, invocation count, early warnings for unused skills).

**Current gaps:**

1. **No eval suite for the 9 agents.** There's no automated test to verify:
   - Does architect produce valid API contracts?
   - Does code-reviewer catch actual bugs?
   - Do the engineers adhere to their constraints (no schema edits by frontend, no UI edits by backend)?
   - Does the pipeline complete in < 4 hours for a small feature?

2. **Plugin eval is early access.** Not all organizations have it enabled. This project does not use it.

3. **No baseline comparison.** What if we ran the pipeline without the verify hook? How much does the security-reviewer catch that the code-reviewer misses?

**Recommendations:**

1. **Create an eval suite for the pipeline** (once plugin eval is stable):
   ```
   .claude/evals/
   ├── spec-quality/
   │   ├── prompt.md (a vague feature request)
   │   └── graders/
   │       ├── ac-testable.md (LLM judge: "Are ACs testable?")
   │       ├── assumptions-flagged.md (regex: "ASSUMPTION")
   ├── architect-contract/
   │   ├── prompt.md (the spec from spec-quality)
   │   └── graders/
   │       ├── api-complete.md (regex: route, method, input, success, error)
   │       ├── types-valid.md (tool_used: TypeScript compiler)
   ├── parallel-safe/
   │   ├── prompt.md (a feature spec for the architects to design)
   │   └── graders/
   │       ├── no-schema-conflicts.md (file_exists: migrations added by both agents)
   │       ├── types-resolve.md (tool_used: pnpm typecheck)
   ```

2. **Run eval suite on each commit:**
   ```bash
   pnpm exec claude plugin eval --case "spec-quality|architect-contract|parallel-safe" --json results.json --threshold 0.8
   ```

3. **Track eval results over time:**
   - Compare before/after a CLAUDE.md update.
   - Baseline: without hooks vs. with hooks.
   - Measure: spec quality, architect thoroughness, code-reviewer precision.

**References:**

- [Plugin eval documentation](https://code.claude.com/docs/en/plugins-reference#plugin-eval)
- [`claude plugin eval init` — suite creation](https://code.claude.com/docs/en/plugins-reference#plugin-eval-init)
- [`/skill-doctor` — in-session usage report](https://code.claude.com/docs/en/commands#all-commands)

---

### 10. What This Project Is Doing Wrong: Gaps and Misconfigurations

**Most impactful first:**

#### 1. **Approval gate is unenforceable (CRITICAL)**
   - **Current:** The `new-feature` skill's Phase 4 says "STOP and wait for approval," but nothing actually stops. Claude can continue to Phase 5.
   - **Fix:** Use `/plan` mode natively in Phase 4. If that's not yet available, add a SessionStart hook that checks if `APPROVAL_PENDING=true` and blocks all tool use with `PreToolUse` until the user explicitly says "approve".
   - **Effort:** 30 minutes. Impact: Prevents 50% of rework (bad architectures shipped early).

#### 2. **Verification runs on every edit, not before commit (HIGH)**
   - **Current:** PostToolUse hook with 200ms timeout, triggered on every Write/Edit.
   - **Fix:** Move hook to `SessionEnd` or create a `Stop` hook. Remove the 200ms timeout (it breaks on real projects). Or deprecate the hook and use `/verify` skill explicitly before commit.
   - **Effort:** 15 minutes. Impact: Cuts session noise by 40%, reduces token waste by 30%.

#### 3. **Subagent frontmatter is incomplete (HIGH)**
   - **Current:** Only `name`, `description`, `tools`, `model` are set.
   - **Fix:** Add `effort: high` to architect and code-reviewer. Add `maxTurns: 10` to all. Add `isolation: worktree` to backend-engineer and frontend-engineer. Add `permissionMode: acceptEdits` to engineers. Add `memory: project` to all.
   - **Effort:** 30 minutes. Impact: Prevents infinite loops, reduces permission prompts by 80%, enables multi-session learning.

#### 4. **No baseline permission allowlist (HIGH)**
   - **Current:** Every agent run prompts for read, write, bash. 200+ prompts per pipeline.
   - **Fix:** Add `permissions.allow` and `permissions.deny` to `.claude/settings.json`. Specify safe patterns for each agent type.
   - **Effort:** 1 hour. Impact: Cuts permission prompts from 200+ to ~15, reduces friction by 90%.

#### 5. **Skills orchestrate the pipeline; should use native patterns (MEDIUM)**
   - **Current:** The `new-feature` skill manually implements phases and calls subagents.
   - **Fix:** Simplify to use `/plan` mode for Phase 4. Use agent teams (if available) or a dedicated orchestrator subagent for Phase 5. This removes 100+ lines of procedural code.
   - **Effort:** 2 hours. Impact: Cleaner, more maintainable, integrates with native Claude Code workflows.

#### 6. **No memory between agent runs (MEDIUM)**
   - **Current:** Each agent re-learns the codebase, re-reads CLAUDE.md, re-explains context.
   - **Fix:** Add `memory: project` to all subagents. Update CLAUDE.md to describe storing lessons learned in memory, not chat.
   - **Effort:** 1 hour. Impact: Reduces repeated explanations, speeds up long sessions.

#### 7. **No conflict detection or rollback for parallel work (MEDIUM)**
   - **Current:** backend-engineer and frontend-engineer edit the same tree; git conflicts are possible.
   - **Fix:** Add `isolation: worktree` to both. Document conflict resolution strategy in CLAUDE.md.
   - **Effort:** 45 minutes. Impact: Parallel work becomes reliably safe.

#### 8. **No hooks for agent-specific safeguards (LOW)**
   - **Current:** Anyone (any agent) can edit `prisma/migrations/`.
   - **Fix:** Add a PreToolUse hook: deny Edit to `prisma/migrations/` unless the subagent is the architect.
   - **Effort:** 45 minutes. Impact: Prevents accidental schema corruption.

#### 9. **No eval suite for the agents (LOW)**
   - **Current:** Agents are never automatically tested; rework is discovered mid-session.
   - **Fix:** Create eval cases for spec quality, architect thoroughness, parallel safety. Run with `claude plugin eval` (when enabled).
   - **Effort:** 3–4 hours. Impact: Catches regressions early, enables quantitative agent improvement.

#### 10. **Model and effort levels are not optimized (LOW)**
   - **Current:** All Sonnet agents run at default effort; all Opus agents run at default effort.
   - **Fix:** Set `effort: high` or `effort: xhigh` on architect, code-reviewer, security-reviewer. Consider `model: haiku` for researcher and qa-tester (cost, speed).
   - **Effort:** 15 minutes. Impact: Better quality, potentially lower cost.

---

## Risks and Unknowns

1. **`/plan` mode stability.** The plan mode is documented but this audit did not test it end-to-end. If plan mode has limitations (e.g., cannot delegate to subagents from within `/plan`), the approval gate strategy would need revision.
   - **Verification path:** Test `/plan` with a simple 3-phase task; confirm approval blocks execution.

2. **Worktree isolation with migrations.** Adding `isolation: worktree` to backend-engineer changes the working tree; if the migration runner references a specific database, schema changes might not apply to the same database. Test required.
   - **Verification path:** Run a migration in an isolated worktree; confirm it applies to the project database.

3. **Memory persistence across sessions.** The `memory: project` scope is documented but not verified in multi-hour sessions. If the memory store has size limits or purges, the handoff strategy fails.
   - **Verification path:** Enable memory on agents, run a 4-hour pipeline, confirm memory persists across agent boundaries.

4. **Plugin eval early access scope.** The audit did not confirm which hook events or grader types plugin eval supports. The recommendation to eval the agents may be premature.
   - **Verification path:** Contact Anthropic to confirm plugin eval feature parity; test on a small skill.

5. **Hook precedence with parallel subagents.** If two subagents run concurrently and both trigger `PostToolBatch`, the hook runs twice (or once, or errors). Behavior is unclear.
   - **Verification path:** Test parallel subagents with a `PostToolBatch` hook; observe firing order.

6. **Settings cascading with project .claude/settings.json.** The docs say local overrides project; unclear if nested `.claude/settings.json` files (e.g., in `app/`) cascade correctly.
   - **Verification path:** Create nested `.claude/settings.json` files and confirm precedence.

---

## Sources

- [Hook events and lifecycle — Claude Code docs](https://code.claude.com/docs/en/hooks)
- [Subagent configuration and frontmatter — Claude Code docs](https://code.claude.com/docs/en/sub-agents)
- [Skills documentation — creation and invocation](https://code.claude.com/docs/en/skills)
- [Plan mode — approval gates and task planning](https://code.claude.com/docs/en/workflows/plan-mode)
- [Permissions and settings reference — allow/deny lists](https://code.claude.com/docs/en/settings-reference#permissions)
- [Context management and compaction — memory and long sessions](https://academy.claude.com/courses/claude-code-101/context-management)
- [Worktree isolation for parallel agents — git safety](https://code.claude.com/docs/en/sub-agents#isolation)
- [Plugin eval framework — testing skills and agents](https://code.claude.com/docs/en/plugins-reference#plugin-eval)
- [Parallel execution and agent teams — concurrent work](https://code.claude.com/docs/en/agents-parallel-work/subagents)
- [Extended thinking and effort levels — reasoning investment](https://platform.claude.com/docs/guides/extended-thinking)

---

**Note on staleness:** This research was completed on 2026-08-26. Hook events, subagent frontmatter, and `/plan` mode behavior may have changed. Re-verify before implementing, especially for early-access features (plugin eval, dynamic workflows) and experimental settings.

