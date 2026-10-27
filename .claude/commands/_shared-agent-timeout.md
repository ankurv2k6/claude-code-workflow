---
description: Shared protocol, not a standalone command. How a command waits for its agents, detects a stall and degrades gracefully, without blocking calls or wall-clock ceilings on long work.
disable-model-invocation: true
---
<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: analyze-plan, verify-implementation, design-ui, implement-batch, blueprint (--verify)
Generated: 2026-02-25
Last audit: 2026-10-27 (rewritten: completion by notification; a 30-minute module ceiling would have
marked every lane of a real batch TIMEOUT — lanes ran 3–6 hours)
-->

# Agent completion and stalls

## Waiting

- **Launch in the background and wait for the completion notification.** Never block on a task-output
  call, never poll an agent's output file, and never read its transcript into your context.
- **While agents run, do other independent work** (the next launch, a merge, the task list).
- **Never predict or fabricate a result** you have not received. If asked, say the agent is still
  running.

## Sizing instead of ceilings

- **Long work gets no wall-clock timeout and no turn cap.** A lane or verifier may run for hours. Keep
  it bounded by its size (`/blueprint`'s lane map), not by a timer.
- **Short work states its own bound in its brief**, e.g. "report within 20 tool calls" for a per-file
  audit or a search. If it comes back incomplete, mark that part `[PARTIAL]` and continue with what you
  have.

## Stall detection

An agent has stalled when neither its worktree's latest commit nor its `.lane/progress.md` has changed
for 45 minutes (configurable as `stall_minutes` in the task-list header) and no notification arrived.

1. `SendMessage` the agent asking for a one-line status.
2. No reply, or a failure notification → treat it as dead and run the resume procedure in
   `~/.claude/commands/_shared-agent-tracking.md`.
3. Record the stall and its outcome in the Checkpoint log.

## Graceful degradation

- **One agent's failure never blocks the others.** Mark its part `[PARTIAL]` or `AUDIT-INCOMPLETE-*`,
  continue with the data you have, and list the gap in the report.
- **Partial work is kept.** Commits stay on the lane branch; a relaunch continues from them.
- **Track status in one line:** `AGENTS: [✓] lane-a | [✓] verify-a | [running] lane-b | [dead→relaunched] lane-c`.
