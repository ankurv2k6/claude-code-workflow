---
description: Shared protocol, not a standalone command. Which tests and gates run at which stage, who runs them, and the test-hygiene rules, from the project profile or, without one, from the project's test map or its own commands.
disable-model-invocation: true
---
<!--
Shared test-selection protocol. Referenced by implement-plan, implement-batch, verify-implementation,
verify-ui and e2e-validate.
Last audit: 2026-11-26 (2.1: review beside the quick tier, then one wide run; one heavy job per machine; known
reds subtracted; base never the default branch, no auto-escalation; the hotfix path. A 5-file hotfix had taken
3 hours before a 2-minute deploy)
-->

# Test selection protocol

**Each check runs once, at the first stage that can find its kind of defect.** Find the project's mechanics
first, then follow the matching branch:

```bash
test -f .claude/workflow-profile.json && echo PROFILE \
  || { test -f context/testing/test-map.mjs && echo MAPPED || echo UNMAPPED; }
```

## If PROFILE: run the profile's commands and tiers

Read the profile per `_shared-project-profile.md`. A tier names gates; the gate registry (`gates`) maps each
name to its command. Fill placeholders (`{files}`, `{base}`, …) and prefix the profile's `shell_prefix`.

| Stage | What runs | Who |
|---|---|---|
| Each commit | `tiers.per_commit`, unless the project's pre-commit hook already runs them | the agent committing |
| Each task | `commands.test_task` with every changed file in **one** call | the agent editing |
| End of a lane or standalone module | after the review's fixes: `tiers.lane_end` once, then `commands.test_lane_end` once | the lane |
| A verify sweep | the quick tier beside its review; its fixes' delta and the callers' tests of shared code it changed; then the lane's `commands.test_lane_end` once, after the fixes | the verifier |
| Merge into the integration branch | `tiers.merge` through `merge-lane.mjs`, skipped when the verifier ran it green on the lane head that merged; its tests are the delta, `tests.merge_delta`, never a broad selection | the orchestrator |
| End of a cut, or a release candidate (a hotfix included) | `tiers.cut_end` (invariant gates first; not for a hotfix), the review or combined final, its fixes merged, then `commands.test_full` once (never a tier gate): one full run per release candidate | the orchestrator, or the agent with the hotfix |
| Routine re-merge between tracks | `tiers.merge` | the orchestrator |
| Track-merge milestone (a finished cut into the mainline), or before a release | `tiers.track_merge` | the orchestrator |

- **A tier runs through `"$WH/scripts/workflow/run-tier.mjs" <tier>`** (`WH` per
  `_shared-project-profile.md`; `--parallel` runs its independent `check` gates at once): the gates in order,
  the prefix applied, agent gates listed for the skill to launch, never run as checks.
- **Heavy gates** (a gate with `heavy`) run through `"$WH/scripts/workflow/slot.sh" <job>
  <heavy_jobs.<job>.slots> --lock-dir <heavy_jobs.<job>.lock_dir> -- <cmd>`, except when
  `heavy_jobs.<job>.self_locking` is true: that job takes its own lock and is never wrapped. Exit 75 is a
  wait timeout (default 7200 s): the gate did not run, so it is neither green nor red; run it again. Script
  absent: heavy gates run one at a time, by the orchestrator.
- **Long commands write to `logs_dir`** (default `logs`: `<cmd> > <logs_dir>/<lane>-<what>.log 2>&1`), so
  the watchdog sees progress.
- **One heavy job per machine.** With `tests.heavy_lock` set, a full run, a rehearsal, a sharded run or a
  broad selection (above the quick tier, a merge tier with a heavy gate) runs inside it, outermost: `{cmd}` the
  whole job, `{owner}` a label peers see; its slots stay inside. A release verification takes it once and runs
  its pair (rehearsal and full run) side by side in that hold, which exports `tests.heavy_lock_token` so the
  pair's own lock calls join it. Never two heavy jobs from two owners at once. **Before starting one, tell
  peer sessions** (`SendMessage` to the agents you run, a Checkpoint-log line in the task list). No key: one
  at a time, by hand, after telling peers.
- **The base is the release or integration branch,** never the default branch: `{base}` is the lane's base,
  or `docs.release_branch` for a hotfix. Always pass it: a selector without one diffs against its own default
  (often `main`) and selects the whole drift.
- **Never auto-escalate.** A selection runs at the tier its command caps. When the selector asks for more,
  report "escalated to `<tier>`, deferred to the release candidate's full run" and run nothing broader, not a
  related-tests run over the changed files either: on shared code it selects most of the tree.
- **Known reds are subtracted.** Every run compares its reds with the `known_reds` file (checked once at
  Phase 0): a listed red is reported by name as `known`, never re-diagnosed; only a red missing from it is
  triaged. A listed file that now passes is reported for removal from the file. A suite in
  `invariant_suites` is never a known red; its failure always blocks.
- **Nothing broader in a lane:** no `commands.test_full` and no gate from `tiers.cut_end` or
  `tiers.track_merge`.

## Review beside the tests, then one wide run

A review reads the diff, not test results, so it never waits for them. At a task's end, a lane's end, a
verify sweep and a hotfix:

1. **Start the code review and the quick tier together** (`commands.test_task` on the changed files; v1:
   `test-select --files`), once the edits are done.
2. **Apply the review's findings;** re-run the quick tier on the files the fixes changed.
3. **Then ONE wide run on the final code:** the lane-end selection, the merge tier or the release
   candidate's full run. Never start a wide run before the review's fixes are in.
4. **A file changed while a wide run is going** makes it stale: stop that run (by the PID you started),
   finish the edits, then run it once.

## Hotfix and release

A hotfix branches off the release branch, merges there, deploys, then back-merges. One merge before the
deploy, not two:

1. **Start:** `release.hotfix_start` (`{hotfix}`). By hand: a worktree and branch `hotfix/<name>` off
   `docs.release_branch`.
2. **Fix, then review beside the quick tier** (above), base the release branch, and apply the findings.
3. **The release verification:** one heavy-lock hold, the rehearsal and `commands.test_full` side by side
   in it, known reds subtracted; start `release.package` (`{bundle}`) beside it, not after it.
4. **Green:** `release.hotfix_finish` merges into the release branch (`tests.merge_delta` at that merge;
   the release branch moved since the start: package again from the merged head).
5. **Deploy:** `release.deploy` (`{bundle}`, `{description}`) at the safe window, only with the owner's
   approval of this deploy (`_shared-commit-protocol.md`), then back-merge the release branch into the
   integration branch, with `tests.merge_delta`.

## If MAPPED (no profile, v1): run the selector, not the suite

The project has declared which tests can observe which changes. **Do not choose a scope by judgment,
and do not run the full suite "to be safe".**

```bash
node scripts/test-select.mjs --files <changed files> --json     # or --since <sha>, or --tier <t>
```

Run exactly the commands it prints, once. Pass every changed file in one call. If the selector's `--help`
lists `--max-tier`, cap it: `quick` per task, `standard` at lane end.

| Situation | What runs | Who |
|---|---|---|
| After an edit | `test-select --files <changed>` | the agent editing |
| A verify sweep | the selection for that sweep's own fixes, plus the callers of shared code it changed | the verifier |
| End of a lane or module | `test-select --since <lane base>`, once | the lane |
| The selector escalates | do not run the escalated tier, nor a related-tests run over the changed files: run the suites for the touched code and report "escalated to `<tier>`, deferred" to the release candidate's full run | the agent |
| Merge into the integration branch | the suites in files that had conflicts, plus the test typecheck | the orchestrator |
| Final gate of a batch | `--tier full`, once, on the final head | the orchestrator |

**Baseline plus delta.** Select `--since` the last green sha, not from scratch.

## Rules (every branch)

1. **An empty plan is not a pass.** No commands printed is a map gap: report it, never record green.
   A path the runner can't resolve (a relative path, a `src/` path where packages resolve through
   `dist/`) also selects nothing and exits 0.
2. **Build before trusting a cross-package selection.** A stale build gives false failures and wrong
   selections.
3. **Check the map before a narrow run on an unfamiliar area** (`node scripts/test-map.mjs --check`).
4. **Only a full run may be reported as "all tests pass."** Report the others as what they were:
   `tests: --since a1b2c3 (54 files) ✅`.
5. **A new test file joins the map in the same commit**, including any file it reads without importing
   (a fixture, a manifest, a stylesheet).
6. **A setup failure is not a product defect** (missing seed, extension, database): fix the
   environment per the project's testing doc and re-run.

## Test hygiene

Each of these broke a merged run in a real batch:

- **Suites seed their own data and remove it.** A harness tenant or flag left behind fails other suites
  only after lanes merge.
- **Time-dependent tests take a fixed clock.** Otherwise they fail near midnight or month end.
- **One test per external network path uses a real local socket.** Fakes passed while the real runtime
  failed.
- **One test database per lane**, named with the lane prefix and a `_test` suffix (the profile's
  `test_db.name_pattern`), bootstrapped by the project's script. Never a shared database.

## Building the map

`/blueprint` creates the map when the project starts, not after the suite has grown: each module's §7A
names its test files by path, and `/implement-plan` registers new ones. A design guide (what the
selector and map checker must do, and the traps they must handle) and a skeleton map are in
`~/.claude/templates/testing/`.

## If UNMAPPED (no profile, v1): run the project's own commands

```bash
npm test 2>/dev/null || npx vitest run
npx tsc --build      # a root `tsc --noEmit` over a solution-style tsconfig ("files": [] + references) checks nothing
npm run lint 2>/dev/null || npx eslint .
```

Run them once at the end of a module, not after every edit. Propose a map when the suite is large
enough that running it in full dominates the loop.
