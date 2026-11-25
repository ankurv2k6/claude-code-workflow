---
description: Shared protocol, not a standalone command. Effort level, model, form and hand-back size for each agent role, plus the delegation, context and token rules every agent-launching command follows.
disable-model-invocation: true
---
<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: every command that launches an agent
Generated: 2026-10-27 (an 18-module batch ran on ~25 agents where the old commands would have launched up to 630)
Last audit: 2026-11-25 (v2: context budget, enforced hand-back, batched reads, model by role. Lanes had
reached about 200k tokens of context before their first edit, at about one tool call per turn)
-->

# Effort and token budget

**The cheapest agent is the one not launched.** Every launch passes an `effort` level (and the model, when
its row names one), and its brief names the row of the table below that it uses.

## Precedence

1. A level or model the user states for this task.
2. A project or user rule (CLAUDE.md, memory, or the profile's `agents.*`, per `_shared-project-profile.md`),
   e.g. "every background agent runs at high". It replaces the table for that project.
3. The table below.

## Roles

| Role | Effort | Model | Form | Hand-back |
|---|---|---|---|---|
| Implementation lane (writes code, 1–3 modules) | high | session default | background agent in its own worktree | 30 lines |
| Independent verifier (one per lane; also preps the merge) | high | `agents.verifier_model` (default `opus`) | background agent in the lane's worktree | 30 lines |
| Integration-fix pass (reds not in the known-reds file) | high | session default | background agent in its own worktree | 30 lines |
| Design foundation (shared sheets, chrome, fixtures) | high | session default | agent, before any screen agent | 30 lines |
| Design area: wireframes for 3–6 screens (makes each screen's Show / On demand / Omit decisions) | high | session default | background agent | 15 lines |
| Design area: mockups for 3–6 screens (renders wireframes whose decisions are already made) | medium | doc-only: Sonnet if `agents.overrides` allows | background agent | 15 lines |
| Spec verifier, blueprint set | high | `agents.verifier_model` | 1 agent, one round (a second only to check a CRITICAL fix); a set too big for one context splits central vs module files, still one round | 30 lines |
| Spec verifier, design set | high | `agents.verifier_model` | 2 agents split by file ownership, never more on the same files | 30 lines |
| Accessibility check (never the agent that chose the colours) | medium | `agents.verifier_model` | agent | 20 lines |
| Code search across many files | medium | the agent type's default | Explore agent | the conclusion only |
| Structural check: file exists, counts, hashes, links, journal order, map coverage | — | — | a script; read the exit code | — |
| Lookup with a known target | — | — | an inline tool call | — |

**Verifiers always run on `agents.verifier_model`** (default `opus`); an override never moves a verifier.
Only a doc-only role (one that writes documents, never code or verdicts) may move to Sonnet, and only when
`agents.overrides` names it. **One exception, a pilot:** when `agents.overrides` names `ui-lane-pilot`
(e.g. `"ui-lane-pilot": "sonnet"`), one UI implementation lane per batch may run on that model, recorded in
the Decision log; its verifier stays on `agents.verifier_model`, and the batch's build report compares the
lane's findings and cost with the others'. No profile: every role runs on the session default.

## Delegation rules

- **Delegate only what repays a cold start:** independent work across many files or hours. Do a check
  whose target you already know yourself.
- **Script what is mechanical.** Never spend an agent reading files to count, compare or hash them.
- **No agents inside lanes.** A lane does its module work itself; the separate verifier replaces any
  in-lane review fan-out.
- **Split reviewers by file ownership**, never several agents over the same files.
- **At most `agents.max_concurrent` lanes at once** (default 5; `max_lanes` in the task-list header). More
  lanes mean more merge conflicts and an orchestrator context full of notifications.
- **No turn caps or wall-clock timeouts.** Bound work by its size (`/blueprint` lane map: at most 3 modules
  or about 8 screens) and each session by the context budget.

## Context budget

- **A session ends at a task boundary once its context passes `limits.context_budget_tokens`** (default
  200,000). It commits, updates its progress note and hands back `Session split`; the orchestrator relaunches
  it from its brief. Small tasks stay together: each new session pays about 45k tokens to start.
- **Read by anchor, not by file.** Read the task's section of the impl spec and the contracts it names;
  master documents only when the task needs them. Use ranged reads (offset and limit, or a heading search),
  never `cat` of a large file.
- **Batch independent reads in one turn.** Files you will read anyway go in the same turn, not one per turn.
- **No re-reads.** Don't re-read a file after editing it.

## Hand-back

- **The report is the final reply,** at most `limits.handback_lines` (default 30) lines, under the fixed
  headings the command or brief names. Never write it to a report file; the harness may refuse the write.
- **Details go to files.** Full findings go to the agent's scratch directory; the reply names the path.
  The orchestrator never reads an agent's transcript unless the agent stalls.

## Token rules

- **Briefs point, they don't paste.** Under 60 lines, naming the sections to read (by anchor) and one shared
  rules file. CLAUDE.md is cited by section, never copied: every agent loads it already.
- **Load per task, not per module.** A module manifest stays within 14k tokens; UI detail lives in the
  impl spec and `ui-mapping`, not inline in the blueprint.
- **No repeated broad test runs** (`_shared-test-selection.md`).
