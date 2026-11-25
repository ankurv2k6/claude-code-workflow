---
description: Shared protocol, not a standalone command. How a command waits for its agents, detects a stall with the watchdog and degrades gracefully, without blocking calls or wall-clock ceilings on long work.
disable-model-invocation: true
---
<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: analyze-plan, verify-implementation, design-ui, implement-batch, blueprint (--verify)
Generated: 2026-02-25
Last audit: 2026-11-25 (v2: the watchdog. A commit-only stall check would fire during every long gate,
and the orchestrator never polls, so a stalled lane sat unnoticed for hours)
-->

# Agent completion and stalls

## Waiting

- **Launch in the background and wait for the completion notification.** Never block on a task-output
  call, never poll an agent's output file, and never read its transcript into your context.
- **While agents run, do other independent work** (the next launch, a merge, the task list).
- **Never predict or fabricate a result** you have not received. If asked, say the agent is still
  running.

## Sizing instead of ceilings

- **Long work gets no wall-clock timeout and no turn cap.** Bound it by its size (`/blueprint`'s lane map)
  and each session by the context budget (`_shared-effort-budget.md`).
- **Short work states its own bound in its brief**, e.g. "report within 20 tool calls" for a per-file
  audit or a search. If it comes back incomplete, mark that part `[PARTIAL]` and continue with what you
  have.

## The watchdog

A lane is **stalled** when, for `limits.stall_minutes` (default 45; no profile: `stall_minutes` in the
task-list header), none of these moved and no notification arrived: its latest commit, its
`.lane/progress.md`, its newest file in `logs_dir` (an absolute, shared `logs_dir`: the files naming the
lane). **A lane is not stalled while** it holds a heavy-job slot (slot.sh records its own pid and its
command's, so a killed slot.sh still counts while the command runs; a `self_locking` job's own lock files
count too), waits in the queue for one (slot.sh's `<lock_dir>/waiting/<pid>` marker), or has a live
process whose cwd is inside its worktree (a long test run; `lsof -a -d cwd` on macOS, `/proc/*/cwd` on
Linux). The report names the process, so a dev server the lane left running is easy to spot; `--no-proc`
turns that check off.

Start it once the first lane is running, in the background, so its exit wakes you:

```bash
node "$WH/scripts/workflow/watchdog.mjs" --task-list <task list> --stall-minutes <n>   # WH per _shared-project-profile.md
```

It checks every 5 minutes. **Exit 3:** a lane is stalled; its report names the lane. Act (below), then
restart the watchdog. **Exit 0:** no lane is running, or the task list's `status:` is not `in_progress`
("batch not running"); restart it when the next lane launches. **Exit 2:**
a usage error; fix the call. (Exit 4 comes only with `--once`, a single check: lanes are running and none
is stalled. The background loop never uses `--once`.)

**Script absent:** at every notification, check each running lane's last commit time, progress note and
newest log yourself (`git -C <wt> log -1 --format=%cr`, `ls -lt <wt>/<logs_dir> | head -2`), and skip slot
holders.

## Acting on a stall

1. `SendMessage` the agent asking for a one-line status.
2. No reply, or a failure notification → treat it as dead and run the resume procedure in
   `_shared-agent-tracking.md`.
3. Record the stall and its outcome in the Checkpoint log.

## Graceful degradation

- **One agent's failure never blocks the others.** Mark its part `[PARTIAL]` or `AUDIT-INCOMPLETE-*`,
  continue with the data you have, and list the gap in the report.
- **Partial work is kept.** Commits stay on the lane branch; a relaunch continues from them.
- **Track status in one line:** `AGENTS: [✓] lane-a | [✓] verify-a | [running] lane-b | [dead→relaunched] lane-c`.
