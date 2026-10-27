---
description: Shared protocol, not a standalone command. Briefs on disk, the Agents table and the resume procedure, so an interrupted session can resume or relaunch every agent from files alone.
disable-model-invocation: true
---
<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: implement-batch, implement-plan (--lane), design-ui, blueprint (--verify), verify-implementation
Generated: 2026-10-27 (a login change killed a verifier mid-run; SendMessage to its recorded id resumed it with full context)
Last audit: 2026-10-27
-->

# Agent tracking and resume

**Every agent must be resumable from files on disk alone.** The session that launched it can end at
any moment: context exhaustion, a login change, a crash, a closed laptop.

## What is recorded, and where

| Record | Where | Written by | When |
|---|---|---|---|
| Living task list | `context/batch-progress[-<set>].md`, committed | the orchestrator only | at every launch, report, merge and decision |
| Agent brief = the launch prompt, verbatim | `context/batch-briefs[/<set>]/<lane>.md` | the orchestrator | **before** launch; a later instruction is added to the brief first, then sent |
| Shared lane rules | `context/batch-briefs[/<set>]/_common.md`, `_verify.md` | the orchestrator | when a rule tightens (then message every running agent) |
| Task progress | commit subjects carrying the task id: `feat(m81): T6 events import screen` | the agent | one commit per task |
| Lane notes | `.lane/progress.md` in the worktree, listed in `.git/info/exclude` | the agent | after each task: current task, next step, open findings, test DB state |

Templates: `~/.claude/templates/batch-progress.md` and `~/.claude/templates/batch-briefs/`.

## The Agents table

One row per agent, running or finished, written **in the same turn as the launch**:

| Lane | Role | Agent id | Worktree | Branch (base sha) | Test DBs | Brief | Effort | Launched | Last commit seen | State |
|---|---|---|---|---|---|---|---|---|---|---|

Role is `lane`, `verify`, `integration-fix` or `design-area`. State is `running`, `finished`, `dead`
or `relaunched → <new id>`.

## Brief rules

- First line: `<!-- Brief for <lane>, <date>. Relaunch with this text plus the resume preface. -->`
- Under 60 lines; points at specs, does not paste them (`_shared-effort-budget.md`).
- Names: worktree, branch and base sha, test DB and its prefix, ports, scratch directory, effort, the
  shared rules file, the module files to read, what "done" means, the report format.

## Resume procedure

Run it for every row still marked `running` (copy it into the task list so the file stands alone):

1. Read the task list. In each lane's worktree run `git log <base>..HEAD` and read `.lane/progress.md`.
2. **If the agent id is known, `SendMessage` to it first.** Its transcript outlives the session, so it
   resumes with full context. This is the cheapest path.
3. **If the id is unknown or the message fails, relaunch from the brief** with this preface:
   "Continue. Do not redo committed work. `git log <base>..HEAD` and `.lane/progress.md` show where you
   stopped." Pass the same effort.
4. **Never run two agents on one worktree.** Confirm the old one is dead (a failure notification, or no
   reply to a message), not just quiet, before relaunching.
5. Update the row: the old id becomes `relaunched → <new id>`.

## The orchestrator's own state

The orchestrator commits the task list after every merge (`docs(<set>): <lane> merged`). If the main
session is lost, the next one starts by reading that file and running the resume procedure.
