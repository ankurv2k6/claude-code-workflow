# Implement Batch

Execute multiple modules from blueprints autonomously with context-aware execution, respecting dependencies and enabling resumption.

## Arguments
- `$ARGUMENTS` - Optional: blueprint name, module ID (e.g., `M5`), or flags
  - **Security**: Blueprint paths validated with same path traversal checks as Phase 0 Step 2
- `--resume` - Resume from `context/batch-progress.md`
- `--dry-run` - Parse and display execution plan without implementing
- `--skip-verification` - Skip post-module verification AND stub gates (faster but riskier)
- `--skip-stub-gate` - Skip per-module stub gates AND complete-impl stub gate. **Not recommended.** Stub gates still run but results are advisory only (do not block BATCH PASS).
- `--from M<N>` - Start from specific module
- `--to M<N>` - Stop after specific module
- `--sequential` - Disable parallelism (one module at a time)
- `--timeout=<minutes>` - Per-module timeout in minutes (default: 30). Use lower values for simpler modules.

Execute automatically without permission. Use TodoWrite throughout.

---

## ⚠️ HIGH-PRIORITY: Autonomous Decision Protocol

> **CRITICAL INSTRUCTION**: When any decision point arises during implementation—whether about architecture, implementation approach, library choice, error handling strategy, or any ambiguous requirement—you MUST:
>
> 1. **Perform exhaustive analysis** of all viable options (minimum 2-3 alternatives)
> 2. **Evaluate each option** against: alignment with blueprint, code quality, maintainability, performance, and existing patterns
> 3. **Select and proceed with the best recommended path** without pausing for user input
> 4. **Log the decision** with full rationale to the Decision Log
>
> **This is a blocking requirement.** Do NOT pause to ask the user. Do NOT defer decisions. The batch MUST continue autonomously. Every decision should be made using your best technical judgment based on exhaustive analysis, then immediately executed.
>
> **Decision Quality Bar:**
> - Analyze codebase patterns before deciding
> - Consider downstream module dependencies
> - Prefer consistency with existing code over theoretical "best practices"
> - When truly equal options exist, choose the simpler/more maintainable path

---

## Phase 0: Initialization

### 1. Detect Mode
```
if --resume flag:
  Read context/batch-progress.md
  Resume from last_completed_module + 1
  # Stub gate resume handling:
  For modules with STUB_GATE_FAILED: re-run stub gate only (not full implementation)
  For modules with PASSED on all gates: skip entirely
  For modules not yet reached: execute normally
else:
  Fresh start - find blprnt-master.md
```

### 2. Validate Blueprint
```
Validate blprnt-master.md:
  1. YAML frontmatter: required fields (blueprint, version, status)
     Max file size: 100KB | No symlinks
  2. Module ID validation: /^M(1[0-3]|[1-9])$/ + registry lookup
  3. Path traversal validation:
     - Resolve path against projectRoot
     - Reject if !startsWith(projectRoot)
     - Reject null bytes (\x00), traversal (..), URL-encoded (%2e, %2f)
  4. Structure validation: S5 Module Index, S6B Dependency Matrix, S6C Phase Timeline
  5. Log: { event: 'VALIDATION_COMPLETE', file, checks: 5, passed, failed }

If fails:
  Log: { event: 'VALIDATION_FAILED', file, errors: [...] }
  FATAL "Blueprint validation failed: {errors}"
```

### 3. Parse Blueprint Master
Read `context/blueprints/blprnt-master.md`:
- **S5 Module Index**: Module list with dependencies
- **S6B Dependency Matrix**: Which modules depend on which
- **S6C Phase Timeline**: Parallel modules per phase

### 4. Validate Module Specs
```
For each module in S5:
  Check exists: context/blueprints/blprnt-{module}.md
  Check exists: context/implementation/impl-{module}.md

If missing:
  WARN: "impl-M{N}-*.md not found"
  Try fuzzy match: impl-M{N}-*.md
  If still missing: Mark module BLOCKED(MISSING_SPEC)
```

### 5. Build Execution Graph
```
Parse S6C Phase Timeline → Convert to layers:
Layer 0: [M1, M7]     # No dependencies
Layer 1: [M2, M4]     # Depends on Layer 0
Layer 2: [M3, M5]     # Depends on Layer 1
...

Detect circular dependencies via topological sort
If cycle: FATAL "Circular dependency: {cycle path}"
```

### 6. Detect UI Assets
```
if design/wireframes/ exists:
  UI_ASSETS=true
  Map wireframes to modules (M8-M12)
```

### 6b. Configure UI Module Requirements

**If UI_ASSETS=true for any module, add UI-specific configuration:**

```
For each UI module (typically M8-M12):
  Set UI_VERIFICATION_REQUIRED=true
  Add to module config:
    - wireframe_path: design/wireframes/{Feature}/
    - mockup_path: design/mockups/{Feature}/
```

**Expand Task prompt for UI modules to include:**

```markdown
**UI MODULE REQUIREMENTS (BLOCKING)**:
This is a UI module. You MUST:

1. **Before implementing each component, READ**:
   - Mockup: design/mockups/{Feature}/{component}.html
   - Wireframe: design/wireframes/{Feature}/{component}.md

2. **Extract from mockup/wireframe**:
   - HTML element structure (exact hierarchy)
   - CSS property values (exact colors as hex, spacing in px/rem)
   - All states: default, loading, error, empty, success, disabled
   - Hover/focus/active interactions
   - Responsive breakpoints

3. **Implementation MUST match mockup EXACTLY**:
   - Same element hierarchy
   - Same CSS values (not approximations)
   - All states from wireframe implemented
   - No placeholder styling or text ("Coming soon", "TODO", "Lorem ipsum")
   - No hardcoded colors (use design tokens from mockup)

4. **Verification MUST include UI comparison**:
   - Element-by-element structure check
   - CSS property comparison
   - State coverage verification

5. **Module is NOT SUCCESS unless UI matches mockup**:
   - Structure match: ✅
   - Style match: ✅
   - State coverage: ✅
   - Zero UI placeholders: ✅

If mockup/wireframe not found: STOP and report `⚠️ Missing mockup for [component]`
```

**Add UI-specific status tracking in batch-progress.md:**

```markdown
## Module Status
| M-ID | Module | Status | Verify-Loop | UI Match | States | Placeholders | Commits |
|------|--------|--------|-------------|----------|--------|--------------|---------|
| M9 | ui-auth | ✅ SUCCESS | ✅ PASS | 100% | 4/4 | 0 | abc123 |
| M10 | ui-issues | ⚠️ VERIFY_FAILED | ❌ FAIL | 85% | 3/4 | 2 | def456 |
```

**UI Module Pass Criteria (in addition to standard criteria):**
- All mockup elements implemented
- CSS values exact match (colors, spacing, fonts)
- All wireframe states covered
- Zero UI placeholders detected
- UI-* gaps = 0 (no UI-STRUCT-*, UI-STYLE-*, UI-STATE-*, UI-PLACEHOLDER-*)

### 7. Generate Execution ID
```
EXECUTION_ID = uuid()
Log: { event: 'BATCH_START', executionId, modules, layers }
```

### 8. Initialize Progress Tracker
Create/update `context/batch-progress.md`:
```markdown
---
blueprint: {name}
execution_id: {uuid}
started: {timestamp}
status: in_progress
current_layer: 0
total_layers: {N}
last_completed_module: null
last_checkpoint: {timestamp}
context_compactions: 0
---

## Execution Plan
| Layer | Modules | Status | Compacted |
|-------|---------|--------|-----------|
| 0 | M1, M7 | ⏳ PENDING | No |
...

## Module Status
| M-ID | Module | Status | Verify-Loop | Stub Gate | Iterations | Gaps Fixed | Stubs (actionable/blocked/mvp) | Commits | Duration | Error |
|------|--------|--------|-------------|-----------|------------|------------|-------------------------------|---------|----------|-------|
| M1 | project-setup | ⏳ PENDING | - | - | - | - | - | - | - | - |
...

## Complete-Implementation Stub Gate
**Result**: NOT RUN | **Actionable**: - | **Blocked**: - | **MVP**: - | **Timestamp**: -

## Checkpoint Log
| Timestamp | Module | Action | Context % |
|-----------|--------|--------|-----------|

## Decision Log
| Timestamp | Module | Decision | Rationale |
|-----------|--------|----------|-----------|
```

### 9. Initialize TodoWrite
Add all layers as pending, first layer in_progress.

---

## Phase 1-N: Layer Implementation Loop

See `_shared-autonomous.md`. Scope: the ENTIRE batch. Only stop for FATAL errors or when all layers complete.

### For Each Layer:

#### 1. Context Compact (Pre-Layer)
Run `/compact`. Re-read `context/batch-progress.md` to restore `current_layer`, module statuses, and `EXECUTION_ID`; continue.
```
Log: { event: 'CONTEXT_COMPACT', layer: currentLayer }
Update progress: context_compactions++
```

#### 2. Check Dependencies
```
For each module in layer:
  If any dependency BLOCKED → mark module BLOCKED
  If any dependency PENDING → wait (shouldn't happen)
```

#### 3. Filter Ready Modules
```
ready_modules = [m for m in layer if all_deps_complete(m)]
blocked_modules = [m for m in layer if any_dep_blocked(m)]

For blocked:
  Update status: ⛔ BLOCKED(M-ID)
  Log: { event: 'MODULE_BLOCKED', moduleId, blockedBy, layer }
```

#### 4. Launch Implementations (Max 2 Parallel)

> ⚠️ **CORE WORKFLOW — NON-NEGOTIABLE**: Each module MUST follow the exact `/implement-plan` workflow:
> 1. **Implement** all phases in the blueprint
> 2. **Commit** after each phase with conventional commit format
> 3. **Run VERIFY-LOOP** (MANDATORY): Max 5 iterations, 1 clean run = ✅ PASS, 5 iterations exhausted = ❌ FAIL
>
> This verify-loop is inherited from `/implement-plan` and CANNOT be skipped. A module is only SUCCESS if verification PASSED.

```
# Handle intra-layer dependencies
sorted_modules = topological_sort_within_layer(ready_modules, dependency_matrix)
chunks = chunk_respecting_dependencies(sorted_modules, size=2)

For each chunk:
  if has_internal_dependencies(chunk):
    Log: { event: 'CHUNK_SEQUENTIAL', reason: 'intra-chunk dependencies', modules: chunk }
    # Run sequentially within chunk
    for module in dependency_order(chunk):
      Log: { event: 'MODULE_START', moduleId: module, executionId: EXECUTION_ID, layer: currentLayer }
      invoke_implement_plan(module)  # Uses Skill tool
  else:
    # Safe to run in parallel (max 2)
    For each module in chunk:
      Log: { event: 'MODULE_START', moduleId: module, executionId: EXECUTION_ID, layer: currentLayer }

    Launch Task agents with:
      subagent_type: "general-purpose"
      prompt: |
        **EXECUTE /implement-plan FOR MODULE M{N}**

        You MUST use the Skill tool to invoke /implement-plan:
        ```
        Skill: implement-plan
        Args: context/blueprints/blprnt-M{N}-{name}.md
        ```

        EXECUTION CONTEXT:
        - Execution ID: {EXECUTION_ID}
        - Blueprint: context/blueprints/blprnt-M{N}-{name}.md
        - Impl spec: context/implementation/impl-M{N}-{name}.md
        - Contracts: context/implementation/impl-contracts.md
        - UI assets: design/wireframes/{Feature}/ (if applicable)

        **CRITICAL — VERIFY-LOOP IS MANDATORY**:
        The /implement-plan command includes a mandatory verify-loop that MUST complete:
        - MAX 5 ITERATIONS of /verify-implementation [PLAN_PATH] --force
        - ✅ PASS: 1 clean run with zero Critical/High/Medium gaps
        - ❌ FAIL: 5 iterations exhausted without achieving 1 clean run
        - DO NOT SKIP OR ABBREVIATE — run the full loop
        - The module is NOT complete until verify-loop terminates with PASS or FAIL

        **BATCH PASS DEPENDS ON YOUR MODULE**:
        - The ENTIRE BATCH only passes if ALL modules pass their verify-loop
        - Your module MUST achieve ✅ PASS for the batch to succeed
        - VERIFICATION_FAILED means the batch will FAIL

        **DECISION PROTOCOL (HIGH PRIORITY)**: When ANY decision is needed:
          1. Exhaustively analyze all viable options (2-3 minimum)
          2. Evaluate against: blueprint alignment, code quality, existing patterns
          3. SELECT AND PROCEED with best recommended path - DO NOT pause or ask
          4. Log decision + rationale to Decision Log

        Never defer decisions - use best technical judgment and continue.

        WORKFLOW SUMMARY:
        1. Invoke /implement-plan via Skill tool → implements all phases + commits
        2. /implement-plan runs verify-loop automatically → PASS or FAIL
        3. Report results with verification status

        RETURN FORMAT:
        {
          status: "SUCCESS" | "FAILED" | "VERIFICATION_FAILED" | "STUB_GATE_FAILED",
          module_id: "M{N}",
          verification: {
            result: "PASS" | "FAIL",
            iterations: number,
            consecutive_clean_runs: number,
            remaining_gaps: { critical: number, high: number, medium: number }
          },
          stub_gate: {
            result: "PASSED" | "FAILED" | "SKIPPED",
            actionable: number,
            blocked: number,
            mvp: number,
            actionable_stubs: [{ stubId, category, file, description }]
          },
          commit_shas: ["abc123", ...],
          tests_passed: number,
          coverage_percent: number,
          duration_ms: number,
          error: string | null,
          decisions_made: [{decision, rationale}]
        }

        STATUS DEFINITIONS:
        - SUCCESS: All phases implemented + verification PASSED + stub gate PASSED
        - VERIFICATION_FAILED: All phases implemented but verification FAILED (5 iterations exhausted)
        - STUB_GATE_FAILED: Verification PASSED but stub gate FAILED (actionable stubs remain)
        - FAILED: Implementation error (not verification-related)

      timeout: 1800000  # 30 minutes per module (configurable via --timeout)
      run_in_background: true
      max_turns: 100    # Prevents infinite loops

  # Collect results with timeout handling
  For each agent in chunk:
    Use TaskOutput with:
      block: true
      timeout: MODULE_TIMEOUT  # Default 1800000ms (30 min)

    If timeout reached:
      Use TaskOutput with block: false to get partial results
      Log: { event: 'MODULE_TIMEOUT', moduleId, partialProgress }
      Mark module as TIMEOUT with partial data
```

#### 4a. Timeout & Graceful Degradation

See `_shared-agent-timeout.md`. Command-specific settings:
- **MODULE_TIMEOUT**: 1800000ms (30 min per module, configurable via `--timeout`)
- Mark timed-out modules as `⏱️ TIMEOUT` (not FAILED)
- Log which phases completed before timeout; record partial commits
- **Recovery**: Resume with `/implement-plan M{N}` manually
- Dependent modules flagged with `DEPENDS_ON_TIMEOUT(M{N})` but NOT blocked (partial implementation exists)

**IMPORTANT**: Module timeout ≠ module failure. Timeouts preserve partial progress and allow manual completion.

#### 5. Collect Results and Checkpoint
```
For each completed module:
  # Log with verification + stub gate details
  Log: {
    event: 'MODULE_COMPLETE',
    moduleId,
    status,  # SUCCESS | VERIFICATION_FAILED | STUB_GATE_FAILED | FAILED
    verification: {
      result: result.verification.result,  # PASS | FAIL
      iterations: result.verification.iterations,
      consecutiveCleanRuns: result.verification.consecutive_clean_runs,
      remainingGaps: result.verification.remaining_gaps
    },
    stubGate: {
      result: result.stub_gate.result,  # PASSED | FAILED | SKIPPED
      actionable: result.stub_gate.actionable,
      blocked: result.stub_gate.blocked,
      mvp: result.stub_gate.mvp,
      actionableStubIds: result.stub_gate.actionable_stubs.map(s => s.stubId)
    },
    durationMs,
    commitShas: result.commit_shas
  }

  Update context/batch-progress.md:
    - last_completed_module: module_id
    - last_checkpoint: now()
    - Module row: include verification result (PASS/FAIL + iteration count)

  For each decision in result.decisions_made:
    Log: { event: 'DECISION_MADE', moduleId, executionId: EXECUTION_ID, decision, rationale, timestamp }
  Record autonomous decisions to Decision Log
```

#### 6. Handle Failures and Verification Results
```
# Handle VERIFICATION_FAILED modules (implemented but verification failed)
For each VERIFICATION_FAILED module:
  Log: {
    event: 'MODULE_VERIFICATION_FAILED',
    moduleId,
    iterations: 5,
    remainingGaps: result.verification.remaining_gaps
  }

  # VERIFICATION_FAILED is NOT retried - the implementation completed
  # Mark as ⚠️ VERIFICATION_FAILED (different from ⛔ FAILED)
  Mark as ⚠️ VERIFICATION_FAILED
  Update progress: verification_failed_count++

  # Downstream modules CAN proceed (implementation exists)
  # But flag them for extra scrutiny
  For each dependent:
    Add flag: DEPENDS_ON_UNVERIFIED(module)
    Log: { event: 'DEPENDENT_FLAGGED', dependentModule, unverifiedUpstream: module }

# Handle STUB_GATE_FAILED modules (verification passed but stub gate failed)
For each STUB_GATE_FAILED module:
  Log: {
    event: 'MODULE_STUB_GATE_FAILED',
    moduleId,
    actionableStubs: result.stub_gate.actionable,
    blockedStubs: result.stub_gate.blocked,
    mvpStubs: result.stub_gate.mvp,
    actionableStubIds: result.stub_gate.actionable_stubs.map(s => s.stubId)
  }

  # STUB_GATE_FAILED is NOT retried - verification passed, stubs remain
  Mark as ⚠️ STUB_GATE_FAILED
  Update progress: stub_gate_failed_count++

  # Downstream modules CAN proceed (implementation + verification passed)
  For each dependent:
    Add flag: DEPENDS_ON_STUB_INCOMPLETE(module)

# Handle FAILED modules (implementation error)
For each FAILED module:
  Log: { event: 'MODULE_FAILED', moduleId, error, attemptNumber }

  If retries < 3:
    Log: { event: 'RETRY_SCHEDULED', moduleId, attemptNumber }
    Increment retry counter, re-queue
  Else:
    Mark as ⛔ FAILED
    Log: { event: 'RETRY_EXHAUSTED', moduleId }
    # Cascade impact - FAILED blocks downstream
    For each dependent:
      Mark as ⛔ BLOCKED(module)
      Log: { event: 'CASCADE_BLOCK', blockedModule, cause }
```

#### 7. Run Gate Checks
```
Read blprnt-registry.md Stage Gate for current layer
For each gate_check:
  # Use array-based command execution (no shell injection)
  command_parts = parse_command_safely(gate_check.command)

  # Validate command is allowlisted
  allowed_commands = ['npm', 'npx', 'node', 'tsc', 'eslint', 'vitest', 'zcli']
  if command_parts[0] not in allowed_commands: continue

  result = spawn_command(command_parts, { shell: false, timeout: 60000 })

  Log: { event: 'GATE_CHECK', gateId, check, result, durationMs,
         stdout: truncate(500), stderr: truncate(500) }

If critical gate fails:
  Log: { event: 'GATE_CRITICAL_FAIL', gateId }
```

#### 8. Update Registry
```
# Orchestrator updates registry (prevents conflicts)
For each completed module:
  Update blprnt-registry.md:
    - Module status
    - Test count, coverage
    - Commit SHA
    - Last updated timestamp
```

#### 9. Continue to Next Layer
```
If more layers:
  - DO NOT pause to report layer completion
  - DO NOT ask user to confirm next layer
  - IMMEDIATELY continue to step 1 of next layer (which starts with Context Compact)
Else:
  - proceed to Final Phase
```

---

## Final Phase: Completion

> **BATCH PASS CRITERIA — NON-NEGOTIABLE**:
> The batch is ONLY considered ✅ **BATCH PASS** if:
> 1. **Every module** was implemented via `/implement-plan`
> 2. **Every module** completed its verify-loop with ✅ PASS (1 clean run)
> 3. Cross-module integration verification passes
>
> If **ANY module** has ❌ VERIFICATION_FAILED (5 iterations exhausted), the batch is ❌ **BATCH FAIL**.
> BLOCKED and FAILED modules also result in ❌ **BATCH FAIL**.

> **NOTE**: Each module has ALREADY completed its verify-loop via `/implement-plan`. This final phase performs a batch-level cross-module integration check.

### 1. Context Compact (Pre-Final-Phase)
Run `/compact`. Re-read `context/batch-progress.md` to restore `EXECUTION_ID`, module statuses, and layer results; continue.
```
Log: { event: 'CONTEXT_COMPACT', phase: 'final', context_compactions: ++N }
```

### 2. Cross-Module Integration Verification
```
# This is a SUPPLEMENTAL check for cross-module integration issues
# Per-module verification already completed via /implement-plan verify-loop

Invoke: /verify-implementation --all --force
(Skips BLOCKED and FAILED modules)

Focus areas:
- Cross-module interface compatibility
- Shared contract adherence
- Integration test coverage
- End-to-end workflow validation
```

### 3. Fix Integration Gaps
```
Auto-fix gaps discovered by cross-module verification
Commit: fix(batch): address cross-module integration gaps [GAP-*]
```

### 3b. Cross-Module Stub Resolution
```
After all modules in the batch are implemented, resolve STUB-DEP gaps
where the upstream module was implemented during this same batch run.

1. Read context/implementation-status.md and blprnt-registry.md Stub Tracking section
2. For each blocked stub (STUB-DEP with blockedBy set):
   - Check if blockedBy module is now COMPLETE
   - If YES: Upgrade severity LOW → HIGH, add to remediation queue
   - Find real type/interface in the upstream module's source
   - Replace placeholder (unknown type, stub interface) with real import
3. For each STUB-STAGE gap where module is now COMPLETE:
   - Replace createStubStage() with real handler import and registration
4. Run type-check + tests to verify all replacements
5. Commit: fix(batch): resolve cross-module stub dependencies [STUB-DEP-*, STUB-STAGE-*]
6. Update registry Stub Tracking table — remove resolved blocked entries

Log: {
  event: 'CROSS_MODULE_STUB_RESOLUTION',
  resolved: number,
  remaining_blocked: number,
  stubs_by_type: { STUB_DEP: n, STUB_STAGE: n }
}
```

### 3b-compact. Context Compact (Post-Stub-Resolution)
Run `/compact`. Re-read `context/batch-progress.md` to restore module stub statuses and `EXECUTION_ID`; continue to Step 3c.

### 3c. Complete-Implementation Stub Verification Gate

**Skip if `--skip-verification` or `--skip-stub-gate`.**

```
1. Invoke: /verify-implementation --stubs --all --force

2. Blocked-to-actionable reclassification:
   For each blocked stub (STUB-DEP with blockedBy set):
     Check upstream module status:
       - If COMPLETE → reclassify as actionable (must fix)
       - If VERIFICATION_FAILED, STUB_GATE_FAILED, TIMEOUT, FAILED, BLOCKED → stays blocked (not actionable)
   This prevents spurious auto-fix attempts on stubs whose upstream never completed.

3. Count results:
   ACTIONABLE_STUBS = reclassified actionable + originally actionable
   BLOCKED_STUBS = remaining blocked
   MVP_STUBS = STUB-MVP count (INFO, acceptable)

4. If ACTIONABLE_STUBS == 0:
   COMPLETE_STUB_GATE = PASSED

5. If ACTIONABLE_STUBS > 0:
   Auto-fix one round (cross-module scope — can read/write across all module files)
   Re-run: /verify-implementation --stubs --all --force
   Re-count.
   If ACTIONABLE_STUBS == 0: COMPLETE_STUB_GATE = PASSED
   Else: COMPLETE_STUB_GATE = FAILED

6. Write result to context/batch-progress.md ## Complete-Implementation Stub Gate section

7. Log:
   Log: {
     event: 'COMPLETE_IMPL_STUB_GATE',
     result: COMPLETE_STUB_GATE,
     actionable: ACTIONABLE_STUBS,
     blocked: BLOCKED_STUBS,
     mvp: MVP_STUBS,
     autoFixAttempted: boolean,
     autoFixResolved: number,
     remainingActionable: [{ stubId, file, description }]
   }
```

### 4. Full Regression Test
```
npm run typecheck
npm run lint
npm run test
npm run build

Log: { event: 'REGRESSION_COMPLETE', typecheck, lint, tests, coverage, build }
```

### 5. Determine Batch Result
```
# Calculate batch result based on ALL module verification + stub gate statuses
verified_modules = [m for m in modules if m.status == SUCCESS and m.verify_loop == PASS]
failed_verification = [m for m in modules if m.status == VERIFICATION_FAILED]
stub_gate_failed = [m for m in modules if m.status == STUB_GATE_FAILED]
failed_impl = [m for m in modules if m.status == FAILED]
blocked = [m for m in modules if m.status == BLOCKED]

If (len(verified_modules) == total_modules
    AND len(failed_verification) == 0
    AND len(stub_gate_failed) == 0
    AND len(failed_impl) == 0
    AND len(blocked) == 0
    AND COMPLETE_STUB_GATE == PASSED):
    BATCH_RESULT = "✅ BATCH PASS"
    batch_status = "All modules implemented, verified, and stub gates passed"
Else:
    BATCH_RESULT = "❌ BATCH FAIL"
    batch_status = "One or more modules failed verification, stub gate, or implementation"
```

### 6. Generate Summary Report
```
============================================
        BATCH RESULT: {BATCH_RESULT}
============================================
(Batch only passes if ALL modules pass /implement-plan + verify-loop)

EXECUTION ID: {execution_id}
BLUEPRINT: {name} | DURATION: {time} | COMPACTIONS: {count}
BRANCH: {branch}

MODULE VERIFICATION RESULTS:
| M-ID | Module | /implement-plan | Verify-Loop | Stub Gate | Iterations | Gaps Fixed | Stubs (actionable/blocked/mvp) |
|------|--------|-----------------|-------------|-----------|------------|------------|-------------------------------|
| M1 | project-setup | ✅ EXECUTED | ✅ PASS | ✅ PASSED | 2/5 | 3 | 0 |
| M2 | core-types | ✅ EXECUTED | ✅ PASS | ✅ PASSED | 3/5 | 5 | 0/0/1 |
| M3 | database | ✅ EXECUTED | ❌ FAIL | SKIPPED | 5/5 | 8 (2 remain) | 0/2/0 |
| M4 | api-layer | ⛔ BLOCKED | - | - | - | - | - |
...

BATCH PASS CRITERIA CHECK:
| Criterion | Required | Actual | Status |
|-----------|----------|--------|--------|
| All modules executed via /implement-plan | {total} | {executed} | {✅/❌} |
| All modules verify-loop PASS | {total} | {passed} | {✅/❌} |
| All modules stub gate PASS | {total} | {stub_passed} | {✅/❌} |
| Complete-impl stub gate PASS | PASSED | {result} | {✅/❌} |
| Zero VERIFICATION_FAILED | 0 | {count} | {✅/❌} |
| Zero STUB_GATE_FAILED | 0 | {count} | {✅/❌} |
| Zero FAILED | 0 | {count} | {✅/❌} |
| Zero BLOCKED | 0 | {count} | {✅/❌} |

COMPLETE-IMPLEMENTATION STUB GATE: {PASSED / FAILED / NOT RUN}
  Actionable: {count} | Blocked: {count} | MVP: {count}
  {If reclassified:} N blocked stubs reclassified as actionable at complete-impl gate

SUMMARY:
| Status | Count | Modules |
|--------|-------|---------|
| ✅ SUCCESS (verify + stub gate PASS) | X | M1, M2, ... |
| ⚠️ VERIFICATION_FAILED | Y | M3, ... (implemented but verify failed) |
| ⚠️ STUB_GATE_FAILED | S | M5, ... (verified but stub gate failed) |
| ⏱️ TIMEOUT | T | M6, ... (partial progress, resumable) |
| ⛔ BLOCKED | Z | M4 (by M3), ... |
| ❌ FAILED | W | - |

TIMEOUT DETAILS (if any):
| M-ID | Phases Completed | Last Phase | Partial Commits | Recovery |
| M5 | 2/4 | Phase 3 | abc123 | /implement-plan M5 |

VERIFICATION STATISTICS:
- Modules with PASS verification: X/{total}
- Modules with FAIL verification: Y/{total} (require manual review)
- Total verify-loop iterations: {sum across modules}
- Gaps fixed during verify-loops: {total}

LAYERS: {complete}/{total}
COMMITS: {count} ({list})
TESTS: {pass}/{total} | COVERAGE: {percent}%
CONTEXT COMPACTIONS: {count}

CROSS-MODULE INTEGRATION GAPS FIXED: {count}
CROSS-MODULE STUBS RESOLVED: {count} (STUB-DEP-* and STUB-STAGE-* resolved in Step 3b)
REMAINING BLOCKED STUBS: {count} (awaiting future modules)
INTENTIONAL STUBS (MVP): {count} (tracked, not remediated)
AUTONOMOUS DECISIONS: {count} (see Decision Log)

REGISTRY: Updated
PROGRESS FILE: context/batch-progress.md

## NEXT STEPS (based on BATCH_RESULT):

### If ✅ BATCH PASS:
1. git push -u origin {branch}
2. gh pr create
3. Review autonomous decisions in Decision Log

### If ❌ BATCH FAIL:
1. ⚠️ FIX VERIFICATION_FAILED modules: Run /implement-plan {module} manually
2. ⚠️ FIX STUB_GATE_FAILED modules: Run /verify-implementation {module} --stubs --force
3. FIX FAILED modules: Check error logs, run /implement-plan {module}
4. UNBLOCK modules: Fix upstream dependencies first
5. RE-RUN: /implement-batch --resume (or --from M{N})
6. DO NOT create PR until BATCH PASS achieved
```

### 7. Update Context Files
```
1. context/batch-progress.md → status: completed | batch_result: PASS/FAIL
2. blprnt-registry.md → final module statuses + verification results
3. context/implementation-status.md → all module rows with verify-loop status
4. MEMORY.md → key patterns (max 5 lines)
```

### 8. Final Log Entry
```
Log: {
  event: 'BATCH_COMPLETE',
  executionId,
  batchResult: 'PASS' | 'FAIL',  # Based on ALL modules passing verify-loop + stub gate
  duration,
  modules: {
    total: number,
    verified: number,      # Passed /implement-plan + verify-loop + stub gate
    verificationFailed: number,
    stubGateFailed: number,
    implementationFailed: number,
    blocked: number
  },
  stubGate: {
    perModulePassed: number,
    perModuleFailed: number,
    completeImplResult: 'PASSED' | 'FAILED' | 'NOT_RUN',
    totalActionable: number,
    totalBlocked: number,
    totalMvp: number
  },
  contextCompactions,
  autonomousDecisions
}
```

### 9. Mark TodoWrite Complete

---

## Error Handling

| Error | Code | Response |
|-------|------|----------|
| blprnt-master.md not found | BATCH_NO_BLUEPRINT | FATAL: "No blueprint found. Run /blueprint first." |
| Blueprint validation fails | BATCH_INVALID_BLUEPRINT | FATAL: "Blueprint validation failed: {errors}" |
| Impl spec not found | BATCH_MISSING_SPEC | WARN: Mark module BLOCKED(MISSING_SPEC), continue |
| Circular dependency | BATCH_CIRCULAR_DEP | FATAL: "Circular dependency: {cycle}" |
| Module implementation fails | BATCH_MODULE_FAILED | Retry up to 3x, then mark BLOCKED, cascade to dependents |
| Module verify-loop fails | BATCH_MODULE_VERIFY_FAILED | Mark ⚠️ VERIFICATION_FAILED, flag dependents, continue (no retry) |
| Task agent timeout | BATCH_AGENT_TIMEOUT | Mark ⏱️ TIMEOUT, capture partial progress, flag dependents, continue (recoverable) |
| Task agent crash | BATCH_AGENT_CRASH | Retry once, then mark FAILED |
| Gate check fails | BATCH_GATE_FAILED | Log warning, continue |
| Module stub gate fails | BATCH_MODULE_STUB_GATE_FAILED | Mark ⚠️ STUB_GATE_FAILED, flag dependents, continue (no retry) |
| Complete-impl stub gate fails | BATCH_COMPLETE_STUB_GATE_FAILED | Log remaining actionable stubs, mark batch as FAIL |
| Cross-module integration gaps | BATCH_INTEGRATION_GAPS | Auto-fix, commit, continue |
| All modules blocked | BATCH_ALL_BLOCKED | FATAL: "Cannot proceed - all blocked" |
| Context exhausted | BATCH_CONTEXT_FULL | Run /compact, retry |
| Session interrupted | BATCH_INTERRUPTED | Progress saved, resume with --resume |

### Error Definitions

```typescript
const BATCH_ERROR_DEFINITIONS = {
  // CRITICAL severity — non-recoverable, halts batch
  BATCH_NO_BLUEPRINT: {
    code: 'BATCH_NO_BLUEPRINT',
    severity: 'critical',
    userMessage: 'No blueprint found',
    cause: 'blprnt-master.md does not exist in context/blueprints/',
    fixSteps: ['Run /blueprint to generate blueprints'],
    recoverable: false
  },
  // HIGH severity — non-recoverable, but downstream continues (flagged)
  BATCH_MODULE_VERIFY_FAILED: {
    code: 'BATCH_MODULE_VERIFY_FAILED',
    severity: 'high',
    userMessage: 'Module verify-loop failed (5 iterations exhausted)',
    cause: 'Module implemented but verify-loop did not achieve 1 clean run',
    fixSteps: ['Review remaining gaps', 'Run /implement-plan M{N} manually', 'Check for architectural issues'],
    recoverable: false,
    allowDownstream: true  // Dependents can proceed but are flagged
  },
  // MEDIUM severity — recoverable, partial progress kept
  BATCH_AGENT_TIMEOUT: {
    code: 'BATCH_AGENT_TIMEOUT',
    severity: 'medium',
    userMessage: 'Task agent timed out',
    cause: 'Module exceeded configured timeout (default 30 minutes)',
    fixSteps: ['Check partial progress in context/batch-progress.md', 'Run /implement-plan M{N} manually', 'Use --timeout=60'],
    recoverable: true,
    partialProgressPreserved: true,
    blocksDownstream: false  // Dependents flagged but not blocked
  },
  // ... 10 more errors defined in Error Handling table above. Same structure: code, severity, userMessage, cause, fixSteps, recoverable.
};
```

---

## Usage Examples

```bash
# Full batch from blueprint (all modules)
/implement-batch

# Specific blueprint
/implement-batch context/blueprints/blprnt-master.md

# Resume after interruption
/implement-batch --resume

# Preview execution plan
/implement-batch --dry-run

# Implement specific range
/implement-batch --from M5 --to M8

# Start from specific module
/implement-batch --from M7

# Sequential execution (one at a time)
/implement-batch --sequential

# Skip per-module verify-loop (faster but NOT recommended)
# WARNING: Skips the mandatory verify-loop — modules may have undetected gaps
/implement-batch --skip-verification
```

---

## Workflow Integration

> **CORE PRINCIPLE**: `/implement-batch` orchestrates modules, but `/implement-plan` is the execution engine for each module. Every module follows the exact `/implement-plan` workflow: implement phases → commit → verify-loop (PASS/FAIL).

```
/plan → /analyze-plan → /blueprint → /design-ui → /implement-batch → /commit
                                                          │
                                                          │ For EACH module:
                                                          │   └── Invokes /implement-plan via Skill tool
                                                          │         ├── Implements all phases
                                                          │         ├── Commits after each phase
                                                          │         └── Runs verify-loop (5 iter max, 1 clean = PASS)
                                                          │
                                                          ├── Orchestrates modules in dependency order
                                                          ├── Max 2 parallel agents per chunk
                                                          ├── Context compaction between layers
                                                          ├── Module-level checkpoints for resume
                                                          ├── Auto-retries (3x) for FAILED, no retry for VERIFY_FAILED
                                                          ├── Logs autonomous decisions
                                                          ├── Per-module verify-loop + final cross-module check
                                                          └── Supports resume from any module
```

---

## Design Constraints

| Aspect | Constraint | Rationale |
|--------|------------|-----------|
| **Core Execution** | `/implement-plan` via Skill tool | Ensures consistent workflow per module |
| **Verify-Loop** | Mandatory per module (5 iter max, 1 clean = PASS) | Quality gate inherited from `/implement-plan` |
| Parallelism | Max 2 concurrent agents | Context budget (FEAS-2) |
| Context | Compact at >70% | Prevent exhaustion (FEAS-1) |
| Timeout | 30 min per module | Prevent runaway agents (SEC-8) |
| Retries | 3 per module (impl failures only) | Balance reliability vs time |
| Verify failures | No retry (mark VERIFICATION_FAILED) | Implementation completed, needs manual review |
| Checkpoints | Per module | Enable resume (RISK-2) |
| Registry | Orchestrator-only updates | Prevent conflicts (MISS-9) |
| Decisions | Exhaustive analysis → select best → proceed | Autonomous execution (HIGH PRIORITY) |
| Commands | Allowlist validation | Prevent injection (SEC-2R) |
| Paths | Traversal validation | Prevent escape (SEC-3R) |
| Stub Gate | Per-module + complete-impl, both must pass | Prevents stubs surviving to production |
| Stub Gate | Skipped if `--skip-verification` or `--skip-stub-gate` | Gate depends on verify-loop results |
