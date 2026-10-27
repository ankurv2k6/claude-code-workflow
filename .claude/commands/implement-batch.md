---
description: Implement a whole blueprint set as parallel lanes in git worktrees. Each lane is checked by an independent verifier that also prepares its merge; the orchestrator alone merges and keeps a living task list that can resume every agent after an interruption. One full test run, at the end.
---

# Implement Batch

Execute a blueprint set as **lanes**: groups of 1–3 modules, each built by one background agent in its
own git worktree, then checked by a separate verifier that also prepares the merge. The orchestrator (you)
launches lanes as their dependencies land, merges them into the integration branch, and keeps the
living task list. Everything needed to resume is on disk.

```
specs committed → Phase 0 (contracts + stubs, UI foundation) → lanes side by side (≤ max_lanes)
  → each lane: build → independent verify + merge prep → orchestrator merges
  → final phase once: cross-module verify · full run + e2e · integration fix → batch report
```

## Arguments

- `$ARGUMENTS`: blueprint master path, set suffix (e.g. `-ss`), or module id. Paths are validated as in
  Phase 0 step 2.
- `--resume`: resume from the task list (`_shared-agent-tracking.md` resume procedure).
- `--dry-run`: write the lane map, the task list and the briefs; launch nothing, create no worktrees.
- `--from M<N>` / `--to M<N>`: limit the module range.
- `--max-lanes=<n>`: concurrent lanes (default 5). `--sequential` = `--max-lanes=1`.
- `--stall=<minutes>`: stall threshold (default 45; `_shared-agent-timeout.md`).
- `--skip-verification`: no per-lane verifier. **Not recommended**; the batch can then not PASS.
- `--skip-stub-gate`: stub gates become advisory.

Execute automatically without permission. Use TodoWrite throughout.

## Shared protocols — read before Phase 0

| File (`~/.claude/commands/`) | Governs |
|---|---|
| `_shared-autonomous.md` | no pauses, decide-don't-ask, standing rules, guardrails |
| `_shared-agent-tracking.md` | briefs, the Agents table, the resume procedure |
| `_shared-effort-budget.md` | effort per role, delegation and token rules |
| `_shared-triage.md` | what blocks, the 2-sweep cap, how a verifier works |
| `_shared-test-selection.md` | what runs when; lanes defer escalated tiers |
| `_shared-ui-parity.md` | real-browser screenshot pairs |
| `_shared-agent-timeout.md` | completion by notification, stall detection |
| `_shared-commit-protocol.md` | commit format, gates, push policy |

---

## Phase 0: Initialization

### 1. Detect mode
- `--resume`: read the task list; run the resume procedure for every `running` row; continue the lane
  loop from the recorded state. Lanes already `MERGED` are never re-run.
- Otherwise: fresh start from the blueprint master.

### 2. Validate the blueprint
1. YAML frontmatter has `blueprint`, `version`, `status`. Max 100 KB, no symlinks.
2. Module ids match `/^M\d{1,3}[a-z]?$/` and exist in the registry.
3. Paths resolve inside the project root; reject null bytes, `..`, `%2e`, `%2f`.
4. Structure: S5 Module Index, S6B Dependency Matrix, S6C Phase Timeline.

On failure: FATAL "Blueprint validation failed: {errors}".

### 3. Build the lane map
- Prefer `impl-master` **S1 lane map** (lanes, modules, start conditions, merge order).
- Without one, derive it:
  - **C0 (Phase 0):** every LOCKED contract as code, plus every stub in impl-master S5, when any exists.
  - **C0-UI:** the shared UI foundation (theme port, components used on 2+ screens, shared navigation),
    when any module is `type: ui`.
  - **Other lanes:** group modules that share files, at most 3 modules or about 8 screens per lane.
- A lane **waits on** its hard dependencies being merged, or covered by a Phase 0 stub. Contract-first
  cycles are fine once Phase 0 has landed both sides' contracts.
- Detect cycles at lane level by topological sort. A cycle → FATAL with the cycle path.

### 4. Validate module specs
Each module needs `blprnt-<M>-*.md` and `impl-<M>-*.md`. A missing one → `BLOCKED(MISSING_SPEC)`.

### 5. Detect UI modules
A module is UI when its blueprint declares `type: ui`. Record its screens, wireframes, mockups and
mockup states (from §4A and `ui-mapping`) for its lane brief.

### 6. Commit the specs
If the blueprints, mockups or briefs are uncommitted, commit them (`docs(<set>): …`) on the integration
branch first. Worktrees branch from a commit, so uncommitted specs are invisible to every lane.

### 7. Create the living task list
Copy `~/.claude/templates/batch-progress.md` to `context/batch-progress[-<set>].md` and fill:
- the header (integration branch, base sha, `max_lanes`, `stall_minutes`);
- the execution plan (lanes, waits-on, merge order);
- module status rows.

The orchestrator is its only writer.

### 8. Write the briefs
In `context/batch-briefs[/<set>]/`, from `~/.claude/templates/batch-briefs/`:
- `_common.md`, with the project's `## Hard guardrails` pasted verbatim;
- `_verify.md`;
- one `<lane>.md` per lane, under 60 lines, naming worktree, branch, base, test DB prefix, ports,
  scratch directory, effort, specs, screens and their mockup states, and "done".

Commit the briefs with the task list.

### 9. `--dry-run` stops here
Print the lane map and the paths written.

---

## Phase 1: Lane loop

Repeat until every lane is merged, failed or blocked. Never pause between steps.

### 1. Launch ready lanes
Phase 0 lanes (C0, then C0-UI) launch first and merge before any other lane starts. After that, launch
every ready lane, up to `max_lanes` running at once. For each:

1. `git worktree add <repo>-wt/<set>-<lane> -b feat/<set>-<lane> <integration head>`.
2. **In the same turn as the launch,** write its Agents row: id, worktree, branch and base, test DB,
   brief, effort, time.
3. Launch one background agent. Use `general-purpose` or the project's best-fit implementation agent,
   with the effort from `_shared-effort-budget.md` (row "Implementation lane"; a project or user rule
   overrides). Prompt:

```
Read and follow context/batch-briefs/<set>/<lane>.md. It says to read _common.md first; both are binding.
Execution context: batch <set>, lane <lane>, integration branch <branch> at <sha>.
```

Do not paste the brief into the prompt. The brief file is the record a relaunch uses.

### 2. While lanes run
- Do independent work: merges, verifier launches, task-list updates.
- Wait for completion notifications. Never block on output, poll output files, or read transcripts.
- Detect stalls per `_shared-agent-timeout.md` (no commit and no `.lane/progress.md` change for
  `stall_minutes`): message the agent first, then resume or relaunch.
- **Rule changes reach running agents:** when a rule tightens, edit `_common.md`, then `SendMessage`
  every running lane. Cross-lane notes go the same way, e.g. "wrap confirms over drawers in the shared
  layer primitive".

### 3. A lane finishes
1. Record its report in the task list: commits, migrations, deviations, deferred findings, owner items,
   merge notes. Set the module rows to `🔎 VERIFYING`.
2. Launch its **independent verifier** in the same worktree (role "Independent verifier", effort high).
   Prompt: read `_verify.md`; the lane's report claims, to check rather than trust; focus areas you
   choose from the module's risks (its invariants, the screens with the most states, new routes, new
   cross-package dependencies). Record the verifier's Agents row in the same turn.

### 4. A verifier finishes
- **PASS** (no open CRITICAL or HIGH after at most 2 sweeps): merge, step 5.
- **FAIL**: mark the modules `⚠️ VERIFY_FAILED` with the open findings. Merge anyway, flagged
  `DEPENDS_ON_UNVERIFIED` for dependents, if the integration branch still builds and its tests still
  pass; otherwise hold the lane and record why.

### 5. Merge (orchestrator only)
1. `git merge --no-ff feat/<set>-<lane>` into the integration branch.
2. **Conflicts:**
   - Lockfile: re-run the install, then check with the frozen-lockfile flag. Never hand-edit a lockfile.
   - Test helpers and maps: keep both sides' entries.
   - Migrations: renumber a colliding migration after the ones already merged, and run the
     journal-order check.
3. Build the changed packages. Run the suites in files that had conflicts, plus the test typecheck. Do
   not run a broad tier (`_shared-test-selection.md`).
4. **Release-coupled commits:** a lane commit that must ship with a later release is reverted in the
   merge and kept on the lane branch. Note it in the task list.
5. Update the module rows to `✅ MERGED (<sha>)`, update the registry (orchestrator only), and commit the
   task list: `docs(<set>): <lane> merged`.
6. Launch any lanes this merge made ready (step 1).

### 6. Failures
- **A lane agent dies or errors:** run the resume procedure (message first, then relaunch from its brief),
  at most 2 relaunches. After that, mark it `⛔ FAILED` and its dependents `⛔ BLOCKED(<module>)`.
- **All remaining lanes blocked:** FATAL "Cannot proceed: all remaining lanes blocked".

---

## Final phase: once, on the final head

### 1. Cross-module verification
Run `/verify-implementation --all` in its default 2-agent form. Focus on contract adherence across
modules, wiring between producers and consumers, and stubs whose producer is now merged. Fix CRITICAL
and HIGH only (`_shared-triage.md`).

### 2. Cross-module stub resolution
For each blocked stub whose upstream module is now merged:
- replace the placeholder with the real import;
- reclassify it as actionable, which makes it HIGH;
- commit `fix(<set>): resolve cross-module stubs`.

The complete-implementation stub gate (`/verify-implementation --stubs --all`) then passes when no
actionable stub remains, after at most one fix round.

### 3. The one full run
On the merged head: build, then `test-select --tier full` (every runner), plus e2e once (with the
project's fakes for identity, mail and third-party services). This is the only whole-suite run of the
batch.

### 4. Integration-fix pass (only if the full run or e2e failed)
1. Branch a worktree from the integration head and launch one agent (role "Integration-fix pass") to
   fix cross-lane failures.
2. It re-runs only the failed files plus the selection for its own fixes.
3. It merges last, with its migrations renumbered after every lane's.

A failure that predates the batch is listed as pre-existing with an Owner item, not fixed here.

### 5. Batch result
**✅ BATCH PASS** when every module is merged, its verify has no open CRITICAL or HIGH, the full run and
e2e are green (or every failure is pre-existing and listed), and no actionable stub remains.
Otherwise **❌ BATCH FAIL**, naming each cause.

### 6. Report
```
BATCH RESULT: {PASS|FAIL} | set {set} | integration {branch} @ {sha} | {duration}
LANES: {merged}/{total} | AGENTS: {launched} (lanes {n}, verifiers {n}, fixes {n}) | RELAUNCHES: {n}
| Module | Lane | Verify (sweeps, HIGH fixed) | UI parity | Merged @ | Notes |
FULL RUN: {files} files, {pass}/{total} | E2E: {result} | STUBS: actionable {n}, blocked {n}
DEFERRED FINDINGS: {n} (task list) | OWNER ITEMS: {n} (task list) | DECISIONS: {n}
```

### 7. Update context files
- The task list: `status: completed`, the result.
- The registry: final module statuses.
- `context/implementation-status.md`.
- Memory: at most 5 lines of durable lessons.

### 8. Next steps
- **PASS:** the integration branch is ready for review. Pushing or opening a PR follows the push policy:
  never a deploying branch without the owner's approval.
- **FAIL:** fix the named modules (`/implement-plan <blueprint> --lane` in their worktree), then
  `/implement-batch --resume`.

---

## Error handling

| Error | Code | Response |
|---|---|---|
| No blueprint master | BATCH_NO_BLUEPRINT | FATAL: "No blueprint found. Run /blueprint first." |
| Blueprint validation fails | BATCH_INVALID_BLUEPRINT | FATAL with the errors |
| Impl spec missing | BATCH_MISSING_SPEC | Mark `BLOCKED(MISSING_SPEC)`, continue |
| Lane-level cycle | BATCH_CIRCULAR_DEP | FATAL with the cycle |
| Lane agent dies or errors | BATCH_LANE_DEAD | Resume procedure; at most 2 relaunches, then FAILED and dependents BLOCKED |
| Lane stalls | BATCH_LANE_STALLED | Message the agent, then resume or relaunch |
| Verifier finds open HIGH after 2 sweeps | BATCH_VERIFY_FAILED | `VERIFY_FAILED`, dependents flagged, continue |
| Merge conflict | BATCH_MERGE_CONFLICT | Resolve per Phase 1 step 5; never hand-edit lockfiles |
| Migration collision | BATCH_MIGRATION_COLLISION | Renumber after merged ones, then the journal-order check |
| Full run or e2e fails | BATCH_FINAL_RED | Integration-fix pass |
| All remaining lanes blocked | BATCH_ALL_BLOCKED | FATAL |
| Orchestrator context summarized or session lost | BATCH_INTERRUPTED | State is on disk: re-read the task list and run the resume procedure |

## Usage

```bash
/implement-batch                                   # the project's blueprint master
/implement-batch context/blueprints/blprnt-master-ss.md
/implement-batch --dry-run                         # lane map, task list and briefs only
/implement-batch --resume                          # after an interruption
/implement-batch --max-lanes=3 --from M70 --to M81
```

## Design constraints

| Aspect | Constraint | Rationale |
|---|---|---|
| Unit of work | A lane (1–3 modules) in its own worktree, branch, test DB and ports | Parallel without collisions |
| Parallelism | At most `max_lanes` (5) running lanes | Merge conflicts and orchestrator context grow with lanes |
| Phase 0 | Contracts and stubs land as code first | Lanes overlap layers against stubs |
| Verification | One independent verifier per lane, ≤ 2 sweeps, CRITICAL and HIGH block | Found the real defects at a fraction of the cost of a 5-iteration loop |
| Tests | Targeted in lanes; one full run plus e2e at the end | Broad runs in lanes repeat what the final run does |
| Timeouts | None on lanes; stalls detected by commit and notes age | Real lanes run 3–6 hours |
| Shared state | Only the orchestrator merges and writes the task list, registry, status and memory | No conflicts in tracking files |
| Resume | Briefs on disk, ids recorded at launch, `SendMessage` first | Survives a lost session |
| Push | Never by the batch; the owner approves pushes of deploying branches | Push can mean deploy |
| Paths | Traversal validation | Prevent escape |
