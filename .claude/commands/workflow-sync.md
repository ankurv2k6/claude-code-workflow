---
name: workflow-sync
description: Harvest a finished batch's lessons from its artifacts on disk, classify each one (skill, project profile, user level, project CLAUDE.md, memory), diff the project profile, apply only mechanical additions, and write the lessons file and generic proposals. Never edits a skill. Runs as the last step of /implement-batch, or by hand on an archived batch.
---

# Workflow sync

**Command**: `/workflow-sync [task-list-or-report] [--apply-additions] [--dry-run] [--proposals-dir <dir>]`
**Usage**:

- `/workflow-sync`: the current batch, `context/batch-progress.md`
- `/workflow-sync <path>`: an archived task list or batch report
- `--apply-additions`: passed only by `/implement-batch` as its last step. Without it nothing is applied
- `--dry-run`: print the lessons and the diff; write nothing
- `--proposals-dir <dir>`: where the generic proposals go (default: the workflow repo's
  `context/proposals/`, i.e. `~/claudeworkflow/context/proposals/`; never `$WORKFLOW_HOME`)

Protocol: `_shared-project-profile.md` (classification, apply by risk, provenance).

## Rules

- **Only artifacts on disk.** Never read a session transcript. Transcript figures come from the
  `build-report.mjs` output file only.
- **Never edits a skill, CLAUDE.md, user settings or memory.** Those become proposals or Owner items.
- **Applies only `addition`**, only with `--apply-additions`.
- **The workflow repo stays generic.** A proposal names no project, host, port, email, customer,
  product or project path.
- **Times from `date`**, never recalled.
- **Script absent:** do the step by hand as the table at the end says, and say so in the lessons file.

## Step 1: Harvest

Read each source once. A missing one is recorded as "not found", not guessed.

| Source | Where | Yields |
|---|---|---|
| Task list | `context/batch-progress.md` or the argument | Decision log, Owner corrections, Deferred findings, Owner items, stalls in the Checkpoint log |
| Batch report | `context/batch-report-<set>.md` | final gate results, reds at cut end, integration fixes |
| Verifier findings | the findings files the task list's Agents rows and notes point to | findings by module, and which gate could have caught each |
| Build report | `<logs_dir>/build-report-<set>.md` | tokens, cost, active minutes and maximum context per agent and role; the **Rule breaches** table (`--breaches`) and the **Critical path** split (`--critical-path`) |
| Script drift | the profile's commands against what the briefs and Decision log ran; project copies of generic scripts against `$WH/scripts/workflow/` (`diff -q`; `WH` per `_shared-project-profile.md`) | commands changed by hand mid-batch, local forks of generic scripts |

No build report yet: run `node "$WH/scripts/workflow/build-report.mjs" --session <orchestrator session id>
--since <task list started> --until <its last checkpoint time> --set <set> --breaches --critical-path
--task-list <task list>`, which writes
`<logs_dir>/build-report-<set>.md`, and read only that file. The window keeps a session that ran several
batches from counting the others: only transcript lines inside it count. Id unknown: `--all` with the same
window, which also counts any other session of the project in it; say so in the sources line. Run inside a
worktree, the script reads the main checkout's transcripts (`--slug <slug>` overrides, a leading `-` is
fine). Cost appears only with `--prices <file>`; without a price table, report tokens and minutes and
write "cost: no price table".

## Step 2: Find the lessons

A lesson is something that should change how the next batch runs. Candidates:

- **every Owner correction**, always;
- a decision that overrode a default, or the same decision in two or more modules;
- a finding repeated across modules, or one a gate should have caught earlier;
- a red that reached cut end, or a known red that was not in the known-reds file;
- a stall, a session past the context budget, a role far above its usual cost;
- **every non-zero row of the Rule breaches table** (a whole-suite vitest in a lane, a clean typecheck, a
  rehearsal in a lane or verifier, turns over budget, an orchestrator past 1.5 x budget): one lesson per
  kind, with its count; and waiting time above building time in the Critical path;
- script drift.

Each lesson gets an id, one line of statement, and its evidence (artifact path and section). **Ids continue
the lessons file:** read the highest `L<n>` already in `context/workflow-lessons.md` (`grep -o '| L[0-9]*'`,
none: 0) and number this batch's lessons from the next one, so ids never collide across batches.

## Step 3: Classify

Classify each lesson with the table in `_shared-project-profile.md` (skill · project profile · user
level · project CLAUDE.md · memory), using its one-line tests. Ambiguous goes to the profile first.

## Step 4: Diff the profile

For the profile-class lessons:

1. Copy `.claude/workflow-profile.json` to a scratch file and make each change there. Leave
   `provenance` and `updated` alone until the apply, so the diff shows only the real changes.
2. `node "$WH/scripts/workflow/profile-diff.mjs" .claude/workflow-profile.json <scratch file> --json`,
   saved to `<logs_dir>/workflow-sync-<set>-diff.json`. It exits 0 whenever it has compared: decide from
   the JSON's `only_additions` and `owner_items`, never from the exit code.
3. **No profile in the project:** propose one from `~/.claude/templates/workflow-profile.example.json`
   as a single Owner item. Apply nothing.

## Step 5: Apply by risk

- With `--apply-additions`: apply the `addition` changes only, as `_shared-project-profile.md` §Apply by
  risk says (re-diff until `only_additions` is `true`, smoke-run each gate newly added to a tier, check, provenance,
  `updated`, one commit). A gate that fails its smoke run is not applied: it becomes an Owner item. A new gate in the
  registry is a new command, so it is always an Owner item.
- Every other change, and every change on a run without the flag, becomes an Owner item naming the
  key, the old and new value, and the lesson.

## Step 6: Write the lessons

Append one section to the project's `context/workflow-lessons.md` (create it with a `# Workflow lessons`
heading if missing):

```markdown
## <set>, <date> (workflow <version>)

Sources: <each source path, or "not found">

| Id | Lesson | Class | Evidence | Action |
|---|---|---|---|---|
| L<n+1> | <one line> | profile | <path §section> | applied: tiers.merge + typecheck |
| L<n+2> | <one line> | skill | <path §section> | proposal: <file name> |
| L<n+3> | <one line> | project CLAUDE.md | <path §section> | Owner item |
```

## Step 7: Write the generic proposals

For each skill-class lesson, write `<proposals dir>/<date>-<slug>.md`: `--proposals-dir`, else the
workflow repo's working tree `~/claudeworkflow/context/proposals/`, never `$WORKFLOW_HOME`. Do not commit it;
it is an Owner item. A file of that name already there gets a `-2`, `-3`… suffix, never an overwrite.

```markdown
# <generic title>

- Problem: <what went wrong, in words true for any project>
- Evidence: <counts and kinds only, e.g. "2 of 9 lanes waited on unmerged code">
- Proposed rule: <one or two sentences>
- Skill files: <command or shared file names>
- Risk: <what the rule could break>
```

Before writing, grep the text for the profile's `project` value, the project folder's name, any host,
port or email address (`[[:alnum:]._%+-]+@[[:alnum:].-]+`), and rewrite every hit in generic words.

## Step 8: Record and report

- **Run by the batch's orchestrator (`--apply-additions`):** in the task list, the Lessons section lists the applied
  changes, the proposals and the Owner items; each Owner item also gets a row in the Owner items table. Commit the
  project files (`context/workflow-lessons.md`, the task list, the profile):
  `chore(workflow): lessons from <set>` (`_shared-commit-protocol.md`).
- **Run by hand:** never write the task list, because the orchestrator is its only writer, and a batch may still be
  live. A hand run commits only the lessons file: write and commit `context/workflow-lessons.md`, with the Owner
  items listed at its top for the owner or the next orchestrator to carry into a task list. The proposals stay
  uncommitted in the proposals dir.
- Report in at most 30 lines: lessons by class, changes applied, Owner items, proposal paths.

## When a script is absent

| Script | By hand |
|---|---|
| `build-report.mjs` | skip the cost and time lessons; write "build report: not available" in the sources line |
| `profile-diff.mjs` | apply nothing; every proposed change is an Owner item with its old and new value |
| `profile-check.mjs` | parse with `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1]))'` and compare keys with the schema before any apply |
