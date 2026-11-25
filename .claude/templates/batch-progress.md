---
set: <set name, e.g. ss>
workflow_version: <$WORKFLOW_HOME/VERSION at Phase 0, e.g. 2.0.0; never changed mid-batch>
integration_branch: <branch the lanes branch from and merge into>
base_sha: <sha the first lanes branch from>
started: <YYYY-MM-DD>
status: in_progress
max_lanes: 5
stall_minutes: 45
rules: ~/.claude/commands/_shared-autonomous.md §3 + context/batch-briefs/<set>/_common.md
profile: <.claude/workflow-profile.json, or none (v1 mechanics)>
lessons: context/workflow-lessons.md (written by /workflow-sync as the last step)
---

<!--
The living task list. Only the orchestrator writes it. Commit it after every merge.
Protocols: ~/.claude/commands/_shared-agent-tracking.md (tracking, resume),
_shared-triage.md (deferred findings), _shared-effort-budget.md (effort per role),
_shared-project-profile.md (profile, gates, apply by risk).
On resume, a workflow_version that differs from the installed VERSION follows its own version's text.
-->

# Batch progress — <set>

## Execution plan

| Lane | Modules | Waits on (merged or stubbed) | Merge order | Status |
|---|---|---|---|---|
| C0 | Phase 0: LOCKED contracts + stubs | — | 1 | ⏳ |
| C0-UI | shared UI foundation | C0 | 2 | ⏳ |

## Module status

| Module | Lane | Status | Verify (sweeps) | UI parity | Commits | Notes |
|---|---|---|---|---|---|---|

Status: ⏳ PENDING · 🔄 RUNNING · 🔎 VERIFYING · ✅ MERGED · ⚠️ VERIFY_FAILED · ⛔ BLOCKED(<module>)

## Agents

| Lane | Role | Agent id | Worktree | Branch (base sha) | Test DBs | Brief | Effort | Launched | Last commit seen | State |
|---|---|---|---|---|---|---|---|---|---|---|

Role: lane · verify · integration-fix · design-area. State: running · finished · dead · relaunched → <id>.

## Resume after an interruption

1. Read this file. In each running lane's worktree: `git log <base>..HEAD` and `.lane/progress.md`.
2. Agent id known → `SendMessage` it first; it resumes with full context.
3. Unknown or no reply → relaunch from its brief with: "Continue. Do not redo committed work.
   `git log <base>..HEAD` and `.lane/progress.md` show where you stopped." Same effort.
4. Never two agents on one worktree: confirm the old one is dead before relaunching.
5. Update the Agents row: old id → `relaunched → <new id>`.
6. Only the orchestrator merges into the integration branch, in merge order.

## Decision log

The only decision log for the batch. Agents report decisions; the orchestrator records them here.

| When | Module | Decision | Rationale |
|---|---|---|---|

## Owner corrections

Written when the correction happens, in the owner's words. `/workflow-sync` harvests this table.

| When | Correction (owner's words) | What it changed | Applies beyond this batch? |
|---|---|---|---|

## Deferred findings (logged, not chased)

| Module | Finding | Severity | Why deferred | Revisit when |
|---|---|---|---|---|

## Owner items

| Item | Raised by | Default until decided |
|---|---|---|

## Lessons

`/workflow-sync` writes this batch's classified lessons to `context/workflow-lessons.md` and lists the
resulting profile changes and Owner items here.

## Checkpoint log (newest first)

| When | Event |
|---|---|
