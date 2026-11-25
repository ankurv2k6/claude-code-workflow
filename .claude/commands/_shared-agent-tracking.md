---
description: Shared protocol, not a standalone command. Briefs on disk, the Agents table, the progress note and the resume procedure, so an interrupted session can resume or relaunch every agent from files alone, on the workflow version the batch started with.
disable-model-invocation: true
---
<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: implement-batch, implement-plan (--lane), design-ui, blueprint (--verify), verify-implementation
Generated: 2026-10-27 (a login change killed a verifier mid-run; SendMessage to its recorded id resumed it with full context)
Last audit: 2026-11-25 (v2: resume honours workflow_version; owner corrections logged as they happen; a
restarted session once resumed agents another orchestrator still ran, giving two writers)
-->

# Agent tracking and resume

**Every agent must be resumable from files on disk alone.** The session that launched it can end at
any moment: context exhaustion, a login change, a crash, a closed laptop.

## What is recorded, and where

| Record | Where | Written by | When |
|---|---|---|---|
| Living task list | `context/batch-progress[-<set>].md`, committed | the orchestrator only | at every launch, report, merge, decision and owner correction |
| Agent brief = the launch prompt, verbatim | `context/batch-briefs/<set>/<lane>.md` | the orchestrator | **before** launch; a later instruction is added to the brief first, then sent |
| Shared lane rules | `context/batch-briefs/_common.md` (programme rules plus a per-cut delta) and `context/batch-briefs/_verify.md` | the orchestrator | when a rule tightens (then message every running agent) |
| Task progress | commit subjects carrying the task id: `feat(m81): T6 events import screen` | the agent | one commit per task |
| Progress note | `.lane/progress.md` in the worktree, listed in `.git/info/exclude` | the agent | after each task, and before a session split |

Templates: `$WH/.claude/templates/batch-progress.md` and `$WH/.claude/templates/batch-briefs/`, with `WH` as
`_shared-project-profile.md` defines it, so the templates and the skills come from the same version.

**Task-list events** (Agents rows, module status, decisions, owner corrections) go through
`"$WH/scripts/workflow/orch-event.mjs"` (`WH` per `_shared-project-profile.md`), which takes times
from the clock; `--commit` commits the change. Script absent: edit the task list by hand, with times from
`date`, never estimated.

## The progress note

```markdown
task: T4 import preview (3 of 6) · state: implementing | testing | committed | blocked
next: <the next concrete step>
open findings: <id — severity — one line> | none
test DB: <name> (<bootstrapped | dirty | reset>) · background jobs: <command → log path> | none
context: <approx tokens> · session: <n>
```

Overwrite it; it is a snapshot, not a log.

## The Agents table

One row per agent, running or finished, written **in the same turn as the launch**:

| Lane | Role | Agent id | Worktree | Branch (base sha) | Test DBs | Brief | Effort | Launched | Last commit seen | State |
|---|---|---|---|---|---|---|---|---|---|---|

Effort carries the model too when it is not the session default (`high · opus`).

Role is `lane`, `verify`, `integration-fix` or `design-area`. State is `running`, `finished`, `split`
(ended at the context budget), `dead` or `relaunched → <new id>`.

## The owner's words

- **Owner corrections log:** when the owner corrects a rule, a decision or an agent's work, record it in the
  task list's Owner corrections log in the same turn: what was said, what changed, where. `/workflow-sync`
  harvests it; the transcript is not read later.
- **One Decision log** per batch, in the task list. Decisions are not kept anywhere else.

## Brief rules

- First line: `<!-- Brief for <lane>, <date>. Relaunch with this text plus the resume preface. -->`
- Under 60 lines; points at specs by anchor, does not paste them (`_shared-effort-budget.md`).
- Names: worktree, branch and base sha, test DB and its prefix, ports, scratch directory, effort, the
  shared rules file, the sections to read, the commands to run, what "done" means, the hand-back headings.

## Resume procedure

**One orchestrator per batch.** Before resuming, check that no other session is orchestrating it (the
running agents your session can list, the task list's latest Checkpoint entry). If one is alive, hand over
to it and stop; never two writers.

**Workflow version.** Read the task list's `workflow_version` and the installed `$WH/VERSION` (`WH` per
`_shared-project-profile.md`: before the first release, the repo `~/.claude/commands` points into). If they differ, follow the batch's own version
for the rest of it: read each command and protocol with
`git -C ~/claudeworkflow show v<version>:.claude/commands/<file>` (templates likewise). Never mix versions
inside one batch. No `workflow_version` in the header: the batch predates versioning and is `1.0.0`; read
its text with `git -C ~/claudeworkflow show v1.0.0:.claude/commands/<file>`.

Then, for every row still marked `running` or `split` (copy this into the task list so the file stands
alone):

1. Read the task list. In each lane's worktree run `git log <base>..HEAD` and read `.lane/progress.md`.
2. **If the agent id is known and the row is `running`, `SendMessage` to it first.** Its transcript outlives
   the session, so it resumes with full context. This is the cheapest path.
3. **If the id is unknown, the message fails, or the row is `split`, relaunch from the brief** with this
   preface: "Continue. Do not redo committed work. `git log <base>..HEAD` and `.lane/progress.md` show
   where you stopped." Pass the same effort and model. A `split` relaunch is not a failure and does not
   count toward the relaunch limit.
4. **Never run two agents on one worktree.** Confirm the old one is dead (a failure notification, or no
   reply to a message), not just quiet, before relaunching.
5. Update the row: the old id becomes `relaunched → <new id>`.

## The orchestrator's own state

The orchestrator commits the task list after every merge (`docs(<set>): <lane> merged`). If the main
session is lost, the next one starts by reading that file and running the resume procedure.
