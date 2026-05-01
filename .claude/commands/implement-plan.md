# Implement Plan

Execute plan phases automatically, **updating the plan file in real-time**. Supports standalone plans and three-layer blueprint system.

## Arguments
- `$ARGUMENTS` - Plan file path or phase to start (e.g., `Phase 3`, `context/blueprints/blprnt-M1.md`)
- `--skip-stub-gate` - Skip the stub verification gate (Section 9b). Stub gate results not required for COMPLETE status. **Not recommended** — escape hatch only.
- `--skip-verification` - Skip both the verify-loop (Section 9) AND the stub gate (Section 9b). Both gates depend on verification results.

Execute automatically without permission.

---

## Phase 0: Plan Discovery & Initialization

### 1. Find Plan
`$ARGUMENTS` → `context/blueprints/blprnt-M*.md` → `context/plans/*.md` → `~/.claude/plans/*.md`

### 2. Parse Structure
Extract phases, sub-items, requirements. Identify existing progress markers.

### 3. Detect UI Assets
Check `design/wireframes/` and `design/mockups/`. If found, set `UI_ASSETS_PRESENT=true` and add note:
```markdown
## UI Design Assets
**Wireframes**: design/wireframes/{feature}/ | **Mockups**: design/mockups/{feature}/
**Note**: UI implementation MUST follow these assets exactly.
```

### 4. Detect Blueprint System
If `blprnt-*.md`:
- Load §0 Context Manifest, impl spec `context/implementation/impl-[M-ID]-[name].md`
- Load shared contracts (relevant sections only)
- Run pre-flight checks from §12; STOP if any fail

### 5. Initialize TodoWrite
Add all phases: first = `in_progress`, rest = `pending`. Include mandatory items:
- Per phase: implementation + verification
- **Final (MANDATORY)**:
  - `VERIFY-LOOP: Run iterative verification (max 5 iterations, need 1 clean run)`
  - `CONTEXT-SYNC: Update plan file and status based on verification result`

**Store plan path for verify-loop**: `PLAN_PATH = [resolved plan file path]` — this MUST be passed to verify-implementation.

### 6. Update Plan Header
```markdown
## Implementation Progress
**Status**: 🔄 In Progress | **Current Phase**: Phase 1
**Started**: [timestamp] | **Branch**: [current branch]
| Phase | Status | Commits |
| Phase 1 | 🔄 In Progress | — |
```

---

## Implementation Loop (Repeat per Phase)

### 0. Context Compact (Pre-Phase)
Run `/compact`, then re-read `[PLAN_PATH]` to restore phase tracking state and current position; continue.

### Step 1: Start Phase
Update status to `🔄 In Progress` in both plan and TodoWrite.

### Step 2: Implement
- Blueprint mode: Read `impl-[M-ID]-[name].md §4`
- Standard mode: Implement changes per plan phase
- Follow existing code patterns

**UI Implementation** (if UI_ASSETS_PRESENT) — MANDATORY:
1. Read wireframe: `design/wireframes/{Feature}/{XX}_{component}.md`
2. Read mockup: `design/mockups/{Feature}/{XX}_{component}.html` (SOURCE OF TRUTH)
3. Implement matching all elements, CSS values, states, and breakpoints exactly
4. Run `/verify-ui` before marking component complete — do NOT proceed if compliance < 100%

### Step 3: Mark Items Complete
After each item: `- [x] Item ✅ (commit: [SHA])`

Evidence for significant items:
```markdown
- [x] Create unified logger module ✅ (commit: abc1234)
  - Created: packages/logger/src/index.ts (127 lines)
  - Exports: createLogger, LogLevel, RequestContext
  - Tests: 12 passing, coverage 94%
```

### Step 4: Lightweight Verification
```bash
npm test 2>/dev/null || npx vitest run        # Tests
npx tsc --noEmit                               # Types
npm run lint 2>/dev/null || npx eslint .       # Lint
npm run build 2>/dev/null                      # Build
```
Fix failures immediately (max 3 attempts).

### 4b. Stub Quick-Check (Pre-Commit Gate)
Scan files created/modified in this phase for accidental stubs before committing:
```bash
# Quick pattern scan on files modified in this phase
grep -rn "TODO\|FIXME\|STUB\|NotImplemented\|placeholder.*implemented\|export {}" <modified-files>
```
- **Intentional stubs** (tagged with `OUT-*` or `MVP`): Note in commit message, continue
- **Accidental stubs**: Fix immediately before committing the phase
- **Structural stubs** (`unknown` types, empty bodies): Check if upstream dependency exists
  - If upstream module is COMPLETE: fix now (replace with real import)
  - If upstream module is PENDING: acceptable, note as expected dependency stub

This lightweight gate catches stubs early, reducing the load on the post-loop VERIFY-LOOP.

### Step 5: Commit Phase
See `_shared-commit-protocol.md`. Include phase reference in body (e.g., "Phase 1 of M1-logger blueprint"). Do NOT push. Capture SHA.

### Step 6: Update Plan
```markdown
| Phase 1 | ✅ Complete | abc1234 |
```
Mark TodoWrite item `completed`, next phase `in_progress`.

### Step 7: Blueprint Mode Updates (if blueprint system detected)
Update `context/blueprints/blprnt-registry.md`:
- **Module Status Table**: Set module status to `IN_PROGRESS` (or `COMPLETE` if final phase), update Tests count and Coverage from latest run
- **Implementation Progress**: Update Created Files count for this module
- **Deviation Log**: Add entry if any deviation from spec occurred in this phase

### Step 8: Continue
Repeat for next phase until all complete.

---

## Post-Loop: Deep Verification (CRITICAL — MUST EXECUTE)

> ⚠️ **MANDATORY**: This verification loop is NON-NEGOTIABLE. Do NOT skip or abbreviate. Execute exactly as specified. The implementation is NOT complete until this loop terminates with PASS or FAIL.

See `_shared-autonomous.md`. Scope: the ENTIRE verify-loop. Only output the final result (PASS or FAIL).

### 8b. Context Compact (Pre-Verify-Loop)
Run `/compact`, re-read `[PLAN_PATH]` to restore PLAN_PATH and completed phase list; re-initialize `ITERATION=0`, `CONSECUTIVE_CLEAN=0`; continue.

### 9. VERIFY-LOOP — Iterative Gap Resolution

**Execution Mode**: FULLY AUTOMATED — no user interaction until loop terminates.

**Initialize tracking variables:**
```
PLAN_PATH = [path to current plan file being implemented]
ITERATION = 0
CONSECUTIVE_CLEAN = 0
MAX_ITERATIONS = 5
REQUIRED_CLEAN_RUNS = 1
```

**Loop execution (repeat until exit condition):**

```
WHILE ITERATION < MAX_ITERATIONS:
    ITERATION += 1

    1. Run verification:
       Use Skill tool: skill: "verify-implementation", args: "[PLAN_PATH] --force"

    2. Parse results — count gaps by severity:
       - CRITICAL_GAPS = count of Critical severity
       - HIGH_GAPS = count of High severity
       - MEDIUM_GAPS = count of Medium severity
       - SIGNIFICANT_GAPS = CRITICAL_GAPS + HIGH_GAPS + MEDIUM_GAPS

    3. Log iteration:
       "VERIFY-LOOP [ITERATION/MAX_ITERATIONS]: Critical={X}, High={Y}, Medium={Z}"

    4. Check for clean run:
       IF SIGNIFICANT_GAPS == 0:
           CONSECUTIVE_CLEAN += 1
           "✅ Clean run #{CONSECUTIVE_CLEAN}"
       ELSE:
           CONSECUTIVE_CLEAN = 0  // Reset counter
           "⚠️ Gaps found — fixing..."

    5. Check exit conditions:
       IF CONSECUTIVE_CLEAN >= REQUIRED_CLEAN_RUNS:
           EXIT LOOP → VERIFICATION PASSED

    6. If gaps found, auto-fix:
       - Read affected files
       - Implement fixes for all Critical, High, Medium gaps
       - Run tests to verify fixes
       - Commit fixes:
         fix([scope]): address verify-implementation gaps [GAP-IDs]

    6b. Context Compact (mid-loop):
       Run `/compact`; re-read `[PLAN_PATH]` to restore PLAN_PATH, ITERATION, CONSECUTIVE_CLEAN; continue.

    7. IMMEDIATELY continue to next iteration
       - DO NOT pause to report
       - DO NOT ask user to continue
       - DO NOT wait for any input
       - Just proceed directly to step 1 of next iteration

END WHILE

// If loop exhausted without success:
EXIT LOOP → VERIFICATION FAILED
```

### 9b. STUB GATE — Per-Module Stub Verification

**Runs ONLY if verify-loop PASSED.** Skip if FAILED (Section 10 writes VERIFICATION_FAILED as before).
**Skip if `--skip-stub-gate`**: Report stub gate results but do not block completion.
**Skip if `--skip-verification`**: Stub gate depends on verify-loop results; if verify-loop was skipped, stub gate is also skipped.

**Timeout budget**: Stub gate total = 2x AGENT_TIMEOUT (240s default). Includes scan + auto-fix + re-scan.

```
Log: { event: 'STUB_GATE_START', planPath: PLAN_PATH, module }

1. Run stub scan:
   Use Skill tool: skill: "verify-implementation", args: "[PLAN_PATH] --stubs --force"

2. Parse results using truth table (from verify-implementation Agent 6):
   ACTIONABLE_STUBS = count where actionable == true
   BLOCKED_STUBS = count where actionable == false AND category != STUB-MVP
   MVP_STUBS = count where category == STUB-MVP

   Log: { event: 'STUB_GATE_SCAN_RESULT', module, actionable: ACTIONABLE_STUBS, blocked: BLOCKED_STUBS, mvp: MVP_STUBS, total, stubIds: [...] }

3. If ACTIONABLE_STUBS == 0:
   STUB_GATE = PASSED
   Log: { event: 'STUB_GATE_RESULT', module, result: 'PASSED', actionable: 0, blocked: BLOCKED_STUBS, mvp: MVP_STUBS }
   → Proceed to Section 10

4. If ACTIONABLE_STUBS > 0: Auto-fix (up to 2 rounds)

   ROUND 1:
   Log: { event: 'STUB_GATE_AUTOFIX_START', module, round: 1, actionableStubs: [...] }

   For each actionable stub:
     - STUB-EMPTY: implement exports per spec
     - STUB-DEP: replace with real imports from upstream module
     - STUB-STAGE: register real handler instead of createStubStage()
     - STUB-TEST: update fixtures with real types

     Write scope: RESTRICTED to files in current module's impl spec S2 File Map.
     Upstream module files may be READ for type resolution but MUST NOT be modified.
     If a fix requires upstream changes: record as BLOCKED with note.

     Run tests + type-check to verify each fix.
     If tests/types fail: revert fix, record as "auto-fix failed", continue (max 3 revert attempts per stub).

     Log: { event: 'STUB_AUTOFIX', stubId, category, file, action, verified: true|false }

   Log: { event: 'STUB_GATE_AUTOFIX_COMPLETE', module, round: 1, fixed, remaining }

   ROUND 2:
   Re-run: /verify-implementation [PLAN_PATH] --stubs --force
   Re-count ACTIONABLE_STUBS.

   Log: { event: 'STUB_GATE_RESCAN_RESULT', module, actionable, blocked, mvp, total }

   If ACTIONABLE_STUBS == 0:
     STUB_GATE = PASSED
   Else:
     Log: { event: 'STUB_GATE_AUTOFIX_START', module, round: 2, actionableStubs: [...] }
     Repeat auto-fix for remaining actionable stubs.
     Re-run stub scan.
     If ACTIONABLE_STUBS == 0: STUB_GATE = PASSED
     Else: STUB_GATE = FAILED

5. Log final result:
   Log: { event: 'STUB_GATE_RESULT', module, result: STUB_GATE, actionable: ACTIONABLE_STUBS, blocked: BLOCKED_STUBS, mvp: MVP_STUBS }
```

**Note**: Blocked stubs (upstream not COMPLETE per truth table) do NOT fail the per-module gate. They are tracked for resolution at the complete-implementation gate (implement-batch Step 3c).

---

### 10. Mark Verification Status

**Tri-state**: COMPLETE (verify PASS + stub gate PASS), VERIFICATION_FAILED (verify FAIL), STUB_GATE_FAILED (verify PASS, stub gate FAIL).

**On VERIFICATION PASSED + STUB GATE PASSED:**
```markdown
## Verification Status
**Result**: ✅ PASSED | **Iterations**: X/5 | **Final**: 1 clean run
**Gaps Fixed**: Y total across iterations
**Stub Gate**: ✅ PASSED | Actionable: 0 | Blocked: N | MVP: M
```
- Update plan status to `✅ Complete`
- Update `context/implementation-status.md`: `✅ COMPLETE`, Stub Gate: `PASSED`

**On VERIFICATION FAILED (5 iterations exhausted):**
```markdown
## Verification Status
**Result**: ❌ FAILED | **Iterations**: 5/5 | **Remaining Gaps**: X
**Critical**: [list] | **High**: [list] | **Medium**: [list]
**Stub Gate**: SKIPPED (verify-loop failed)
**Action Required**: Manual review needed
```
- Update plan status to `❌ Verification Failed`
- Update `context/implementation-status.md`: `❌ VERIFICATION FAILED`, Stub Gate: `PENDING`
- DO NOT mark as complete
- List all remaining unfixed gaps in final report

**On VERIFICATION PASSED + STUB GATE FAILED:**
```markdown
## Verification Status
**Result**: ⚠️ STUB GATE FAILED | **Verify-Loop**: ✅ PASSED (X/5 iterations)
**Stub Gate**: ❌ FAILED | Actionable: Y remain | Blocked: N | MVP: M
**Blocked stubs**: N blocked stubs will become actionable at complete-impl gate
**Action Required**: Fix actionable stubs or run with --skip-stub-gate
```
- Update plan status to `⚠️ Stub Gate Failed`
- Update `context/implementation-status.md`: `⚠️ STUB_GATE_FAILED`, Stub Gate: `FAILED`
- DO NOT mark as complete
- List all actionable stubs with gap IDs in final report

### 11. CONTEXT-SYNC
1. **Plan file**: Mark complete, add final summary (includes stub gate result)
2. **Status file** (`context/implementation-status.md`): Create/update module row with `Stub Gate` column (`PASSED` / `FAILED` / `PENDING`)
3. **Blueprint registry** (`context/blueprints/blprnt-registry.md`) — if blueprint system detected:
   - **YAML frontmatter**: Increment `modules_complete`, update `last_updated`, update `status` (if all modules done → `complete`), update `current_phase`
   - **Module Status Table**: Upsert row for this module — set Status=`COMPLETE`, Gate=`Gate N PASS`, Tests=count from test run, Coverage=% from coverage run, Impl Files=created/expected, Deviations=count, Last Updated=today
   - **Overall Status table**: Update Modules Complete count, Regression Suite test count
   - **Stage Gate Status**: If this module completes a gate, update all gate checks to PASS with command used and today's date
   - **Implementation Progress**: Update Created Files count for this module to match Expected
   - **Contract Compliance Matrix**: For contracts this module produces, set Impl Status=`COMPLETE`, Integration Verified=`Yes`
   - **Regression History**: Add row — Run #, today's date, trigger (e.g., "M6 complete"), Modules Tested, Result (PASS/FAIL with test count), Failures count
   - **Deviation Log**: Already updated per-phase in Phase 7; verify entries are present, no action needed here
4. **Architecture document** (MANDATORY — `docs/architecture/` or project-equivalent):
   - Identify which sections of the architecture document are affected by the implementation changes
   - Update affected sections with new/changed: pipeline stages, configuration parameters, data structures, event types, error codes, API contracts, feature flags, formulas, thresholds
   - If new sections are needed (new subsystem, new pipeline stage), add them in the appropriate Part
   - Update Appendix tables (config reference, security guards, data structures) if parameters were added/changed
   - Update Mermaid diagrams if control flow changed
   - If section numbers shifted, update cross-references
   - **Skip if**: implementation is purely cosmetic (UI styling, test-only changes, doc fixes)
5. **MEMORY.md**: Add reusable patterns (max 3 lines, dedup, skip if >180 lines)

### 12. Final Report

**On VERIFICATION PASSED:**
```
IMPLEMENTATION COMPLETE ✅
PLAN: [name] | DURATION: [time] | BRANCH: [branch]
VERIFICATION: ✅ PASSED (X iterations, 1 clean run)
Phases: X/X (100%) | Commits: abc1234 → def5678 → ghi9012 | Tests: [pass/fail] | Coverage: X%
Gaps fixed: Y during verification
```

**On VERIFICATION FAILED:**
```
IMPLEMENTATION INCOMPLETE ❌
PLAN: [name] | DURATION: [time] | BRANCH: [branch]
VERIFICATION: ❌ FAILED (5 iterations exhausted) | STUB GATE: SKIPPED
Phases: X/X | Tests: [pass/fail]

REMAINING GAPS:
  CRITICAL: [list with IDs and descriptions]
  HIGH: [list with IDs and descriptions]
  MEDIUM: [list with IDs and descriptions]

ACTION REQUIRED: Manual review — DO NOT MERGE
```

**On STUB GATE FAILED (verify passed, stub gate failed):**
```
IMPLEMENTATION INCOMPLETE — STUB GATE FAILED ⚠️
PLAN: [name] | DURATION: [time] | BRANCH: [branch]
VERIFICATION: ✅ PASSED (X iterations, 1 clean run)
STUB GATE: ❌ FAILED | Actionable: Y | Blocked: N | MVP: M
Phases: X/X (100%) | Tests: [pass/fail]

ACTIONABLE STUBS (must fix):
  [STUB-ID] [category] [file:line] — [description]

BLOCKED STUBS (tracked, N will become actionable at complete-impl gate):
  [STUB-ID] [category] [file:line] — Blocked by M[N] ([status])

MVP STUBS (intentional, tracked only):
  [STUB-ID] [file:line] — [OUT-NN description]

ACTION REQUIRED: Fix actionable stubs or run with --skip-stub-gate
```

---

## Critical Rules

### Must Do
- [ ] NEVER ask permission — execute autonomously
- [ ] Mark items complete IN THE PLAN FILE immediately after each
- [ ] Capture commit SHA on every item
- [ ] Run tests after EVERY phase
- [ ] Fix test failures before proceeding
- [ ] **EXECUTE VERIFY-LOOP COMPLETELY** — Run `/verify-implementation [PLAN_PATH] --force` in a loop until:
  - ✅ **PASS**: 2 consecutive runs with zero Critical/High/Medium gaps, OR
  - ❌ **FAIL**: 5 iterations exhausted (mark plan as "Verification Failed")
- [ ] **EXECUTE STUB GATE after VERIFY-LOOP** — Run `/verify-implementation [PLAN_PATH] --stubs --force` and auto-fix actionable stubs (up to 2 rounds)
- [ ] **Module NOT complete unless verify PASS AND stub gate PASS** (or `--skip-stub-gate`)
- [ ] Pass the **current plan file path** explicitly to verify-implementation (not just `--force`)
- [ ] Update context files (plan, status, MEMORY.md)
- [ ] Update blueprint registry (if blueprint mode) with module status, gate, tests, coverage, impl files

### Never Do
- [ ] **Skip verification loop** — This is the #1 violation. The loop MUST run.
- [ ] **Abbreviate verification loop** — All iterations must execute until exit condition met
- [ ] **Pause during verify-loop** — Do NOT stop to ask "should I continue?" or report intermediate status
- [ ] **Mark module COMPLETE if stub gate failed** — use STUB_GATE_FAILED status instead
- [ ] Report done with pending TodoWrite items
- [ ] Leave test failures unresolved
- [ ] Mark plan as complete if verification failed
- [ ] Modify CLAUDE.md (use /optimize-context)

---

## Error Handling

| Error | Response |
|-------|----------|
| Tests fail | Fix immediately, max 3 attempts, then note as known issue |
| Build fails | Fix TypeScript/import errors before proceeding |
| Git conflict | Resolve, continue |
| External dep unavailable | Note, use mock/stub, continue |
| Phase blocked | Mark blocked, continue with independent phases |
| Verification gaps (iteration 1-4) | Fix in-place, commit, continue to next iteration |
| Verification fails (5 iterations) | Mark plan as "Verification Failed", list remaining gaps, DO NOT mark complete |
| Same gap persists 3+ iterations | Flag as "resistant gap", document in final report, may indicate architectural issue |
| Stub gate fails (actionable stubs) | Auto-fix 2 rounds, re-scan. If still failing, mark STUB_GATE_FAILED |
| Auto-fix breaks tests/types | Revert fix, record stub as "auto-fix failed", continue to next stub |
| Blocked stubs remain | Acceptable at per-module level; tracked for batch resolution at complete-impl gate |

---

## Blueprint Mode Specifics

### Pre-Flight (from §12)
| Check | Action |
|-------|--------|
| Dependency status | Verify upstream modules complete |
| Interface verification | Run import checks |
| Contract verification | Verify LOCKED contracts unchanged |
| Build chain | Run build commands |

ALL must pass → PROCEED / BLOCK

### Session Guide (from §13)
1. LOAD: Module + impl spec + contracts + master S7
2. PRE-FLIGHT: Run §12 checks
3. IMPLEMENT: Follow impl spec task order
4. VERIFY: Run §7A-7E
5. UPDATE: Registry, commit

---

## Final Check

Before reporting "done":
1. **VERIFY-LOOP executed?** — Must have run (check iteration count)
2. **VERIFY-LOOP result?** — PASS (1 clean run) or FAIL (5 iterations)
2b. **STUB GATE result?** — PASS or FAIL or SKIPPED
3. ALL TodoWrite items `completed`?
4. CONTEXT-SYNC `completed`?
4b. **Registry current?** (blueprint mode) — YAML `modules_complete` accurate? Module Status Table row shows COMPLETE with gate, tests, coverage? Overall Status counts match? Implementation Progress at 100%? Contract Compliance marked COMPLETE?
5. Any `pending`/`in_progress` → go back and execute
6. If VERIFICATION FAILED → report as incomplete, DO NOT claim success
7. If STUB GATE FAILED → report as incomplete (STUB_GATE_FAILED), DO NOT claim success

---

## Usage Examples

```bash
/implement-plan                                      # Most recent plan
/implement-plan ~/.claude/plans/feature.md           # Specific plan
/implement-plan context/blueprints/blprnt-M1.md      # Blueprint
/implement-plan "Phase 3"                            # Resume from phase
```

## Workflow Integration

```
/plan → /analyze-plan → /blueprint → /design-ui → /implement-plan (this) → /verify-implementation → /commit
```

Blueprint mode: Load manifest → pre-flight → implement → verify playbook → update registry → commit
