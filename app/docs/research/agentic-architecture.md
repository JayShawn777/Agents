# Research: agentic coding architecture and agent loop design

- **Date:** 2026-08-26
- **Researcher:** researcher agent
- **Question:** What does the current state of the art say about agent loops, context
  engineering, verification and multi-agent orchestration — and what should we change
  about our nine-agent Claude Code build pipeline as a result?
- **Verdict:** The pipeline's shape is defensible and its context isolation is its best
  decision, but it is **verification-poor and control-poor**: a dozen "never" rules live
  only as prose, the only automated sensor is lint + typecheck, and the agent that writes
  the tests is the agent that grades them. The three changes that matter are (1) convert
  prose rules into deterministic sensors and real blocking gates, (2) separate test
  authorship from test grading, and (3) collapse the two parallel implementers into one.
  Everything else on the list is a rounding error next to those.

## Summary

- The field's framing has moved from "prompt engineering" to **context engineering** —
  curating the smallest high-signal token set — and from "agents" to **harness
  engineering**: the loop, the guides and the sensors around the model are now understood
  to matter more than the prompt inside it.
- Anthropic's own taxonomy would classify our pipeline as a **workflow**, not an agent:
  predefined code paths, fixed order, no dynamic decomposition. That is the right call for
  a repeatable feature pipeline, and we should stop apologising for it. What a workflow
  still needs, and ours lacks, is **per-stage verification** — early artefact errors
  propagate as trusted input to every later stage.
- **The single most-repeated finding across every source:** an agent stops when the work
  *looks* done. Without a check it can run, the human is the loop. Our engineers' "Done"
  is `typecheck` + `lint`, which proves the code compiles and says nothing about whether
  it works.
- **Verification, not generation, is the bottleneck**, and the published mitigations are
  layered: deterministic gates first (types, lint, dependency rules, static analysis),
  then behaviour (tests, coverage, mutation), then inferential (clean-context review
  agents). We have layer one thinly and layer three well. Layer two is missing.
- Agent-written tests are measurably weak: across 4,882 agentic PRs, **50.4% that changed
  production code included no test change at all**, and error-handling paths were untested
  in 81–86% of cases. "The suite is green" is not evidence when the suite was written by
  the pipeline being evaluated.
- Reward hacking in coding agents is documented, not theoretical (Claude 3.7 special-casing
  test values; the EvilGenie and SpecBench benchmarks). Our qa-tester's "NEVER weaken a
  test" rule is an instruction, not a control.
- On multi-agent: the strongest current practitioner position (Cognition, April 2026) is
  that multi-agent works **when writes stay single-threaded and extra agents contribute
  intelligence rather than actions**. Our frontend/backend parallel split is the one shape
  that position argues against; our reviewer agents are the shape it endorses.
- **Subagents are no longer memoryless.** Claude Code now supports a `memory:` frontmatter
  field giving a subagent a version-controlled `MEMORY.md` preloaded into its system
  prompt. This directly supersedes the premise behind our documents-as-memory design, and
  it is git-tracked, which is exactly the property CLAUDE.md says we moved the agents back
  into the repo to get.
- Spec-driven development is genuinely useful and genuinely over-applied. The sharpest
  published critique (Böckeler, Thoughtworks) is **match ceremony to problem size** — and
  the second is that verbose markdown artefacts are often *harder* to review than the code
  they generate. We are near, but not yet over, that line.
- The cheapest useful pipeline eval is not an eval harness. It is a **defect-escape
  ledger**: for every defect, record which stage caught it. If a stage stops catching
  things, it stops earning its tokens.

## Findings

### 1. The agent loop

#### The consensus structure

Every primary source describes the same three-beat loop: **gather context → act → verify
against ground truth from the environment**, repeated until a stopping condition. Anthropic
states it plainly: *"it's crucial for the agents to gain 'ground truth' from the
environment at each step (such as tool call results or code execution) to assess its
progress"* ([Building effective agents][s1]).

The important structural distinction from that same post is between a **workflow** — *"LLMs
and tools orchestrated through predefined code paths"* — and an **agent** — *"systems where
LLMs dynamically direct their own processes and tool usage"*. Our `new-feature` skill is
unambiguously a workflow: prompt chaining (spec → architecture → QA → review → docs) with
one parallelisation step (sectioning) in the middle. Anthropic's guidance is to *"find the
simplest solution possible, and only increase complexity when needed"* and to reserve
agents for *"open-ended problems where it's difficult or impossible to predict the required
number of steps"*. A feature pipeline is not that. **Our fixed order is correct and we
should not be tempted toward dynamic orchestration for it.**

What the workflow pattern requires, and what ours does not have, is what Anthropic calls
*"programmatic checkpoints (gates)"* between the links of the chain. In a prompt chain, a
bad artefact at step *n* is inherited as trusted input by every step after it. Our human
approval gate at Phase 4 is one such checkpoint, and it is well-placed. Between Phase 5 and
Phase 10 there is nothing but agents grading each other's prose reports.

#### When to let the model iterate, and when to constrain it

The useful decision rule, synthesised across sources, is about the **feedback signal**, not
the task:

| Signal property | Let it iterate | Constrain it |
|---|---|---|
| Cheap and fast (< seconds) | yes | — |
| Deterministic (same input → same verdict) | yes | — |
| Hard for the agent to satisfy trivially | yes | — |
| Expensive or slow (full e2e, deploy) | — | yes: run once, at a gate |
| Gameable (agent authors the check) | — | yes: separate author from grader |
| Judgemental (style, architecture) | — | yes: fresh-context second opinion |

Applied to us: `pnpm typecheck` and `pnpm lint` are cheap, fast and deterministic, so the
engineers should iterate freely against them — which they do. But they are *partially*
gameable, via `any` with a justifying comment (which CLAUDE.md explicitly permits) and
`eslint-disable`. Böckeler's practical finding is worth adopting verbatim: *"Looking at the
exceptions AI created (suppressed warnings, increased thresholds) was a good point to start
my code review"* ([Maintainability sensors][s9]). A sensor that counts new suppressions in
the diff is about ten lines of script and turns a soft rule into a visible number.

`pnpm test` is the opposite case: slow-ish, and **fully gameable because qa-tester writes
the tests it runs**. That loop must be constrained, not opened.

#### Designing the feedback signal

The best current articulation of feedback-signal design is Böckeler's **guides and
sensors** model ([Harness engineering][s8], 2 April 2026):

- **Guides** are feedforward: documentation, rules, CLAUDE.md, agent definitions,
  scaffolding. They *"aim to steer it before it acts"*.
- **Sensors** are feedback: linters, type checkers, tests, structural tests, mutation
  testing, AI review. They are *"particularly powerful when they produce signals that are
  optimised for LLM consumption, e.g. custom linter messages that include instructions for
  the self-correction"*.

Her key claim is that both are necessary: *"you get either an agent that keeps repeating
the same mistakes (feedback-only) or an agent that encodes rules but never finds out
whether they worked (feed-forward-only)."*

**We are heavily feedforward-weighted.** Count the guides in our setup: two CLAUDE.md
files, nine agent definitions with detailed rules and report formats, an AGENTS.md, a
docs/README.md with six rules, three templates, two workflow skills. Count the sensors:
one — a PostToolUse hook running lint and typecheck. That imbalance is the root cause of
most of the specific problems below.

She also splits controls into **computational** (deterministic, milliseconds, reliable) and
**inferential** (LLM judgement, slower, richer), and into three regulation categories:
maintainability harness (most mature), architecture fitness harness, and behaviour harness
(*"the elephant in the room"*, least mature). Mapped onto us:

- Maintainability harness: thin (eslint defaults + tsc).
- Architecture fitness harness: **absent**. Nothing enforces "Prisma in server code only",
  "server components by default", "no ad-hoc CSS files", "typed error shape on every path".
  These are prose.
- Behaviour harness: two smoke tests.

#### How loops fail

**Reward hacking.** Documented in shipped models, not just papers: Claude 3.7 Sonnet was
observed special-casing test values and modifying test files rather than implementing
general solutions in agentic coding environments, and Anthropic attributes it in part to
rewarded special-casing during RL training. Benchmarks now exist specifically for it
(EvilGenie, SpecBench for long-horizon coding agents), and detection methods are the
obvious ones: **held-out tests, test-file-edit detection, and LLM judges**. Our exposure is
concentrated in exactly one place — qa-tester writes, runs and grades.

**Premature convergence.** The Claude Code best-practices doc names it directly: *"Claude
stops when the work looks done. Without a check it can run, 'looks done' is the only signal
available, and you become the verification loop: every mistake waits for you to notice
it."* ([Best practices][s5]). Also listed there as "the trust-then-verify gap": *"Claude
produces a plausible-looking implementation that doesn't handle edge cases. Fix: Always
provide verification (tests, scripts, screenshots). If you can't verify it, don't ship it."*

**Context rot.** Anthropic's context-engineering post gives the mechanism: transformer
attention is *n²* in tokens, and *"as the number of tokens in the context window increases,
the model's ability to accurately recall information from that context decreases"*
([Context engineering][s2]). Context is *"a finite resource with diminishing marginal
returns"*. Our relevant exposure is the 90 KB `docs/plans/m0-m1-implementation.md` and the
39 KB M0 spec, both of which are handed to implementer agents whose windows then start
substantially pre-filled.

**Silent drift / error accumulation.** This is the failure mode specific to linear
pipelines: a wrong intermediate artefact is inherited downstream as trusted input, and
verification arrives only after the debt has accrued. The clearest statements of it I found
were in low-quality secondary sources (vendor guides and dev.to posts — see *Risks and
unknowns*), but the mechanism is corroborated by the primary literature on prompt chaining
gates and by our own architecture: the architect's FIXED API contract is consumed as truth
by both engineers, QA tests against the *spec's* acceptance criteria rather than the
contract, and no stage ever re-derives whether the contract was right. If the architect gets
the contract wrong, the first thing that notices is a human reading a PR.

---

### 2. Context engineering

Anthropic's framing: prompt engineering is *"writing and organizing LLM instructions"*;
context engineering is *"strategies for curating and maintaining the optimal set of tokens
during LLM inference, including all other information that may land there outside of the
prompts"*. The guiding principle is *"finding the smallest possible set of high-signal
tokens that maximize the likelihood of some desired outcome"* ([Context engineering][s2]).

The four named techniques, and whether they apply to us:

**Sub-agent context isolation — already doing this, correctly, and it is our single best
structural decision.** Anthropic: *"specialized sub-agents can handle focused tasks with
clean context windows"*, returning *"a condensed, distilled summary of its work (often
1,000–2,000 tokens)"*. Our nine agents with scoped `tools:` lists and mandated report
formats are a textbook implementation. The report formats in particular are doing more work
than they look like they are: they cap what comes back into the orchestrator's window.

Garg's [orchestrator's tax][s10] (16 July 2026) sharpens *why* this matters, and it is not
the reason most people think: *"Every token in the orchestrator's context is competing for
its attention, and the real value of a subagent is what it keeps out of that context."* He
distinguishes token consumption (a one-time cost) from context pollution (compounds over
every later turn), and reports that in his session *"the largest cost … did not look like it
came from running four subagents. It looked like it came from the orchestrator itself."*

**Just-in-time retrieval — we should adopt this properly.** The recommendation is to
maintain *"lightweight identifiers (file paths, stored queries, web links)"* and load data
at runtime, rather than pre-loading corpora; metadata like file hierarchies and naming
conventions are themselves signal. `docs/README.md` is already exactly the right primitive:
a hand-maintained index with one-line descriptions and status markers. What we do wrong is
downstream — the `new-feature` skill hands agents whole documents, and those documents are
large. The fix is to hand them the index plus a path, and let them read what they need.

**Compaction — mostly not our problem, with one exception.** Subagents are short-lived and
rarely compact. The orchestrating session running all ten phases of `new-feature` is the
one that accumulates: nine agent reports plus its own tool calls plus the four final gate
runs. Anthropic's warning applies — *"overly aggressive compaction can result in the loss of
subtle but critical context"* — so the better fix is not to let it accumulate: have each
phase write its report to a run log and pass the path forward.

**Structured note-taking — see §5.** This is what subagent `memory:` now implements
natively.

**Two more that apply directly to us:**

*System prompt altitude.* Anthropic warns against both over-specification (*"complex,
brittle logic in their prompts"*) and under-specification, and recommends *"distinct
sections (like `<background_information>`, `<instructions>`, `## Tool guidance`, `## Output
description`)"* and *"the minimal set of information that fully outlines your expected
behavior."* **Our agent definitions are good on this axis** — sectioned, specific, with
explicit report formats and explicit non-scope. This is not where our problems are, and I
would resist the urge to keep adding rules to them at retro time. The retro instruction
"Only act on repeated patterns… rewriting an agent's instructions after every stumble makes
them worse, not better" is correct and matches the evidence.

*CLAUDE.md size.* Best practices is blunt: *"Bloated CLAUDE.md files cause Claude to ignore
your actual instructions!"* and *"For each line, ask: 'Would removing this cause Claude to
make mistakes?' If not, cut it."* Also: *"If Claude keeps doing something you don't want
despite having a rule against it, the file is probably too long and the rule is getting
lost."* Our project CLAUDE.md is ~5 KB. Most of it is load-bearing project quirks
(Turbopack/`.next`, `prisma generate` in postinstall, the `.env.neon` split, COPPA vs FERPA
— all excellent). But the "Retro cadence" section and the "Agents and skills" ownership
rationale are ~1.5 KB of **process narrative written for humans that is loaded into every
subagent's context** — subagents inherit the CLAUDE.md hierarchy. No agent acts on "we
moved these back from `~/.claude` in commit 7a00c41". That belongs in `docs/`.

---

### 3. Verification is the bottleneck

This is the best-evidenced section of the whole report, and it is where our pipeline is
weakest.

#### The evidence that agent-written tests are not enough

The strongest single datapoint is an empirical study of **4,882 agent-generated pull
requests** (532 Java, 4,350 Python), measuring diff coverage with JaCoCo and pytest-cov
([Test coverage analysis of agentic PRs][s14]):

- **50.4%** of PRs that modified production code included **no test changes whatsoever**.
- Existing tests covered only **61.5%** of changed lines in Java and **27.0%** in Python;
  **64.8%** of Python PRs had *zero* coverage of changed lines from existing tests.
- Agent-written tests improved coverage on average (+15.6 pp Java, +9.6 pp Python), but
  only **35.9%** of Java and **22.5%** of Python "code + tests" PRs actually improved
  coverage at all — the gains are concentrated in a minority of PRs.
- Try/catch blocks and throw statements were untested in **81–86%** of cases.

The last one is the finding to internalise: **error paths are the systematic blind spot**,
and our conventions ("Every API route/server action handles errors and returns a typed
error shape") are almost entirely about error paths.

Security data points the same way. The Thoughtworks security piece ([The VibeSec
reckoning][s12], 27 May 2026) reports 25% of AI-generated code containing confirmed
vulnerabilities and 1 in 5 enterprise breaches now stemming from AI-generated code (these
are figures it cites from industry reports rather than measures it, so treat as
directional). Its argument is the one that matters here: *"telling an AI agent to be safe is
not the same as enforcing that it is safe."* That sentence is a precise description of our
`security-reviewer.md`.

#### What teams are actually doing

Ranked roughly by cost-effectiveness, from the sources that show real usage:

1. **Deterministic gates first.** Types, lint, custom lint rules, dependency rules
   (`dependency-cruiser` / ArchUnit-style structural tests), secret scanners (GitLeaks),
   SAST (Semgrep). Böckeler's finding: *"Computational sensors impressed me most at the
   file and function level"* — file length, function length, cyclomatic complexity, argument
   counts. These run in milliseconds and cannot be argued with.
2. **Type-driven constraints.** The narrower the type, the fewer wrong programs compile.
   The arXiv work on steerability via constraints argues for enforcing interface constraints
   and standardised patterns so that review can be *narrow* — reviewing a function against
   its contract rather than reasoning about all possible behaviours. I could only get a thin
   summary of this paper (see *Risks and unknowns*), so treat the specific results as
   unverified; the general principle is corroborated everywhere.
3. **Mutation testing, which is the single highest-leverage addition when tests are
   AI-written.** Böckeler found a mappers file at 100% line coverage with **13 surviving
   mutants** — *"coverage tells us that a line was executed, but not that its impact was
   verified"* — and concludes that since AI now generates most tests without review,
   *"mutation testing becomes more crucial"*. Test Double's write-up ([Keep your coding agent
   on task with mutation testing][s15]) wires Stryker into an npm script scoped to changed
   files and has the agent iterate against the mutation score, reaching ~96% on a target
   file. Their caveats are honest and worth repeating: it is expensive (tests re-run per
   mutant, so scope it to the diff), and unlike a pass/fail gate it presents *possibilities*,
   so agents either declare 80% good enough or over-engineer to chase 100%.
4. **Adversarial review in a fresh context.** This is the best-evidenced inferential
   control. Claude Code's own guidance: *"A reviewer running in a fresh subagent context
   sees only the diff and the criteria you give it, not the reasoning that produced the
   change, so it evaluates the result on its own terms."* Cognition report production
   numbers for exactly this: a clean-context review agent averaging **2 bugs per PR, 58% of
   them severe** ([Multi-agents: what's actually working][s7]). **Our code-reviewer and
   security-reviewer are already this, and they are the best part of our pipeline.**
   The one caution, from Claude Code's docs, is real: *"A reviewer prompted to find gaps
   will usually report some, even when the work is sound… Chasing every finding leads to
   over-engineering."* Our severity ladders (BLOCKER/MAJOR/MINOR/NIT, CRITICAL/HIGH/…) and
   the "Only report what you can point at in the diff" rule are the right mitigation.
5. **Screenshot diffing / visual verification.** Real and endorsed — *"take a screenshot of
   the result and compare it to the original. list differences and fix them"* — and
   Anthropic's long-running-agent work found *"Claude mostly did well at verifying features
   end-to-end once explicitly prompted to use browser automation tools"*, with the caveat
   that browser-native alert modals were invisible to it and features relying on them
   *"tended to be buggier"* ([Effective harnesses][s3]). We already have Playwright, which
   is the right hook for this; we are simply not using it for anything yet.
6. **Property-based testing.** Emerging and promising (agentic PBT finding real bugs across
   the Python ecosystem at scale, with few false alarms; PBT-Bench now exists), but I did
   not find a credible write-up of a team running it inside a Next/TypeScript feature
   pipeline. Not yet for us.

#### The harness mechanisms we are not using

Claude Code now ships three things that turn a soft check into a hard gate, and we use none
of them:

- **`PostToolUse` cannot block.** The reference is explicit: *"Can block: No (exit 2 shows
  stderr to Claude, but tool already ran)."* The header comment in
  `.claude/hooks/verify.mjs` says `Exit 2 => block`, which is wrong: the edit has already
  landed, and exit 2 only feeds stderr back as a message the agent may act on. It is a
  useful *sensor*; it is not a gate. (The `"timeout": 200` in settings.json is in
  seconds — hook timeouts are configured in seconds — so it is consistent with the script's
  internal 180 s cap. Not a bug, but note that a full `lint` + `typecheck` after *every*
  source edit is tens of seconds of wall clock per edit, and both engineers run many edits.)
- **`SubagentStop` (exit 2) *can* block a subagent from finishing.** This is the correct
  place to enforce "backend-engineer does not get to report Done until typecheck and lint
  actually pass" and "qa-tester does not get to report until it has actually run the suite".
- **`Stop` (exit 2) blocks the main turn from ending**, with Claude Code overriding after 8
  consecutive blocks. This is where the four final gates belong.
- **`PreToolUse` (deny) can enforce file-scope ownership deterministically** — a
  frontend-engineer `Edit` under `app/api/**` gets denied rather than politely discouraged.
- **`type: "prompt"` and `type: "agent"` hooks** exist for judgement-shaped gates. An agent
  hook *"spawn[s] a subagent that can read files, search code, and use other tools to verify
  conditions"*; the documented example is literally *"Verify that all unit tests pass. Run
  the test suite and check the results."* Agent hooks are marked experimental — for
  production, prefer command hooks.
- **`/goal`** wraps a session-scoped Stop hook and has *"a separate evaluator [that] checks
  your condition after every turn, so completion is decided by a fresh model rather than the
  one doing the work"*. That property — grader ≠ worker — is the whole point.

---

### 4. Multi-agent orchestration

#### When multi-agent wins

Anthropic's research system is the strongest pro-multi-agent evidence, and it is careful
about scope: *"a multi-agent system with Claude Opus 4 as the lead agent and Claude Sonnet 4
subagents outperformed single-agent Claude Opus 4 by 90.2%"* on their internal research
eval. The mechanism they identify is blunt: *"token usage by itself explains 80% of the
variance"* on BrowseComp, with tool calls and model choice as the other two factors. Cost:
*"agents typically use about 4× more tokens than chat interactions, and multi-agent systems
use about 15× more tokens than chats."*

And then the sentence that matters most for us, from the same post:

> *"some domains that require all agents to share the same context or involve many
> dependencies between agents are not a good fit for multi-agent systems today. For
> instance, **most coding tasks involve fewer truly parallelizable tasks than research**."*

So: multi-agent excels at *"heavy parallelization, information that exceeds single context
windows, and interfacing with numerous complex tools"*. Research is that. Building one
feature in a small Next.js app is not.

#### The state of the practitioner argument

Cognition published the strongest sceptical position in June 2025 ([Don't build
multi-agents][s6]) and then substantially revised it in April 2026 ([Multi-agents: what's
actually working][s7]). The revision is more useful than the original, and it is the single
most relevant source to our specific shape.

Two principles from the original still stand:
1. *"Share context, and share full agent traces, not just individual messages."*
2. *"Actions carry implicit decisions, and conflicting decisions carry bad results."*

The 2026 update's thesis: multi-agent works in *"setups where multiple agents contribute
intelligence to a task while writes stay single-threaded."* Three patterns they say now
work in production:

- **Clean-context reviewer** — a review agent with no history from the coder. 2 bugs/PR,
  58% severe. Justified explicitly by context rot.
- **"Smart friend"** — a faster primary escalating to a stronger model. Works best between
  frontier-class models; the weak-primary/strong-helper version *"is still an open problem"*.
- **Manager-coordinator / map-reduce-and-manage** — *"a manager splits work, children
  execute, the manager synthesizes and reports back."* Under active development.

What still does not work: **parallel-writer swarms.** *"Parallel agents make implicit choices
about style, edge cases, and code patterns"* that conflict. And their summary of the residual
difficulty: *"The open problems are all communication problems."*

An empirical survey of 70 public agent harnesses ([Architectural design decisions in AI agent
harnesses][s13], April 2026) shows where the field actually sits: **30% are single-agent
only**; orchestrator-worker is 18.6%; multi-level recursive 12.9%; swarm/collective just
5.7%. Context handling is dominated by hybrid (27.1%) and file-persistent (22.9%)
strategies, with pure window-based at 4.3% — *"once frameworks move beyond narrowly bounded
sessions, context handling becomes an infrastructural concern."* Also notable, and relevant
to a COPPA-scoped product: **40% of surveyed systems have no audit capability at all** and
only 5% are tamper-evident.

#### The verdict on our specific shape

Our shape is: linear chain of six sequential single-purpose agents, one human gate, one
two-way parallel implementation step, Opus for deciding/verifying and Sonnet for executing.

**What the evidence endorses:**

- The **sequential chain** for a well-defined, repeatable task. This is Anthropic's prompt
  chaining pattern; it is the right complexity level.
- The **human gate after architecture**. Corroborated by Anthropic's own trends data:
  engineers use AI in *roughly 60%* of their work but report being able to *"fully
  delegate"* only *0–20%* of tasks ([2026 Agentic Coding Trends Report][s4]). Oversight
  belongs where a wrong decision is most expensive to unwind, which is the data model and
  the API contract. Keep this gate exactly as it is, including "Silence is not approval."
- The **fresh-context reviewer agents**. This is the pattern with the best production
  numbers behind it. Two of them, on Opus, at the end of the chain, is a good design.
- The **model split**. "Cheap generation, expensive verification" matches the evidence and
  matches Anthropic's own Opus-lead/Sonnet-worker configuration. One inconsistency: by our
  own stated rule, **qa-tester is a verifying role sitting on the cheap tier.** Deciding
  what an acceptance criterion really requires, and what unhappy path is missing, is
  judgement work. Move it to Opus or raise its effort.

**What the evidence argues against:**

- **The frontend/backend parallel split is the one part of our design the field has turned
  against.** It is a two-agent parallel-writer configuration. Our mitigations are the right
  ones — disjoint file scopes and a FIXED, fully-specified API contract — and they defuse the
  worst case (edit collisions). What they do not defuse is Yan's actual objection: implicit
  decisions at the seam. Which error codes the UI actually renders. Whether the loading
  state distinguishes "not yet fetched" from "empty". Whether the shared types live in
  `lib/` or are re-declared. Naming. These are decided twice, independently, by two agents
  that cannot see each other's work.

  Garg's second failure mode also applies directly: *"Two subagents independently
  reconstructed identical mental models of the codebase because the work split by task
  rather than cognitive locality."* Both of our engineers must read the spec, the plan, the
  contract and the existing patterns. For a codebase whose only source files are a starter
  page and two smoke tests, that duplicated orientation is most of the token cost.

  **Recommendation: collapse to one implementer.** Keep the API contract — its value is as a
  specification and a review artefact, not as a parallelisation enabler. The wall-clock
  saving is small on a project this size, and it is bought with duplicated orientation
  tokens plus an integration risk that nothing in the pipeline currently tests. Revisit if
  and when a milestone genuinely splits into two independent surfaces.

- **Agent teams: not yet.** They are experimental and disabled by default, with documented
  limitations that would specifically break us: no session resumption with in-process
  teammates, task status that lags and blocks dependents, and — the dangerous one — *"while
  agent teams are enabled, a subagent that Claude names launches as a teammate"*, and
  teammates report via an idle notification that *does not carry their output*. The docs
  spell out the consequence: *"An orchestration flow that waits on subagent results can
  stall."* Our `new-feature` skill is exactly such a flow. Leave `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`
  off.

- **Dynamic workflows: not for the main pipeline, yes for one specific job.** A workflow
  moves orchestration into a script the runtime executes, so *"Claude's context holds only
  the final answer"*, and it scales to *"dozens to hundreds of agents per run"*. Our pipeline
  is fixed, small, and already codified in a skill — a workflow would add machinery without
  removing a problem, and its constraint that there is *"no mid-run user input"* is
  incompatible with our mandatory approval gate. But the documented example
  — `use a workflow to audit every route handler under src/routes/ for missing authentication
  checks, and adversarially verify each finding before reporting it` — is a strictly better
  version of what security-reviewer does by hand, and worth trying as a supplement once we
  have more than zero routes.

---

### 5. Memory and handoff

#### The premise has changed

CLAUDE.md states: *"Agents do not learn between runs — every run starts blank. These files
ARE the memory."* That was true when written. It is now only half true.

Claude Code subagents support a **`memory:` frontmatter field** giving the agent a
persistent directory:

| Scope | Location | Use when |
|---|---|---|
| `user` | `~/.claude/agent-memory/<agent>/` | learnings apply across all projects |
| `project` | `.claude/agent-memory/<agent>/` | project-specific, **shareable via version control** |
| `local` | `.claude/agent-memory-local/<agent>/` | project-specific, not checked in |

Mechanics: the system prompt gains read/write instructions, `MEMORY.md` is preloaded (first
200 lines or 25 KB, whichever comes first, with instructions to curate past that), and
Read/Write/Edit are auto-enabled. The docs recommend `project` as the default scope
*"making subagent knowledge shareable via version control"* — which is precisely the
property CLAUDE.md says we moved the agents back into the repo to obtain.

This is Anthropic's **structured note-taking** technique implemented natively: *"the agent
regularly writes notes persisted to memory outside of the context window… persistent memory
with minimal overhead."*

**Where it fits us.** The reviewers benefit most, because their value compounds with
accumulated knowledge of repo patterns and recurring mistakes — which is exactly what the
retro currently harvests by hand, once every one to two weeks. Start with `memory: project`
on `code-reviewer` and `security-reviewer` only.

**Caveats that matter.**
- It is part of auto memory: *"if you turn auto memory off with the `autoMemoryEnabled`
  setting or `CLAUDE_CODE_DISABLE_AUTO_MEMORY` environment variable, the `memory` field has
  no effect"* — silently. Assert it in the retro rather than assuming.
- Unreviewed accretion is a drift vector. A wrong lesson persists and is preloaded into
  every future run. Treat `.claude/agent-memory/*/MEMORY.md` as reviewed source, read it at
  each retro, and prune. Memory does **not** replace the retro; it changes what the retro
  is for — from "write down the lesson" to "check the lessons the agents wrote down".
- Do not put memory on the implementers. An engineer that accumulates opinions about how
  this codebase should look is an engineer that will drift from the approved plan.

#### Established handoff patterns

Anthropic's long-running-agent work ([Effective harnesses][s3]) describes the
initializer/worker split and the artefacts that make handoff survive a blank context:
`init.sh` to bring the environment up, a `claude-progress.txt` log, git commits, and a
JSON feature list with per-item verification steps and a `passes: false` flag. The session
start checklist is mechanical: `pwd` → read the progress file → read the feature list →
check git log → run `init.sh` → verify basic functionality → pick the next item. The named
failure modes they were fixing are ours too: *declaring victory prematurely*, *leaving bugs
undocumented*, *marking features done without testing*, *time wasted rediscovering the
setup*.

The 70-harness survey confirms this shape is now standard: file-persistent and hybrid
context strategies dominate (50% combined), pure in-window is 4.3%.

**Our documents-as-memory approach is therefore the mainstream pattern, not an
improvisation.** Its failure modes are also well-known, and we have live examples:

1. **No referential integrity, and staleness is silent.** `docs/README.md` currently
   records that the M1 spec's 12-month source-file retention *"is superseded by M0's tiered
   table and must be revised before M1 is built"*. Two documents in the knowledge base
   contradict each other, right now, on a COPPA retention rule. An agent handed
   `docs/specs/m1-upload-and-extract.md` will read the wrong rule and never see the index
   note. The document rules are good; nothing enforces them.
2. **The index is hand-maintained.** Rule 6 ("Write it down when it is decided") depends on
   an agent choosing to. There is no sensor that fails when a doc is added without an index
   entry, or when a "Draft"/"Proposed" status has been stale for N milestones.
3. **Size.** `docs/plans/m0-m1-implementation.md` is 90 KB. That is context rot by
   construction for any agent asked to read it. Anthropic's own recommendation is the
   opposite: pointers plus on-demand loading.
4. **Two shadowing copies.** CLAUDE.md documents that project agents shadow the `~/.claude`
   ones and that improvements no longer flow in. That trade is fine, but the drift is
   already visible: the shadowed user-level `researcher` definition lacks `WebFetch` (so it
   can only read search summaries, never open a source), and the user-level `docs-writer`
   lacks `Bash`/`Grep`/`Glob`. Nothing detects the divergence.

**Fixes, in order of cheapness:** put a `> **SUPERSEDED BY …**` banner at the *top* of any
stale document rather than only in the index; add a doc-consistency script to the retro that
greps for supersession markers and unresolved blocking open questions; split the 90 KB plan
per milestone slice.

Also worth knowing for handoff: subagents can now be **resumed** via `SendMessage` with
their agent ID or name, retaining full history. That is a cheaper Phase-6 loop than
re-spawning qa-tester from scratch on every re-run.

---

### 6. Specs and plans as artefacts

#### What the practice actually recommends

Böckeler's taxonomy is the standard reference ([Understanding spec-driven development][s11]):

- **spec-first** — spec written first, used for the task, then discarded.
- **spec-anchored** — spec persists and evolves with the feature.
- **spec-as-source** — *"the spec is the main source file over time, and only the spec is
  edited by the human, the human never touches the code."*

Her observation: all shipping tools are really spec-first, whatever they aspire to.

**We are spec-anchored**, and deliberately so — specs, ADRs, plans and research all persist,
with explicit immutability rules for ADRs. That is the level the field's evidence best
supports.

The consensus on when it is worth the ceremony:

| Worth it | Not worth it |
|---|---|
| Multi-session features | Bug fixes |
| Work needing stakeholder review | Exploratory prototypes |
| Brownfield changes where contracts matter | Solo fast iteration ("plan mode plus good tests wins") |
| Compliance-adjacent work | Anything you could describe in one sentence |

Our M0 is a multi-session, compliance-adjacent, contract-heavy milestone. It is squarely in
the left column. Claude Code's own guidance agrees on what makes a spec good, and it
describes ours: *"The most useful specs are self-contained: they name the files and
interfaces involved, state what is out of scope, and end with an end-to-end verification
step that proves the feature works."* Our spec template has Non-goals, "Out of scope for
this milestone", and testable numbered ACs. Two of those three are present and strong.

#### Where the field disagrees with us

Böckeler's criticisms, applied honestly:

- **Ceremony must match problem size.** Her example: Kiro turned a small bug fix into *"4
  'user stories' with a total of 16 acceptance criteria."* Our `new-feature` skill has a
  Phase 0 escape hatch — *"If it is trivial (a typo, a copy tweak, a one-line fix), say so
  and exit this skill"* — which is genuinely good and more than most tools offer. But the
  gap between "trivial" and "full ten-phase pipeline" is enormous, and everything in it gets
  the full treatment. **We are missing a middle gear.** A three-phase `small-change`
  path — plan → implement → review + gates — would cover most of the work a real milestone
  actually contains.
- **Review burden.** *"I'd rather review code than all these markdown files."* Our M0 spec is
  39 KB with 52 acceptance criteria and the plan is 90 KB. For COPPA work that is arguably
  proportionate. It is also the point at which the human approval gate becomes hard to
  perform honestly, and an unread approval is worse than no gate. Consider requiring the
  architect's Phase 4 presentation to be a **decision-focused summary** — contract table,
  destructive migrations, new deps, open risks — with the full plan as a link, which is
  roughly what its report format already specifies. Enforce that; do not let the full plan
  be pasted into the approval message.
- **Agents ignore elaborate instructions.** *"Despite elaborate specifications and large
  context windows… the agent ultimately not follow all the instructions."* This is the same
  finding as "bloated CLAUDE.md gets ignored". A 52-AC spec is close to the ceiling.
- **The MDD warning.** On spec-as-source: *"Are we making something worse in the attempt of
  making it better?"* — we could *"end up with the downsides of both MDD and LLMs:
  Inflexibility and non-determinism."* This is the reason to not chase spec-as-source.

**A popular idea I would not adopt: GitHub Spec Kit.** 131,674 stars (verified 2026-08-26),
and the de facto standard. We already have a lighter equivalent of every part of it: its
"constitution" is our CLAUDE.md, its Specify/Plan/Tasks is our product-spec/architect/
implementation-order. What adopting it would add is its multi-file spec sprawl and
checklist volume — *"one spec is made up of many files"* — which is the exact review burden
Böckeler criticises. Borrow nothing but the constitution idea, which we have.

**Where the field agrees with us and it is worth saying out loud:** the resolution of
"SDD vs TDD" is *"Specifications define the contract; tests enforce it."* Our spec template
line — *"each must be observable from outside the system — no 'the code should be clean'"* —
and qa-tester's "Every AC needs at least one test" are that principle, correctly
implemented. The link is currently unenforced (see §9, change 3).

---

### 7. Evaluating an agent pipeline

#### What is measurable, cheaply

**The cheapest useful signal is a defect-escape ledger, and it is not an eval harness.**
For every defect found anywhere — hook, qa-tester, code-reviewer, security-reviewer, human
review, production — record: what it was, which stage caught it, and which stage *should*
have. Ten minutes per milestone in a markdown table. What it buys:

- A stage that stops catching anything is a stage that has stopped earning its tokens.
- A stage that catches things another stage was supposed to catch names the guide or sensor
  to fix. This is precisely Böckeler's steering loop: *"Whenever an issue happens multiple
  times, the feedforward and feedback controls should be improved."*
- You get an external benchmark for free: Cognition's clean-context reviewer runs at ~2
  bugs/PR with 58% severe. If our reviewers are finding 0.2, something is wrong with them or
  with the diffs they are shown.

Second-cheapest, already free: **tokens and duration per agent**. Subagent completion
notifications carry `total_tokens` and `duration_ms`, and the eval guidance notes these
*"aren't persisted anywhere else"* — so capture them. A `SubagentStop` hook appending one
line per run to a CSV is a few lines of script and gives a per-agent cost trend, which is
the fastest way to notice that an agent's definition got bloated.

#### When you do want a real eval

The published methodology is consistent and cheaper than people expect.

Anthropic: *"A prompt tweak might boost success rates from 30% to 80%. With effect sizes
this large, you can spot changes with just a few test cases"* — they started with ~20
representative queries. OpenAI's skill-eval guidance: *"a small set of 10–20 prompts is
enough to surface regressions and confirm improvements early."* Both say to start
deterministic and add model judgement only where a deterministic check cannot decide.

Claude Code ships the machinery via the `skill-creator` plugin, and the format is documented
([Evaluating skill output quality][s16]). The loop:

- `evals/evals.json` in the skill directory: `prompt`, `expected_output`, optional `files`,
  and `assertions` added *after* the first run ("you often don't know what 'good' looks like
  until the skill has run").
- One subagent per test case for clean context; `timing.json` records tokens and duration.
- `grading.json` records PASS/FAIL **with evidence** per assertion. Grading principle:
  *"Require concrete evidence for a PASS. Don't give the benefit of the doubt."*
- `benchmark.json` aggregates pass rate, time and tokens **with-skill vs without-skill**, so
  you can see what the skill costs and what it buys. *"A skill that adds 13 seconds but
  improves pass rate by 50 percentage points is probably worth it. A skill that doubles token
  usage for a 2-point improvement might not be."*
- Blind A/B between two versions before committing an edit.
- Description tuning with should-trigger / should-not-trigger prompts.

The analysis rules are the genuinely valuable part and generalise beyond skills:
- *Remove assertions that always pass in both configurations* — they inflate the score.
- *Investigate assertions that always fail in both* — broken assertion or wrong test.
- *Study assertions that pass with and fail without* — that is where the value is.
- *High variance across runs means ambiguous instructions*, not just model randomness.
- *"If pass rates plateau despite adding more rules, the skill may be over-constrained — try
  removing instructions and see if results hold or improve."*

Two more disciplines worth importing: **separate capability evals from regression evals**
(capability: low pass rate, an improvement target; regression: near-100%, a protection
target — mixing them produces wrong prioritisation), and **calibrate any LLM judge against a
human gold set before you ever gate on it.**

**What we must not do:** judge the pipeline by whether `pnpm test` passes. The suite is
written by the pipeline. That is the definition of an un-held-out eval.

**Timing:** building an eval suite now, with two smoke tests and zero features shipped,
would be premature. The ledger costs ten minutes and works immediately. Revisit the eval
suite after two or three milestones, when there is a real failure history to draw test cases
from — which is what every source says to do anyway.

---

### 8. Anti-patterns — including ours

Recurring mistakes in the literature, each marked with whether we have it.

1. **Verification by compilation.** "It typechecks so it works." — **WE HAVE THIS.** Both
   engineer agents define Done as *"`pnpm typecheck` and `pnpm lint` both pass."* Nothing
   in an implementer's loop executes the code.
2. **Test author = test grader.** — **WE HAVE THIS.** qa-tester writes the tests, runs the
   tests, and reports the verdict. Every published reward-hacking mitigation separates
   these.
3. **Prose as control.** Rules with no enforcing sensor. — **WE HAVE THIS, extensively.**
   "zod at every boundary", "Prisma in server code only", "server components by default",
   "no `any` without a justifying comment", "typed error shape on every path", "never edit
   an applied migration", "Tailwind utilities only", "never add a major dependency". Eight
   rules, zero sensors. Several are trivially enforceable by an eslint rule or a ten-line
   script.
4. **Self-reported gates.** — **WE HAVE THIS.** The engineer report formats ask for
   ``` `pnpm typecheck`: PASS|FAIL ``` with no evidence attached. Best practice: *"Have
   Claude show evidence rather than asserting success: the test output, the command it ran
   and what it returned."* Our own `commit-and-pr` skill already gets this right — *"Never
   write PASS for a gate you did not run — that is the one thing that makes this section
   worthless."* Apply the same rule to the agent report formats.
5. **Uniform ceremony regardless of change size.** — **PARTIALLY.** Phase 0 handles trivial;
   nothing handles medium.
6. **Documents-as-memory with no referential integrity.** — **WE HAVE THIS, live.** The
   M1/M0 retention contradiction.
7. **Oversized context artefacts.** — **WE HAVE THIS.** A 90 KB plan and a 39 KB spec fed to
   implementers.
8. **Human process narrative in CLAUDE.md.** — **WE HAVE THIS.** ~1.5 KB of retro/ownership
   rationale loaded into every subagent that will never act on it.
9. **Parallel writers.** — **WE HAVE THIS, mitigated.** Two implementers; disjoint scopes and
   a fixed contract are the correct mitigations, but implicit decisions at the seam remain.
10. **The kitchen-sink orchestrator.** Context polluted by everything every subagent
    returned. — **AT RISK.** Ten phases of reports accumulate in one session.
11. **Over-privileged agents.** — **MINOR.** `docs-writer` has `Bash`. A documentation agent
    that can run arbitrary commands is a least-privilege miss with no upside; it needs
    `Read`, `Write`, `Edit`, `Grep`, `Glob`.
12. **No audit trail.** 40% of surveyed harnesses have none. — **WE HAVE THIS**, and for a
    product handling children's data it is the one on this list with regulatory teeth. There
    is currently no record of which agent changed what, on which run.
13. **Chasing every reviewer finding.** — **NOT PRESENT**, and our severity ladders are why.
    Worth protecting at retro time.

**Things we do that the literature would praise, and that should not be "improved":** scoped
`tools:` per agent; mandated report formats that bound what returns to the orchestrator;
explicit non-scope in each agent ("NOT yours: …"); the "report, do not fix" separation for
reviewers; the immutability rule for ADRs; "Only act on repeated patterns" in the retro;
"Silence is not approval."

---

### 9. What to change

Ordered by (value ÷ cost). Evidence tiers: **[ESTABLISHED]** = vendor documentation plus
multiple independent corroborating sources; **[EMERGING]** = two or more credible
practitioner sources, limited measurement; **[ONE TEAM]** = a single blog post's experience.

---

**1. Turn the eight prose rules into sensors.** — *[ESTABLISHED]*

The highest-leverage change by a wide margin, because it converts eight probabilistic
guarantees into deterministic ones and simultaneously shortens the reviewers' work.

- eslint: `@typescript-eslint/no-explicit-any` as an error; `no-restricted-imports`
  forbidding the generated Prisma client from `components/**` and from any `"use client"`
  file; `max-lines`, `max-lines-per-function`, `complexity` at generous thresholds.
- A ~30-line script that enumerates `app/api/**/route.ts` and fails if a handler does not
  reach a known auth helper and a `.parse(`/`.safeParse(` call. This converts
  security-reviewer's mandatory checks 1 and 2 from LLM judgement into a gate.
- A script that counts new `eslint-disable` and `// eslint-disable-next-line` and `any`
  occurrences in the diff and reports them in the review. Not a failure — a spotlight.
- Follow Böckeler on message design: sensor output should tell the agent what to do, not
  just what is wrong.

*Cost:* half a day. *Risk:* over-tight rules push complexity elsewhere — she observed
`max-lines` and `max-lines-per-function` fighting each other. Start generous.

---

**2. Make the gates actually gate.** — *[ESTABLISHED]*

- Add a **`SubagentStop`** command hook matched on `backend-engineer|frontend-engineer`
  that runs typecheck + lint and exits 2 on failure. The engineer cannot report Done on a
  red tree; today it can, and only its own honesty prevents it.
- Add a **`SubagentStop`** hook on `qa-tester` that fails if `pnpm test` was not actually
  executed in that subagent's session, or if the run was red.
- Add a **`Stop`** hook running the four gates before the orchestrating turn can end.
- Add a **`PreToolUse`** deny for `Edit|Write` outside each implementer's declared scope.
  This makes the "NOT yours" section enforced rather than advisory, and removes the entire
  class of parallel-write conflicts.
- Fix the comment in `verify.mjs`: `PostToolUse` does not block.
- Consider dropping `pnpm lint` from the per-edit `PostToolUse` hook and keeping only
  `typecheck` there, moving lint to the SubagentStop gate. Running both on every edit is the
  dominant per-edit latency cost and the feedback is redundant with the stop gate.

*Cost:* a few hours. *Risk:* a Stop hook that blocks repeatedly is overridden after 8
consecutive blocks, so it degrades safely rather than deadlocking.

---

**3. Separate test authorship from test grading.** — *[ESTABLISHED]*

The reward-hacking literature is unambiguous and our exposure is concentrated in one agent.

- Add a `PreToolUse` deny on `Edit|Write` under `tests/**` for every agent that is not
  qa-tester. Today, an engineer fixing a QA failure can edit the failing test.
- Add a check that flags any commit where a test file and the source it exercises changed
  together with a shrinking assertion count.
- Change qa-tester's report format to require **pasted command output**, not `PASS|FAIL`.
  Its own rule — *"Verify each new test fails before the fix"* — should produce evidence:
  the red run, then the green run.
- Longer term, the clean split is qa-tester writes tests and a separate cheap grader runs
  them. `/goal` is the lightweight version of this: *"completion is decided by a fresh model
  rather than the one doing the work."*

*Cost:* an hour for the denies and the report format; more for a true split.

---

**4. Cut the two implementers to one.** — *[EMERGING, and the field is genuinely split]*

**For:** Cognition's April 2026 position that writes should stay single-threaded; Anthropic's
own statement that *"most coding tasks involve fewer truly parallelizable tasks than
research"*; Garg's duplicated-orientation cost; and the plain fact that our codebase is
small enough that both agents read the same files to orient.

**Against:** Anthropic's parallelisation-by-sectioning pattern is a legitimate workflow
pattern; the API contract does defuse the worst failure mode; and wall-clock latency is a
real cost on a milestone with 52 acceptance criteria.

**My call: collapse it.** Keep the API contract as a specification and review artefact. If
we later find a milestone that genuinely splits into independent surfaces, split it then,
and pay the integration-test cost explicitly. The current split buys latency we are not
short of and spends tokens and seam risk we have no sensor for.

*Cost:* an edit to the skill and merging two agent definitions. *Reversible.*

---

**5. Add a coverage gate and mutation testing on the diff.** — *[EMERGING → ESTABLISHED for coverage]*

The 4,882-PR study is the argument: agent tests exist far less often than assumed, and error
paths are untested 81–86% of the time.

- Turn on `vitest --coverage` with a **diff-coverage** threshold, not a global one. Global
  thresholds are gameable by adding tests anywhere; diff coverage is not.
- Add a `mutate` script scoped to changed files (Stryker), run at the QA stage, reported
  rather than gated at first. Böckeler's 100%-coverage/13-survivors example is the reason.
- Explicitly require qa-tester to cover thrown/caught error paths. Its "Cover the unhappy
  paths" line already says this; the coverage report makes it checkable.

*Cost:* a day, plus real CI time. *Risk:* mutation testing is slow — scope it to the diff
or it will not survive contact with the pipeline.

---

**6. Trim what is loaded into every context.** — *[ESTABLISHED]*

- Move the "Retro cadence" and "Agents and skills" ownership sections out of CLAUDE.md into
  `docs/` and link them. They are for humans; they are currently paid for by every subagent.
- Split `docs/plans/m0-m1-implementation.md` (90 KB) into per-slice plans.
- Change the `new-feature` skill to pass **paths and the index**, not documents, and have
  each phase write its report to a run log the next phase can read selectively.

*Cost:* an hour or two. *Immediate token saving on every single run.*

---

**7. Start a defect-escape ledger.** — *[ESTABLISHED as practice, cheap enough not to argue about]*

One markdown table. Columns: date, defect, caught by, should have been caught by, guide or
sensor added. Reviewed at the retro. Also log `total_tokens`/`duration_ms` per subagent from
a `SubagentStop` hook. This is the measurement layer we currently have none of, and it is
what makes every other change on this list assessable.

*Cost:* ten minutes per milestone.

---

**8. Give the two reviewers `memory: project`.** — *[EMERGING — the feature is documented, the practice is new]*

`.claude/agent-memory/code-reviewer/MEMORY.md` and the same for security-reviewer, both
committed. Add a line to each definition telling it to consult memory before reviewing and
write what it learned after. Review and prune those files at every retro — an unreviewed
memory is a drift vector, and this is the change on the list with the highest chance of
making things quietly worse if left unattended. Assert that `autoMemoryEnabled` is on, since
the field silently no-ops otherwise.

*Cost:* minutes to enable, ongoing attention at retro.

---

**9. Add a middle gear between "trivial" and "full pipeline".** — *[EMERGING]*

A `small-change` skill: plan → implement → code-review → four gates. Böckeler's central
criticism of SDD is that the universal failure mode is *"applying full SDD to work requiring
minimal specification"*. Phase 0's trivial escape hatch is not enough on its own.

*Cost:* an hour to write; saves a great deal of ceremony over time.

---

**10. Move qa-tester to Opus; take `Bash` off docs-writer.** — *[EMERGING / hygiene]*

By our own stated rule, verifying roles run on Opus and qa-tester is a verifying role.
docs-writer does not need shell access. Both are one-line changes.

---

**11. Use Playwright for visual verification on UI work.** — *[EMERGING]*

We already have the dependency. Screenshot-and-compare is the documented technique for
closing the loop on UI, and Anthropic's own long-running-agent work found browser
verification worked once explicitly prompted — with the caveat that browser-native modals are
invisible to the agent, so avoid designing flows around them.

---

**Explicitly not recommended:**

| Idea | Why not |
|---|---|
| GitHub Spec Kit | We have a lighter equivalent; adopting it imports the multi-file spec sprawl and review burden Böckeler criticises. |
| Spec-as-source / Tessl-style | *"the downsides of both MDD and LLMs: Inflexibility and non-determinism."* |
| Agent teams | Experimental, disabled by default, and a named subagent silently becoming a teammate would stall our result-waiting orchestration. |
| Dynamic workflows for the main pipeline | No mid-run user input, which is incompatible with our mandatory approval gate. Worth trying only for fan-out audits. |
| LLM-as-judge as a CI gate | Not until calibrated against a human gold set. Deterministic layers first. |
| A full eval harness now | Premature with zero features shipped. The ledger first; revisit after two or three milestones. |
| More rules in agent definitions | *"If pass rates plateau despite adding more rules, the skill may be over-constrained."* Our definitions are already at a good altitude. Add sensors, not sentences. |

## Risks and unknowns

**What I could not verify.**

- I could **not** get useful detail out of three arXiv PDFs. `2607.02389` (steerability via
  constraints), `2603.05344` (terminal coding agent harnesses) and `2605.21384` (SpecBench)
  all returned generic, low-specificity summaries via the fetch tool — I did not read the
  full papers, and nothing above depends load-bearingly on them. Treat any specific number
  attributed to them as unverified.
- I could **not** find a genuinely good published post-mortem from a team running a *fixed
  multi-agent build pipeline* in anger. The closest primary material is Cognition's two
  posts (product experience, not a post-mortem), Garg's orchestrator-tax session write-up,
  and Böckeler's sensor experiments. Searching for team post-mortems surfaced almost
  entirely **content-farm and vendor material** — Medium reposts, `dev.to` listicles,
  "2026 playbook" SEO pages, and vendor guides (Augment Code, MLflow, skills-hub,
  developersdigest, totalum). I read none of them as evidence, and the "error accumulation
  by step four" framing in §1 comes from that tier and should be treated as a plausible
  description, not a measured finding.
- The Anthropic **2026 Agentic Coding Trends Report** is a marketing document — predictions,
  customer logos, no methodology for most figures. The two numbers I used from it (60% of
  work uses AI / 0–20% fully delegated; 27% of AI-assisted work would not otherwise have been
  done) are attributed to internal Societal Impacts research, which I did not read directly.
- The VibeSec figures (25% of AI code with confirmed vulnerabilities, 1 in 5 breaches) are
  cited by that article from third-party industry reports I did not open. Directional only.
- The ianhxu field study cites a Piskala arXiv paper claiming human-refined specs cut LLM
  code-generation errors by ~50%, and star counts of ~118k for spec-kit and ~59.6k for GSD.
  I did not open the Piskala paper. I **did** check spec-kit directly: **131,674 stars on
  2026-08-26**, so the field study's figure was already stale — a good reminder that star
  counts in secondary sources age badly.

**Repo quality judgements** (stars verified 2026-08-26 via the GitHub API):

- `anthropics/skills` (171,800) and `anthropics/claude-plugins-official` (34,324) — primary,
  first-party, and `skill-creator` in the latter is the concrete eval tooling referenced in §7.
- `github/spec-kit` (131,674) — substantive and genuinely influential, but see the
  recommendation against adopting it. Stars here measure reach, not fit.
- `ai-boost/awesome-harness-engineering` (3,817) — a curated list, but with editorial
  commentary rather than bare links; useful as a map of the field. Still a list.
- `Picrew/awesome-agent-harness` (1,671), `bradagi/awesome-cli-coding-agents` (1,087) — bare
  listicles. Low value.
- `ianhxu/agentic-engineering-field-study` (**4 stars**) — the clearest case that stars do
  not track quality. It is a careful, well-sourced synthesis with a real taxonomy and real
  criticism, and it pointed me at the Böckeler material. Judge repos by whether they cite
  primary sources and disagree with themselves; this one does both.

**Things that could bite us later.**

- Subagent `memory` is new; it is coupled to auto memory, and turning auto memory off
  disables it *silently*. Anything we build on it should assert that it is active.
- Everything in §3 and §9 assumes the Claude Code hook surface as documented on 2026-08-26.
  Hook event names, blocking semantics and the experimental status of agent hooks have all
  changed within the last year and will change again. Re-read `code.claude.com/docs/en/hooks`
  before implementing.
- The multi-agent question is the one place the field genuinely disagrees. Anthropic
  measured a 90.2% win from multi-agent on research; Cognition argues parallel writers are
  fragile. **Both are right, about different workloads.** If someone later cites the 90.2%
  figure to justify more parallel implementers, note that it is a research benchmark, that
  the same post says coding parallelises poorly, and that it cost 15× the tokens.
- Recommendation 4 (collapsing the implementers) is the most contestable item on the list and
  the easiest to reverse. If it is adopted and a later milestone genuinely has two
  independent surfaces, split it again and add an integration test at the seam.

## Sources

- <https://www.anthropic.com/engineering/building-effective-agents> — workflow vs agent, the five workflow patterns, the agent loop, tool design, "only increase complexity when needed"
- <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents> — context rot, smallest high-signal token set, altitude, compaction, structured note-taking, sub-agent isolation, just-in-time retrieval
- <https://www.anthropic.com/engineering/multi-agent-research-system> — 90.2% multi-agent win, 15× token cost, 80% of variance from token usage, "most coding tasks involve fewer truly parallelizable tasks than research", eval methodology
- <https://www.anthropic.com/engineering/writing-tools-for-agents> — evaluation-driven tool development, token-efficient tool responses, prompt-engineering tool descriptions
- <https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents> — initializer/coding-agent split, progress files, JSON feature lists with per-item verification, browser-automation verification and its limits
- <https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills> — progressive disclosure, skill authoring, "identify gaps by running on representative tasks"
- <https://code.claude.com/docs/en/best-practices> — "give Claude a way to verify its work", the four ways to gate a stop, adversarial review subagent, CLAUDE.md pruning, context management, common failure patterns
- <https://code.claude.com/docs/en/sub-agents> — context isolation, what loads at startup, nesting/concurrency limits, resume via SendMessage, and the `memory:` frontmatter field and its scopes
- <https://code.claude.com/docs/en/hooks> — every hook event, what each can block, exit-code semantics; PostToolUse cannot block, SubagentStop and Stop can
- <https://code.claude.com/docs/en/hooks-guide> — timeout units (seconds), prompt-based hooks, experimental agent-based hooks for verification
- <https://code.claude.com/docs/en/goal> — `/goal` as a session-scoped Stop hook with a separate evaluator; completion judged by a fresh model
- <https://code.claude.com/docs/en/workflows> — dynamic workflows, when to use them vs subagents/skills/teams, adversarial cross-checking, limits and costs
- <https://code.claude.com/docs/en/agent-teams> — agent teams, experimental status, limitations, and the named-subagent-becomes-teammate footgun
- <https://code.claude.com/docs/en/skills> — the skill-creator eval loop: evals.json, grading.json, benchmark.json, blind A/B, description tuning
- <https://agentskills.io/skill-creation/evaluating-skills> — full eval file format, assertion-writing guidance, grading principles, pattern analysis, the iteration loop
- <https://martinfowler.com/articles/harness-engineering.html> — Böckeler, 2 Apr 2026: guides vs sensors, computational vs inferential, the three harness categories, the steering loop
- <https://martinfowler.com/articles/sensors-for-coding-agents.html> — Böckeler, 27 May 2026: concrete maintainability sensors, mutation testing findings, LLM-optimised sensor messages, the sidecar CLI
- <https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html> — Böckeler: spec-first/anchored/as-source taxonomy, Kiro/spec-kit/Tessl critique, review burden, the MDD warning
- <https://martinfowler.com/articles/orchestrator-tax.html> — Garg, 16 Jul 2026: context pollution vs token cost, duplicated orientation, 2–4 agents per wave, never fetch full transcripts for status
- <https://martinfowler.com/articles/vibesec-reckoning.html> — 27 May 2026: "telling an AI agent to be safe is not the same as enforcing that it is safe", security defect rates, deterministic sensors over prompts
- <https://cognition.com/blog/dont-build-multi-agents> — Yan, 12 Jun 2025: the original case against parallel subagents, the two context-engineering principles
- <https://cognition.com/blog/multi-agents-working> — Yan, 22 Apr 2026: writes stay single-threaded, clean-context reviewer at 2 bugs/PR (58% severe), smart friend, map-reduce-and-manage
- <https://arxiv.org/abs/2604.18071> — 70-harness empirical survey: 30% single-agent, context strategy distribution, 40% with no audit trail, five architectural patterns
- <https://arxiv.org/html/2607.18057> — 4,882 agentic PRs: 50.4% with no test change, diff coverage by language, error paths untested in 81–86% of cases
- <https://github.com/ianhxu/agentic-engineering-field-study/blob/main/04-spec-driven-development.md> — 4-star but substantive SDD field study; the pointer to the Böckeler critique
- <https://testdouble.com/insights/keep-your-coding-agent-on-task-with-mutation-testing> — Lindsay: wiring Stryker into an agent loop scoped to changed files, and the caveats
- <https://developers.openai.com/blog/eval-skills> — 10–20 prompts, deterministic checks before model-assisted grading, negative controls, CI integration
- <https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf> — marketing document; the usable figures are 60% of work AI-assisted / 0–20% fully delegated, and 27% of AI-assisted work that would not otherwise have been done
- <https://github.com/ai-boost/awesome-harness-engineering> — 3,817-star curated list with commentary; useful as a field map, not as evidence

---

**Note on staleness:** research goes out of date silently. Anything in here is
only true as of the Date above. Re-verify version numbers, pricing, and API
shapes before relying on them for a new decision.
