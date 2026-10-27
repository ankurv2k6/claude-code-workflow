---
description: Shared protocol, not a standalone command. Effort level, form and report size for each agent role, plus the delegation and token rules every agent-launching command follows.
disable-model-invocation: true
---
<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: every command that launches an agent
Generated: 2026-10-27 (an 18-module batch ran on ~25 agents where the old commands would have launched up to 630)
Last audit: 2026-10-27
-->

# Effort and token budget

**The cheapest agent is the one not launched.** Every launch passes an `effort` level, and its brief
names the row of the table below that it uses.

## Precedence

1. A level the user states for this task.
2. A project or user rule (CLAUDE.md or memory), e.g. "every background agent runs at high". It
   replaces the table for that project.
3. The table below.

## Roles

| Role | Effort | Form | Report cap |
|---|---|---|---|
| Implementation lane (writes code, 1–3 modules) | high | background agent in its own worktree | 40 lines |
| Independent verifier (one per lane; also preps the merge) | high | background agent in the lane's worktree | 30 lines |
| Integration-fix pass (after the last lane merges) | high | background agent in its own worktree | 30 lines |
| Design foundation (shared sheets, chrome, fixtures) | high | agent, before any screen agent | 30 lines |
| Design area (wireframes or mockups for 3–6 screens) | medium | background agent | 15 lines |
| Spec verifier (blueprint or design set) | high | 2 agents split by file ownership, never more on the same files | 30 lines |
| Accessibility check (never the agent that chose the colours) | medium | agent | 20 lines |
| Code search across many files | medium | Explore agent | the conclusion only |
| Structural check: file exists, counts, hashes, links, journal order, map coverage | — | a script; read the exit code | — |
| Lookup with a known target | — | an inline tool call | — |

## Delegation rules

- **Delegate only what repays a cold start:** independent work across many files or hours. Do a check
  whose target you already know yourself.
- **Script what is mechanical.** Never spend an agent reading files to count, compare or hash them.
- **No agents inside lanes.** A lane does its module work itself; the separate verifier replaces any
  in-lane review fan-out.
- **Split reviewers by file ownership**, never several agents over the same files.
- **At most 5 lanes at once** (`max_lanes` in the task-list header). More lanes mean more merge
  conflicts and an orchestrator context full of notifications.
- **No turn caps or wall-clock timeouts on lanes.** Lanes of 3–6 hours and 1,000+ tool calls are
  normal; size the lane instead (`/blueprint` lane map: at most 3 modules or about 8 screens).

## Token rules

- **Briefs point, they don't paste.** Under 60 lines, naming the files to read and one shared rules file.
- **Reports are short; details go to files.** The agent writes full findings to its scratch directory
  and reports the path. The orchestrator never reads an agent's transcript unless the agent stalls.
- **Load per task, not per module.** A module manifest stays within 14k tokens; UI detail lives in the
  impl spec and `ui-mapping`, not inline in the blueprint.
- **No re-reads.** Don't re-read a file after editing it; read only the range you need from a big file.
- **No repeated broad test runs** (`~/.claude/commands/_shared-test-selection.md`).
