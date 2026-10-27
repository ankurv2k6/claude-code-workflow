---
set: <set name, e.g. ss>
integration_branch: <branch the lanes branch from and merge into>
base_sha: <sha the first lanes branch from>
started: <YYYY-MM-DD>
status: in_progress
max_lanes: 5
stall_minutes: 45
rules: ~/.claude/commands/_shared-autonomous.md §3 + context/batch-briefs/<set>/_common.md
---

<!--
The living task list. Only the orchestrator writes it. Commit it after every merge.
Protocols: ~/.claude/commands/_shared-agent-tracking.md (tracking, resume),
_shared-triage.md (deferred findings), _shared-effort-budget.md (effort per role).
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

| When | Module | Decision | Rationale |
|---|---|---|---|

## Deferred findings (logged, not chased)

| Module | Finding | Severity | Why deferred | Revisit when |
|---|---|---|---|---|

## Owner items

| Item | Raised by | Default until decided |
|---|---|---|

## Checkpoint log (newest first)

| When | Event |
|---|---|
