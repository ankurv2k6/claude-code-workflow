---
description: Shared protocol, not a standalone command. Which tests and gates run at which stage, who runs them, and the test-hygiene rules, from the project profile or, without one, from the project's test map or its own commands.
disable-model-invocation: true
---
<!--
Shared test-selection protocol. Referenced by implement-plan, implement-batch, verify-implementation,
verify-ui and e2e-validate.
Last audit: 2026-11-25 (v2: commands and tiers come from the project profile; one selector call per task,
capped by tier. Lanes had run one test file per call, about 1,200 calls, and release checks at every stage)
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
| End of a lane or standalone module | `tiers.lane_end` once, then `commands.test_lane_end` once | the lane |
| A verify sweep | its own fixes' delta; the callers' tests of any shared code it changed; the lane's `commands.test_lane_end` once | the verifier |
| Merge into the integration branch | `tiers.merge`, through the project's merge script when the tier names one | the orchestrator |
| End of a cut | `tiers.cut_end` (invariant gates first), the combined final, then `commands.test_full` once | the orchestrator |
| Merge between tracks, or before a release | `tiers.track_merge` | the orchestrator |

- **Heavy gates** (a gate with `heavy`) run through `$WORKFLOW_HOME/scripts/workflow/slot.sh <job> <slots>
  --lock-dir <heavy_jobs.<job>.lock_dir> -- <cmd>`. Script absent: heavy gates run one at a time, by the
  orchestrator (`_shared-project-profile.md`).
- **Long commands write to `logs_dir`** (default `logs`: `<cmd> > <logs_dir>/<lane>-<what>.log 2>&1`), so
  the watchdog sees progress.
- **Known reds.** A failure listed in the `known_reds` file is checked once at Phase 0 and never
  re-diagnosed by a lane or verifier: report it by name. A suite in `invariant_suites` is never a known red;
  its failure always blocks.
- **Nothing broader in a lane:** no `commands.test_full` and no gate from `tiers.cut_end` or
  `tiers.track_merge`.

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
| The selector escalates **inside a lane or verifier** | do not run the escalated tier: run `vitest related` (or the runner's equivalent) on the changed files plus the suites for the touched code, and report "escalated to `<tier>`, deferred" | the lane or verifier |
| Merge into the integration branch | the suites in files that had conflicts, plus the test typecheck | the orchestrator |
| Final gate of a batch | `--tier full`, once, on the final head | the orchestrator |
| A standalone `/implement-plan` (no orchestrator) | an escalated tier runs once at module end, never per sweep | the agent |

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
npx tsc --noEmit
npm run lint 2>/dev/null || npx eslint .
```

Run them once at the end of a module, not after every edit. Propose a map when the suite is large
enough that running it in full dominates the loop.
