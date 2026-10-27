---
description: Implement a plan or module blueprint phase by phase, updating the plan file as it goes, with targeted tests, real-browser UI parity and a capped verification (CRITICAL and HIGH block, at most 2 sweeps). Use --lane inside /implement-batch.
---

# Implement Plan

Execute plan phases automatically, **updating the plan file in real time**. Supports standalone plans
and the three-layer blueprint system. Two modes:

| Mode | Used by | Verification | Writes shared state |
|---|---|---|---|
| **standalone** (default) | a person running one plan or module | sweep 1 via `/verify-implementation`, sweep 2 re-checks the fixes | plan, status file, registry, memory |
| **`--lane`** | an `/implement-batch` lane agent | self-review against `_shared-triage.md`, at most 2 sweeps; an independent verifier follows | plan file, module Deviations, `.lane/progress.md` only; the orchestrator writes the rest |

This file is written to be followed by reading it. A lane agent without the Skill tool reads it and
follows it.

## Arguments
- `$ARGUMENTS`: plan file path or phase to start (e.g. `Phase 3`, `context/blueprints/blprnt-M1.md`).
- `--lane`: batch lane mode (above).
- `--skip-stub-gate`: stub gate results are advisory. **Not recommended.**
- `--skip-verification`: skip verification and the stub gate.

Execute automatically without permission.

## Shared protocols (`~/.claude/commands/`)

`_shared-autonomous.md` (standing rules, guardrails) · `_shared-test-selection.md` ·
`_shared-ui-parity.md` · `_shared-triage.md` · `_shared-commit-protocol.md` ·
`_shared-agent-tracking.md` (lane notes).

---

## Phase 0: Plan discovery and initialization

### 1. Find the plan
`$ARGUMENTS` → `context/blueprints/blprnt-M*.md` → `context/plans/*.md` → `~/.claude/plans/*.md`

### 2. Parse structure
Extract phases or tasks, sub-items and requirements. Note existing progress markers: on a restart,
`git log` and the plan's progress table show what is done; never redo committed work.

### 3. Detect UI assets
For each screen the plan or blueprint §4A names, record:
- its wireframe, whose **Information decisions** table governs what is shown;
- its mockup, and the mockup's state list (`?state=`).

### 4. Detect the blueprint system
If `blprnt-*.md`:
- load the §0 Context Manifest and the impl spec `context/implementation/impl-[M-ID]-[name].md`;
- load the relevant `impl-contracts` sections (LOCKED sections must not drift without a DEV entry);
- run the §12 pre-flight checks, and STOP if any fail.

Load per task, not the whole manifest at once (`_shared-effort-budget.md`).

### 5. Initialize TodoWrite
One item per phase or task, plus `VERIFY (≤ 2 sweeps)` and `CONTEXT-SYNC`.

### 6. Update the plan header
```markdown
## Implementation Progress
**Status**: 🔄 In Progress | **Current Phase**: Phase 1 | **Started**: [timestamp] | **Branch**: [branch]
| Phase | Status | Commits |
```

**State lives on disk.** Write progress to the plan file (and in `--lane` mode to `.lane/progress.md`)
at every step. If your context is summarized, re-read them and continue.

---

## Implementation loop (per phase or task)

### Step 1: Start
Mark it `🔄 In Progress` in the plan and TodoWrite.

### Step 2: Implement
- Blueprint mode: follow `impl-[M-ID]-[name].md §4` for this task; standard mode: the plan phase.
- Follow existing code patterns. A decision the spec leaves open: weigh 2–3 options, pick, and record it
  in the blueprint's §11 Deviations (`_shared-autonomous.md` §2).

**UI tasks:**
1. Read the wireframe (its Information decisions table governs) and the mockup with every state.
2. Build with the project's shared components and theme tokens, never colour literals. Add nothing the
   wireframe omits.
3. Prove parity per `_shared-ui-parity.md`: screenshot pairs of mockup and app in each key state. Fix
   structure, copy and state differences. A UI task is not done without its pairs.

### Step 3: Mark items complete
`- [x] Item ✅ (commit: [SHA])`, with evidence for significant items (files, exports, tests).

### Step 4: Lightweight verification
- Tests: `_shared-test-selection.md`, "After an edit": the selection for the files you changed, once.
- Typecheck, lint and build of the touched packages.
- Fix failures now, at most 3 attempts; then note them as known issues.

### Step 4b: Stub quick-check
```bash
grep -rn "TODO\|FIXME\|STUB\|NotImplemented\|placeholder.*implemented\|export {}" <modified-files>
```
- Intentional stubs (`OUT-*`, `MVP`): note them in the commit.
- Accidental stubs: fix them before committing.
- Structural stubs: fix if the upstream module is complete or merged; otherwise note them as expected.

### Step 5: Commit
One commit per task, through the project's gates (`_shared-commit-protocol.md`). Put the task id in the
subject: `feat(m12): T4 import preview`. Never push. Capture the sha.

### Step 6: Update progress
- The plan table row for this phase or task.
- In `--lane` mode, also `.lane/progress.md`: current task, next step, open findings, test DB state.

### Step 7: Registry (standalone mode only)
Update `blprnt-registry.md`: module status, tests, created files, and any deviation. In `--lane` mode the
orchestrator does this.

### Step 8: Continue
Next phase or task, until all are complete.

---

## Verification (≤ 2 sweeps)

Rules: `_shared-triage.md`. CRITICAL, HIGH and normal-use breaks block; Medium, Low and edge cases are
logged with a reason. No 5-iteration loop and no zero-Medium requirement.

### Standalone mode
1. **Sweep 1:** `/verify-implementation [PLAN_PATH] --force` (2-agent default). Fix every CRITICAL, HIGH
   and normal-use finding; commit `fix([scope]): address verification findings [IDs]`. Test the delta
   of the fixes only.
2. **Sweep 2:** re-check only the fixes and the code they touched (by reading and targeted tests, or
   `/verify-implementation --force` scoped to those files).
3. **Stop.** No open CRITICAL or HIGH means PASS. Otherwise FAIL, naming each open finding. A finding
   seen twice is architectural: log it, and stop fixing it.

### `--lane` mode
Self-review in at most 2 sweeps, without launching agents:
- the diff since your base against the blueprint's §6 acceptance criteria and §7A checks;
- the project's CRITICAL list (CLAUDE.md invariants and hard guardrails);
- UI parity pairs for every screen you own.

Fix CRITICAL, HIGH and normal-use findings, and list the rest. An independent verifier runs after your
lane (`/implement-batch`), so report honestly rather than polishing.

### Stub gate (after a PASS; skip with `--skip-verification`)
1. Scan with `/verify-implementation [PLAN_PATH] --stubs --force` (standalone), or the step 4b patterns
   over the whole module (lane).
2. An **actionable stub**, one the module itself should have replaced, is HIGH: fix it, in at most one
   round. Write scope is the module's impl-spec file map; upstream files are read-only.
3. **Blocked stubs** (upstream not complete) and **MVP stubs** are tracked, not failed. The batch resolves
   blocked stubs at its final phase.

### Status
- `✅ COMPLETE`: verification PASS and no actionable stub.
- `❌ VERIFICATION_FAILED`: an open CRITICAL or HIGH after 2 sweeps.
- `⚠️ STUB_GATE_FAILED`: verification PASS, but actionable stubs remain.

Write the status to the plan file:
```markdown
## Verification Status
**Result**: ✅ PASSED | **Sweeps**: 1/2 | **Fixed**: CRITICAL 0, HIGH 3 | **Deferred**: 4 (listed below)
**Stub Gate**: ✅ PASSED | Actionable: 0 | Blocked: N | MVP: M
**UI parity**: 6 screens, 14 pairs (paths below)
```

---

## CONTEXT-SYNC

### Standalone mode
1. **Plan file:** mark it complete, with the final summary.
2. **`context/implementation-status.md`:** the module row, including the stub gate.
3. **Blueprint registry** (blueprint mode):
   - frontmatter counts;
   - the Module Status row: status, gate, tests, files, deviations, date;
   - stage gates this module completes;
   - contract compliance for contracts it produces;
   - a Regression History row.
4. **Architecture document** (`docs/architecture/` or equivalent), when pipeline stages, configuration,
   data structures, events, errors, API contracts or flags changed. Skip for cosmetic or test-only work.
5. **Memory:** at most 3 lines of reusable patterns, de-duplicated.

### `--lane` mode
Update only the plan file, the blueprint's §11 Deviations and `.lane/progress.md`. Put everything else in
the report; the orchestrator writes the task list, registry, status file and memory.

---

## Final report

```
IMPLEMENTATION {COMPLETE ✅ | INCOMPLETE ❌ | STUB GATE FAILED ⚠️}
PLAN: [name] | MODE: standalone|lane | BRANCH: [branch] | COMMITS: [first → last]
VERIFICATION: {PASS|FAIL} ({n}/2 sweeps) | fixed: CRITICAL n, HIGH n | open: [IDs]
STUBS: actionable n | blocked n | MVP n
TESTS: {selection} ({n} files) ✅ | escalated tiers deferred: {yes/no}
UI PARITY: {screens} screens, {pairs} pairs → [paths]
DEFERRED: [finding — severity — why]   OWNER ITEMS: [...]   MIGRATIONS: [numbers]
```

In `--lane` mode, keep the report to 40 lines, in the order its brief asks.

---

## Critical rules

### Must do
- Execute autonomously; never ask permission (`_shared-autonomous.md`).
- Mark items complete in the plan file immediately, with their commit shas.
- Test what you changed, per `_shared-test-selection.md`; never the full suite.
- Prove UI parity in a real browser for every screen you own.
- Verify within the triage rules: at most 2 sweeps; CRITICAL and HIGH block.
- Report Medium and Low findings as deferred, with reasons.

### Never do
- Run the full suite or an escalated tier inside a lane.
- Chase Medium or Low findings past sweep 2.
- Mark the module complete with an open CRITICAL or HIGH, or an actionable stub.
- Push, use `--no-verify`, or `pkill`/`killall` by name.
- Edit CLAUDE.md without the owner's confirmation.
- In `--lane` mode, write the registry, the status file, the task list or memory.

---

## Error handling

| Error | Response |
|---|---|
| Tests fail | Fix, at most 3 attempts, then a known issue |
| Build fails | Fix type and import errors before continuing |
| Git conflict | Resolve, continue |
| External service unavailable | Use the project's fake or recorded fixtures, never the live service |
| Phase blocked | Mark it blocked; continue with independent phases |
| Finding persists into sweep 2 | Log it as architectural; an Owner item if it needs a decision |
| Stub fix breaks tests or types | Revert it, record "auto-fix failed", continue |
| Context summarized mid-run | Re-read the plan file (and `.lane/progress.md`), then continue |

## Blueprint mode specifics

**Pre-flight (§12):** dependency status, interface import checks, LOCKED contracts unchanged, build
chain. All must pass, or BLOCK.

**Session guide (§13):** LOAD the module, impl spec and contracts → PRE-FLIGHT → IMPLEMENT in task
order → VERIFY (§7A–7E, targeted) → UPDATE (standalone: registry; lane: report) → commit.

## Usage

```bash
/implement-plan                                      # most recent plan
/implement-plan context/blueprints/blprnt-M1.md      # a module blueprint
/implement-plan context/blueprints/blprnt-M1.md --lane   # inside an /implement-batch lane
/implement-plan "Phase 3"                            # resume from a phase
```

## Workflow integration

```
/plan → /analyze-plan → /blueprint → /design-ui → /implement-plan (this) → /verify-implementation → /commit
/implement-batch → lane agents run /implement-plan --lane → independent verifier → orchestrator merge
```
