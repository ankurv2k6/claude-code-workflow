---
description: Implement a whole blueprint set as parallel lanes in git worktrees. Lanes launch once their inputs have merged; each is checked by an independent verifier, focused by the project profile's risk routes, that also prepares its merge. The orchestrator alone merges and keeps a living task list, pinned to a workflow version, that can resume every agent. One combined final and one full run, at the end.
---

# Implement Batch

Execute a blueprint set as **lanes**: groups of 1–3 modules, each built by one background agent in its
own git worktree, then checked by a separate verifier that also prepares the merge. The orchestrator (you)
launches lanes as their inputs merge, merges them into the integration branch, and keeps the living task
list. Everything needed to resume is on disk.

```
specs committed → Phase 0 (profile · scaffold · known reds · contracts + stubs, UI foundation)
  → lanes side by side, each launched once its inputs have merged
  → each lane: build → independent verify + merge prep → orchestrator merges (merge-lane.mjs)
  → after the first merge: the invariant gates once, early
  → final, once: cut-end tier (invariants first) · one combined final · its fixes merged · full run once
    · integration fix → close (breaches, critical path, cleanup) → report
  → /workflow-sync --apply-additions
```

## Arguments

- `$ARGUMENTS`: blueprint master path, set suffix (e.g. `-ss`), or module id. Paths are validated as in
  Phase 0 step 2.
- `--resume`: resume from the task list (`_shared-agent-tracking.md` resume procedure).
- `--dry-run`: write the lane map, the task list and the briefs, and run the scaffold in its dry-run mode;
  launch nothing, create no worktrees. **A dry run writes files and commits nothing**: not the specs (step 7),
  not the task list, lane map or briefs (step 10).
- `--from M<N>` / `--to M<N>`: limit the module range.
- `--max-lanes=<n>`: concurrent lanes (default `agents.max_concurrent`, else 5). `--sequential` =
  `--max-lanes=1`.
- `--stall=<minutes>`: stall threshold (default `limits.stall_minutes`, else 45; `_shared-agent-timeout.md`).
- `--skip-verification`: no per-lane verifier. **Not recommended**; the batch can then not PASS.
- `--skip-stub-gate`: stub gates become advisory.

Execute automatically without permission. Use TodoWrite throughout.

**Owner questions only at two fixed points:** after the plan (before Phase 0 starts, when the owner has
not already approved it) and before a deploy or a push of a deploying branch (unless the owner approved
that deploy up front with the request, `_shared-commit-protocol.md`). Everywhere else take the
documented default, record it in the Decision log, and add an Owner item; never stop to ask.

## Shared protocols — read before Phase 0

| File (`~/.claude/commands/`) | Governs |
|---|---|
| `_shared-autonomous.md` | no pauses, decide-don't-ask, standing rules, guardrails |
| `_shared-project-profile.md` | the profile's keys, defaults and how to read them |
| `_shared-agent-tracking.md` | briefs, the Agents table, owner corrections, the resume procedure |
| `_shared-effort-budget.md` | effort and model per role, context budget, hand-back |
| `_shared-triage.md` | what blocks, the 2-sweep cap, how a verifier focuses |
| `_shared-test-selection.md` | what runs at which stage; heavy slots; known reds |
| `_shared-ui-parity.md` | the one real-browser parity pass |
| `_shared-agent-timeout.md` | completion by notification, the watchdog |
| `_shared-commit-protocol.md` | commit format, gates, push policy |

**Scripts.** The generic scripts live in `$WH/scripts/workflow/`, with `WH` resolved as
`_shared-project-profile.md` defines it (`$WORKFLOW_HOME`, else the pinned release, else the repo
`~/.claude/commands` points into). Each step that uses one says what to do by hand when it is absent.

**No profile (v1).** Without `.claude/workflow-profile.json`, the project's mechanics stay as in v1: the
steps marked "No profile (v1)" below replace the profile steps; every other rule applies as written. A key
that is absent takes its default (`_shared-project-profile.md`, Keys).

---

## Phase 0: Initialization

### 1. Detect mode
- `--resume`: read the task list; run the resume procedure (it checks for a second orchestrator and
  honours `workflow_version`); continue the lane loop from the recorded state. Lanes already `MERGED` are
  never re-run.
- Otherwise: fresh start from the blueprint master.

### 2. Validate the blueprint
Only what the batch truly needs is FATAL; the rest is a warning, recorded in the Decision log, so an older
master still runs.

| Check | On failure |
|---|---|
| **Paths** resolve inside the project root; reject null bytes, `..`, `%2e`, `%2f`, and symlinks | FATAL |
| **A module list:** S5 Module Index, else the registry, else an impl-master S1 lane map | FATAL "no module list: the batch cannot know what to build" |
| **Dependency information:** S6B Dependency Matrix, else each module's "depends on" / inputs, else the S1 lane map's `waits_on` | FATAL "no dependency information: lanes cannot be ordered" |
| **Ids:** a module id matches `/^M\d{1,3}[a-z]?$/` and is in the registry or the module list; a lane or cross-cutting id (`C0`, `C0-UI`, `PERF`) matches `/^[A-Z][A-Z0-9]{0,7}(-[A-Z0-9]{1,8})*[a-z]?$/` and is named in the lane map or the module list. Neither may contain `/`, `\` or `.` | FATAL for a malformed id; an unknown one is a warning |
| YAML frontmatter with `blueprint`, `version`, `status`; at most 100 KB | warning |
| S6C Phase Timeline | warning: lane order comes from the dependencies |

On a FATAL: "Blueprint validation failed: {errors}", each with its reason.

### 3. Read the profile
Read `.claude/workflow-profile.json` and check it, per `_shared-project-profile.md` ("How a skill reads
it"; script absent: compare its keys with the schema by eye, and check that each tier names only registered
gates). **An invalid profile stops the run** with the errors as an Owner item; never fall back from a broken
profile. Its WARNING lines (no `reach-walk` gate, an unset heavy `lock_dir`) go to the Decision log and do
not stop the run. No profile (v1): skip.

### 4. Build the lane map
- Prefer `impl-master` **S1 lane map** (lanes, modules, inputs, merge order). Each lane records:

  | Field | Holds |
  |---|---|
  | `lane` | its id: a module id (`M12`, `M12a` for a split), or a lane or cross-cutting id (`C0`, `C0-UI`, `PERF`) |
  | `modules` | the modules it builds |
  | `tasks` | optional: the subset of those modules' tasks it builds, when a module is split across lanes (`["T1", "T3"]`); absent means every task |
  | `waits_on` | the lanes that must have merged before it launches (C0's stubs count as merged); `[]` when none |
  | `merge_order` | 1, 2, … the order the orchestrator merges in |
  | `ports` | the port names it needs (`["api", "web"]`), allocated by the scaffold; absent: profile `ports.names` |

  The lane map file (step 9) holds these plus the scaffold's own fields; `scaffold.mjs --help` has the format.
- Without one, derive it:
  - **C0 (Phase 0):** every LOCKED contract as code, plus every stub in impl-master S5, when any exists.
  - **C0-UI:** the shared UI foundation (theme port, components used on 2+ screens, shared navigation),
    when any module is `type: ui`.
  - **Other lanes:** group modules that share files, at most 3 modules or about 8 screens per lane.
- **A lane launches only when every input it builds on has merged**, and C0's verifier has signed off.
  C0's contracts and stubs count as merged inputs. Never launch a lane to build against a sibling's
  unmerged code and pause: split the lane at that task (a `tasks` subset per part), or order it after the
  sibling. **Exception:** a lane whose `waits_on` is empty and which consumes no contract under review in C0
  (no LOCKED contract, stub or shared UI piece C0 or C0-UI is still building) may start beside C0; record
  why in the Decision log.
- Detect cycles at lane level by topological sort. A cycle → FATAL with the cycle path.

### 5. Validate module specs
Each module needs `blprnt-<M>-*.md` and `impl-<M>-*.md`. A missing one → `BLOCKED(MISSING_SPEC)`.

### 6. Detect UI modules
A module is UI when its blueprint declares `type: ui`; without a `type`, when its blueprint references
wireframes or mockups (`design/wireframes/`, `design/mockups/`, a §4A screen list) or a `ui-mapping` exists
for it. A blueprint that declares another `type` is not UI. **List the detected UI modules, each with why**
(`type: ui`, wireframe reference, mockup reference, `ui-mapping`), in the Decision log and in the dry-run
printout, so the owner can confirm or correct them; decide, don't wait. Record each UI module's screens,
wireframes, mockups and mockup states (from §4A and `ui-mapping`) for its lane brief.

### 7. Commit the specs
If the blueprints, mockups or briefs are uncommitted, commit them (`docs(<set>): …`) on the integration
branch first. Worktrees branch from a commit, so uncommitted specs are invisible to every lane. `--dry-run`:
commit nothing; list the uncommitted specs instead.

### 8. Create the living task list
Copy `$WH/.claude/templates/batch-progress.md` (the release the scripts come from, so the template and the
skills are one version) to `context/batch-progress[-<set>].md` and fill:
- the header: integration branch, base sha, `max_lanes`, `stall_minutes`,
  `workflow_version: <the contents of $WH/VERSION>` (file absent: `1.0.0`), the same file the resume
  procedure compares against, and `integration_test_db:` (step 11);
- the execution plan (lanes, inputs, merge order) and module status rows;
- empty Decision and Owner corrections logs.

The orchestrator is its only writer (`orch-event.mjs`, `_shared-agent-tracking.md`).

### 9. Lane map file and scaffold dry run
Write the lane map as `context/batch-briefs/<set>/lane-map.json` in the format of `scaffold.mjs --help`
(the step 4 fields plus `branch`, `test_db`, `brief`), with every lane's `branch` set to `feat/<set>-<lane>`
(the scaffold's own default differs) and `base` the integration head. Run `node "$WH/scripts/workflow/scaffold.mjs" --lane-map <file>` (a dry run: it creates
nothing) and keep its plan: each lane's worktree, ports and test DB. Script absent: worktrees
`<repo>-wt/<set>-<lane>`, ports and test DBs as the project's briefs and CLAUDE.md give them.

### 10. Write the briefs
Take each lane's worktree, ports and test DB from step 9. From `$WH/.claude/templates/batch-briefs/`:
- **`context/batch-briefs/_common.md`**, the programme rules: create it once, or refresh it. Fill its
  command table from the profile (`shell_prefix`, `commands.*`, `tiers.per_commit`, `tiers.lane_end`,
  `known_reds`, `logs_dir`, `limits.*`) and `<WH>` with the resolved path and cite CLAUDE.md by section (`docs.invariants`,
  `docs.guardrails`), never by copy. Add this cut's `## Delta: <set>` section: only what this cut changes.
  No profile (v1): fill the table with the commands `_shared-test-selection.md` and the project's
  commit gates give.
- **`context/batch-briefs/_verify.md`**, the programme verifier brief.
- **One `context/batch-briefs/<set>/<lane>.md` per lane,** under 60 lines: worktree, branch, base, test DB,
  ports, logs, scratch directory, effort, the sections to read by anchor, screens and their mockup states,
  and "done".

Commit the task list, the lane map and the briefs together (not on `--dry-run`).

### 11. Scaffold, smoke run and known reds
- **Scaffold:** the step 9 command with `--apply` and
  `--smoke-commands typecheck,test_lane_end` (those the profile defines). It creates the worktrees and
  branches, allocates ports from the registry, creates the test DBs through `test_db`, runs the `health`
  gates once, creates the **integration test DB** (the `test_db.name_pattern` with `{lane}` = `int`) for
  the merge gates and the final, and records nothing itself: write its URL into the task list's
  `integration_test_db:` header. It then smoke-runs in the first lane that has a test DB (else the first lane; commands that need a
  test DB are then listed as not smoke-run): `commands.install`, then `commands.build` (always, in
  a worktree it creates), then the `smoke: true` gates, then the named commands, so the test commands run
  after their test DB exists. Never name `test_full` (it runs once, at the final) or `test_task` (it needs
  `{files}`); run `commands.test_task` yourself once in that worktree with one existing test file. A red is
  fixed in the profile or the brief before any lane launches (BATCH_SMOKE_FAILED).
- **`--dry-run`:** no scaffold `--apply`, so no test DB exists, and the smoke run covers only what needs
  none: install, build, typecheck and the `smoke: true` gates, in the current checkout:
  `node "$WH/scripts/workflow/profile-check.mjs" --profile .claude/workflow-profile.json --smoke
  --install-first --base <sha> --only gates.<name> … --only commands.typecheck` (`--install-first` runs
  install, then build, before the gates). Never name `test_lane_end`, `test_task` or `test_full` here: the
  test commands are smoke-run by the `--apply` scaffold once the DBs exist. Never run `profile-check --smoke`
  without `--only`: it would also run every test command.
- **Script absent:** create each worktree at launch (Phase 1 step 1), take ports and test DBs as the briefs
  name them, and run each brief command (except `test_full`) once yourself on the base head.
- **Known reds** (not on `--dry-run`): run the selection that covers the entries of the `known_reds` file
  once on the base head. Record which are still red in the task list; briefs point at the file so no agent
  re-diagnoses them. A red in an `invariant_suites` suite is never a known red: fix it, or stop with an
  Owner item. No profile (v1): skip; reds that predate the batch are found at the final.

### 12. `--dry-run` stops here
Print the lane map, the detected UI modules with their reasons, the scaffold's dry-run plan, the smoke-run
results and the paths written. A dry run creates no worktree, branch or test DB, launches nothing and
commits nothing: the files it wrote stay uncommitted for the owner to read. Set the task list's `status:`
to `dry_run`, so the watchdog never reads it as a running batch.

---

## Phase 1: Lane loop

Repeat until every lane is merged, failed or blocked. Never pause between steps.

### 1. Launch ready lanes
**Before each wave of launches** (a few lines, never a blocker):
- **Base freshness:** when the profile names `docs.release_branch`, check that the integration head
  contains it (`git merge-base --is-ancestor <release branch> <integration head>`). Behind: record an
  Owner item ("integration base lacks <release branch> @ <sha>") and continue.
- **Usage budget:** record the remaining usage budget the owner gave, or ask for it once; a wave that
  would exceed it is a warning in the Checkpoint log, not a stop.
- **Lane-map validator:** `node "$WH/scripts/workflow/scaffold.mjs" --lane-map <file> --task-list <task
  list> --lanes <the wave's lanes>` (a dry run). Exit 2 names each lane whose `waits_on` lane is not
  `MERGED` in the task list: do not launch it. Script absent: check each `waits_on` against the task
  list by eye.

Phase 0 lanes (C0, then C0-UI) launch first; no other lane starts until C0 has merged and its verifier has
signed off, except a lane that consumes no contract under review and whose `waits_on` is empty (Phase 0
step 4), which may start beside C0. After that, launch every lane whose `waits_on` lanes have merged, up to
`max_lanes` at once. For each:

1. No scaffold: `git worktree add <repo>-wt/<set>-<lane> -b feat/<set>-<lane> <integration head>`. With
   it, a lane launched after the scaffold ran branches at that older head: merge the integration head into
   its branch before launch.
2. **In the same turn as the launch,** write its Agents row: id, worktree, branch and base, test DB,
   brief, effort (and model), time.
3. Launch one background agent. Use `general-purpose` or the project's best-fit implementation agent,
   with the effort and model from `_shared-effort-budget.md` (row "Implementation lane"; a project or user
   rule overrides). Prompt:

```
Read and follow context/batch-briefs/<set>/<lane>.md. It says to read _common.md first; both are binding.
Execution context: batch <set>, lane <lane>, integration branch <branch> at <sha>.
```

Do not paste the brief into the prompt. The brief file is the record a relaunch uses.

Once the first lane runs, start the watchdog (`_shared-agent-timeout.md`).

### 2. While lanes run
- Do independent work: merges, verifier launches, task-list updates.
- Wait for completion notifications. Never block on output, poll output files, or read transcripts.
- **The watchdog's exit wakes you:** on a stall, message the agent first, then resume or relaunch; restart
  the watchdog.
- **Heavy jobs take a slot** (`heavy_jobs`, through `slot.sh`; `_shared-test-selection.md`), yours included,
  except a job marked `self_locking`, which takes its own lock and is never wrapped in `slot.sh`. With
  `tests.heavy_lock` set, each heavy job also runs inside the machine's one heavy lock, outermost, after you
  tell peer sessions; never two heavy jobs from two owners at once.
- **Orchestrator restart:** at each milestone (Phase 0 done, after each merge wave), write a restart note
  in the Checkpoint log (what is running, what is next, the open Owner items). When your context has
  passed `limits.context_budget_tokens`, end the session after that note; the next session resumes with
  `--resume` (`_shared-agent-tracking.md`).
- **Rule changes reach running agents:** when a rule tightens, edit `_common.md` (the programme rules, or
  this cut's delta), then `SendMessage` every running lane. Cross-lane notes go the same way.
- **Owner corrections** are logged when they happen (`_shared-agent-tracking.md`).

### 3. A lane finishes
1. Record its hand-back in the task list: commits, migrations, deviations, deferred findings, owner items,
   merge notes. Set the module rows to `🔎 VERIFYING`.
   - `Status: session split`: relaunch it from its brief with the resume preface (not a failure).
2. **Build the focus list:** match the lane's changed files (`git diff --name-only <base>...HEAD`) against
   `risk_routing`; each match adds its paths and `reason`, and its `verifier` agent type. No profile (v1):
   choose the focus from the module's risks (its invariants, the screens with the most states, new routes,
   new cross-package dependencies).
3. Launch its **independent verifier** in the same worktree (role "Independent verifier": effort high,
   model `agents.verifier_model`, the agent type from the focus list or the project's reviewer; when the
   focus list names several types, one verifier per type, split by file ownership, `_shared-triage.md`).
   **The contracts lane (C0) always gets a specialist verifier** when the profile has `risk_routing`: the
   route types whose paths its contracts serve, even when no changed file matches, plus the `reach-walk`
   gate's output when the registry has one.
   It reviews beside the quick tier and runs the lane's wide selection and `tiers.merge` once, after its
   fixes (`_shared-triage.md`). Prompt:
   read `context/batch-briefs/_verify.md`; the lane's hand-back, as claims to check rather than trust; the
   focus list. Record the verifier's Agents row in the same turn.

### 4. A verifier finishes
- **PASS** (no open CRITICAL or HIGH after at most 2 sweeps): record the verifier's final head sha and
  whether its `tiers.merge` run was green on it (its "Merge prep" heading), then merge, step 5.
- **FAIL**: mark the modules `⚠️ VERIFY_FAILED` with the open findings. Merge anyway, flagged
  `DEPENDS_ON_UNVERIFIED` for dependents, if the integration branch still builds and its tests still
  pass; otherwise hold the lane and record why.

### 5. Merge (orchestrator only)
1. **Through the merge script**, on the integration branch:
   `node "$WH/scripts/workflow/merge-lane.mjs" --lane <lane branch> --verified-head <the verifier's green
   sha> --url <integration_test_db> --apply` (a run without `--apply` first predicts conflicts). It merges
   `--no-ff`, runs `merge.renumber` and `merge.check` when defined, then `tiers.merge`, with the
   `shell_prefix` and quoted placeholders, and prints at most 10 lines. **It skips `tiers.merge` when the
   lane head is the verifier's green sha and already contains the integration head** (the verifier ran the
   tier on exactly what merged); otherwise the tier runs once. Exit 1: a red (the merge commit stays: fix
   forward or revert it). Exit 2: a conflict, listed and aborted, never resolved by the script: resolve by
   hand (below). An agent gate it lists is launched as `_shared-project-profile.md` says. When the profile
   sets `tests.merge_delta`, run it once after the script (`{ours}` the integration head before the merge,
   `{theirs}` the lane head), skipped under the same rule; a merge never runs a broad selection.
2. **By hand** (script absent, or after exit 2): `git merge --no-ff <lane branch>` (its Agents row;
   `feat/<set>-<lane>`) into the integration branch, then resolve:
   - Lockfile: re-run the install, then check with the frozen-lockfile flag. Never hand-edit a lockfile.
   - Test helpers and maps: keep both sides' entries.
   - Migrations: renumber a colliding migration after the ones already merged (`merge.renumber` when the
     profile has it) and run the journal check (`merge.check`, or the `tiers.merge` journal gate). No
     profile (v1): renumber and run the project's journal-order check.
3. **Checks by hand:** run `tiers.merge` once (`run-tier.mjs merge`; heavy gates through their slot),
   skipped under the same rule as the script's. No profile (v1): build the changed packages, run the
   suites in files that had conflicts, plus the test typecheck; no broad tier.
4. **Release-coupled commits:** a lane commit that must ship with a later release is reverted in the
   merge and kept on the lane branch. Note it in the task list.
5. Update the module rows to `✅ MERGED (<sha>)`, update the registry (orchestrator only), and commit the
   task list: `docs(<set>): <lane> merged`.
6. Launch any lanes this merge made ready (step 1).
7. **Early isolation, once:** after the **first** lane merges, run `tiers.cut_end`'s invariant gates (kind
   `rehearsal`, or those running `invariant_suites`) once on the integration head, heavy gates through
   their slot, so an invariant break surfaces while lanes are still running, not at the final. A red is a
   CRITICAL for the lane that brought it. They run again at the final.

**Merges between tracks:** a routine re-merge of one track's integration branch into another (to keep shared
files in step) runs `tiers.merge` only. `tiers.track_merge` runs once at a track-merge **milestone**: a track's
finished cut merging into the mainline, or before a release.

### 6. Failures
- **A lane agent dies or errors:** run the resume procedure (message first, then relaunch from its brief),
  at most 2 relaunches. After that, mark it `⛔ FAILED` and its dependents `⛔ BLOCKED(<module>)`.
- **All remaining lanes blocked:** FATAL "Cannot proceed: all remaining lanes blocked".

---

## Final phase: once, on the final head, in this order

**The full run happens once, in step 3, after the final's fixes have merged.** Nothing before it runs
`commands.test_full` (or `--tier full`): not the cut-end tier (`profile-check` refuses a tier gate whose
command is the full run), not the combined final, not a fix agent. A worktree the final phase runs in that keeps a
`.lane/` scratch folder is marked first, `echo final > .lane/role`: a project's lane guards apply to lanes only.

### 1. Cut-end checks
1. **The invariant suites, first:** `commands.test_task` with `{files}` = every `invariant_suites` path, in
   one call (skip this only when a `tiers.cut_end` gate already runs exactly those suites; run that gate
   first instead). They run every cut, whatever else the tier holds.
2. **Then the rest of `tiers.cut_end`,** in order: `node "$WH/scripts/workflow/run-tier.mjs" cut_end --url
   <integration_test_db> --base <base sha>` (heavy gates through their slot unless self-locking).
3. **Agent gates** in the tier: launch each one's `verifier` agent (effort high, `agents.verifier_model`)
   with its `asks` as the task and its helper output (the runner saved it) in the prompt; record each
   verdict, with the agent id, in the task list. It passes only on PASS; a FAIL is a red.

A red here is CRITICAL for the combined final. No profile (v1): skip; the full run (step 3) covers them.

### 2. One combined final (code and behaviour)
Run `/verify-implementation --all` in its default 2-agent form (A: code, B: behaviour), with the cut-end
reds as its first focus. It covers contract adherence across modules, wiring between producers and
consumers, and cross-module stubs:
- for each blocked stub whose upstream module is now merged, replace the placeholder with the real
  import; it is now actionable, so HIGH;
- the complete-implementation stub gate (`--stubs --all`) passes when no actionable stub remains, after at
  most one fix round.

Fix CRITICAL and HIGH only (`_shared-triage.md`), and **merge the fixes before step 3** (through
`merge-lane.mjs` when they are on a branch).

### 3. The one full run
Only now, on the merged head that holds the final's fixes: build, then `commands.test_full` once (through
its slot when heavy, inside `tests.heavy_lock` when set, peers told first; a release rehearsal on the same
head runs beside it in that one hold). No profile (v1): `test-select --tier full` (every runner), plus e2e once with the
project's fakes for identity, mail and third-party services. This is the only whole-suite run of the batch;
a red goes to step 4, never to a second full run.

### 4. Integration-fix pass (only for new reds)
Compare each red with the `known_reds` file (no profile: with the base head). Only reds missing from it get
a fix:
1. Branch a worktree from the integration head and launch one agent (role "Integration-fix pass").
2. It re-runs only the failed files plus the selection for its own fixes.
3. It merges last, with its migrations renumbered after every lane's.

A known or pre-existing red is listed by name with an Owner item, not fixed here; a listed file that now
passes is reported for removal from the known-reds file.

### 5. Batch result
**✅ BATCH PASS** when every module is merged, its verify has no open CRITICAL or HIGH, the cut-end checks
and the full run are green (or every red is known and listed), and no actionable stub remains.
Otherwise **❌ BATCH FAIL**, naming each cause.

### 6. Close: breaches, critical path, cleanup
- **Breaches and critical path:** `node "$WH/scripts/workflow/build-report.mjs" --session <orchestrator
  session id> --since <started> --until <now> --set <set> --breaches --critical-path --task-list <task
  list>` (writes `<logs_dir>/build-report-<set>.md` and prints both tables). In the task list's Close
  section record: each breach count; "Escaped defects since the last batch" (the defects the project's
  lessons file, `context/workflow-lessons.md`, records as found after the last batch closed; none: 0);
  building, checking, documents and waiting minutes; the orchestrator's average context (a breach means
  restart it sooner next time); and "Time to owner acceptance" (from `accepted_on_beta:` in the header,
  once the owner accepts: "pending" until then). Script absent: "not available".
- **Cleanup list:** run `commands.cleanup_list` once when the profile has it (read-only) and record its
  summary (worktrees, branches, test DBs, ports left) as Owner items; delete nothing.

### 7. Report
```
BATCH RESULT: {PASS|FAIL} | set {set} | integration {branch} @ {sha} | {duration} | workflow {version}
LANES: {merged}/{total} | AGENTS: {launched} (lanes {n}, verifiers {n}, fixes {n}) | RELAUNCHES: {n} | SPLITS: {n}
| Module | Lane | Verify (sweeps, HIGH fixed) | UI parity | Merged @ | Notes |
CUT END: {gates} | AGENT GATES: {pass}/{n} | FULL RUN: {files} files, {pass}/{total} | NEW REDS: {n} | STUBS: actionable {n}, blocked {n}
BREACHES: {total} ({by kind}) | ESCAPED DEFECTS: {n} | TIME: building {m} · checking {m} · documents {m} · waiting {m}
DEFERRED FINDINGS: {n} | OWNER ITEMS: {n} | OWNER CORRECTIONS: {n} | DECISIONS: {n} (task list)
```

### 8. Update context files
- The task list: `status: completed`, the result.
- The registry: final module statuses.
- `context/implementation-status.md`.

### 9. Last step: `/workflow-sync --apply-additions`
Run `/workflow-sync --apply-additions` on this batch: it harvests the lessons, classifies them, diffs the
profile and applies only its mechanical additions. Only the batch's orchestrator passes the flag; a hand run
applies nothing. Command absent (v1 install): write at most 5 lines of durable lessons to memory instead.

### Next steps
- **PASS:** the integration branch is ready for review. Pushing or opening a PR follows the push policy:
  never a deploying branch, and never a deploy, without the owner's approval of that specific push (it may
  be given up front). Shipping, and any hotfix after it: `_shared-test-selection.md`, Hotfix and release.
- **FAIL:** fix the named modules (`/implement-plan <blueprint> --lane` in their worktree), then
  `/implement-batch --resume`.

---

## Error handling

| Error | Code | Response |
|---|---|---|
| No blueprint master | BATCH_NO_BLUEPRINT | FATAL: "No blueprint found. Run /blueprint first." |
| Blueprint validation fails | BATCH_INVALID_BLUEPRINT | FATAL with the errors |
| Profile check fails | BATCH_INVALID_PROFILE | Stop; the errors become an Owner item |
| A brief command fails its smoke run | BATCH_SMOKE_FAILED | Fix the profile or brief before any lane launches |
| Impl spec missing | BATCH_MISSING_SPEC | Mark `BLOCKED(MISSING_SPEC)`, continue |
| Lane-level cycle | BATCH_CIRCULAR_DEP | FATAL with the cycle |
| Lane agent dies or errors | BATCH_LANE_DEAD | Resume procedure; at most 2 relaunches, then FAILED and dependents BLOCKED |
| Lane stalls (watchdog exit 3) | BATCH_LANE_STALLED | Message the agent, then resume or relaunch; restart the watchdog |
| Verifier finds open HIGH after 2 sweeps | BATCH_VERIFY_FAILED | `VERIFY_FAILED`, dependents flagged, continue |
| Merge conflict (`merge-lane.mjs` exit 2) | BATCH_MERGE_CONFLICT | Resolve by hand per Phase 1 step 5; never hand-edit lockfiles |
| A lane's inputs not merged (scaffold `--task-list` exit 2) | BATCH_INPUT_UNMERGED | Do not launch it; it waits for the next wave |
| Migration collision | BATCH_MIGRATION_COLLISION | Renumber after merged ones, then the journal check |
| Cut-end check or full run red | BATCH_FINAL_RED | Integration-fix pass for reds not in the known-reds file |
| All remaining lanes blocked | BATCH_ALL_BLOCKED | FATAL |
| Orchestrator context summarized or session lost | BATCH_INTERRUPTED | State is on disk: re-read the task list and run the resume procedure |

## Usage

```bash
/implement-batch                                   # the project's blueprint master
/implement-batch context/blueprints/blprnt-master-ss.md
/implement-batch --dry-run                         # lane map, task list, briefs, scaffold plan
/implement-batch --resume                          # after an interruption
/implement-batch --max-lanes=3 --from M70 --to M81
```

## Design constraints

| Aspect | Constraint | Rationale |
|---|---|---|
| Unit of work | A lane (1–3 modules) in its own worktree, branch, test DB and ports | Parallel without collisions |
| Launch | Only once its inputs have merged and C0's verifier signed off | A lane started against unmerged code idles with a full context |
| Parallelism | At most `max_lanes` running lanes | Merge conflicts and orchestrator context grow with lanes |
| Checks | Each at the first stage that can find its defect: per commit, task, lane end, merge, cut end, track merge | A check repeated at every stage finds nothing new |
| Verification | One independent verifier per lane on Opus, focused by risk, ≤ 2 sweeps, CRITICAL and HIGH block | Found the real defects at a fraction of the cost of a 5-iteration loop |
| Tests | Targeted in lanes; one combined final, its fixes merged, then one full run | Broad runs in lanes repeat what the final run does; a full run before the fixes merge is wasted |
| Stalls | The watchdog, on commits, notes and log growth; slot holders exempt | No timers on long work; a stall still wakes the orchestrator |
| Shared state | One orchestrator per batch; only it merges and writes the task list, registry and status | No conflicts in tracking files |
| Resume | Briefs on disk, ids recorded at launch, `SendMessage` first, the batch's own workflow version | Survives a lost session and a workflow release |
| Push | Never by the batch; the owner approves each push or deploy of a deploying branch | Push can mean deploy |
| Paths | Traversal validation | Prevent escape |
