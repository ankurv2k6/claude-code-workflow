---
description: Exhaustively verify implementation against current plan, identify gaps, fix all discovered issues, and ensure logging/testing infrastructure is complete. Supports three-layer blueprint system.
---
# Verify Implementation Command

Verify implementation against the **current session's module** with gap analysis, logging/testing audit, and **automated remediation**. Detects module from session context (TodoWrite, recent commands) first, then falls back to status file. Use `--all` to verify all implemented modules. Supports standalone plans and three-layer blueprint system.

## Arguments
- `$ARGUMENTS` - Path to plan file, or keywords: `logging`, `testing`, `gaps`, `stubs`
- `--force` - Force thorough verification even if module/plan is marked as completed in tracking documents
- `--all` - Verify ALL implemented modules (scans `context/implementation-status.md` for completed modules). Without this flag, only the current/active module is verified.
- `--stubs` - Focus mode: run ONLY Agent 6 (Stub/Placeholder Detection). Skips Agents 1-5. Still runs Phases 3-8 for consolidation and remediation.
- `--status [module]` - Query-only mode. Reads `context/implementation-status.md` and registry. Displays stub verification status per module or all modules. Runs NO agents. When `--status` is active, all other flags (`--force`, `--stubs`, `--all`, `--timeout`) are ignored. Without a module argument, defaults to ALL. Validate module ID against `/^M(1[0-3]|[1-9])$/` or literal `ALL`. Reject invalid values with: `Invalid module ID: {input}. Use M1-M13 or ALL.`
- `--skip-stub-gate` - When passed through from implement-plan or implement-batch, stub gate results are reported but do not block completion. **Not recommended** — available as escape hatch only. Note: This flag is consumed by implement-plan/implement-batch, not verify-implementation itself.
- `--timeout=<seconds>` - Per-agent timeout in seconds (default: 120). Total max wait = timeout × 2 for all agents.

Use TodoWrite. **Launch parallel agents for Phase 2. Auto-fix all gaps without asking.**

---

## Phase 1: Plan Discovery

1. **Detect Flags**:
   - If `--force` in arguments: Set `FORCE_MODE=true` — ignore completion status in `context/implementation-status.md`, registry stage gates, and plan progress markers. Treat ALL items as requiring verification.
   - If `--all` in arguments: Set `ALL_MODE=true` — verify all implemented modules (see step 2b).
   - If `--stubs` in arguments OR bare `stubs` keyword: Set `STUBS_FOCUS=true` — run ONLY Agent 6 (Stub Scanner), skip Agents 1-5.
   - If `--status` in arguments: Set `STATUS_QUERY=true`, `STATUS_MODULE=<module-arg>|ALL` (default ALL if no module arg). Validate STATUS_MODULE against `/^M(1[0-3]|[1-9])$/` or literal `ALL`. If invalid: reject with `Invalid module ID: {input}. Use M1-M13 or ALL.` **Short-circuit to Phase 1.5** — all other flags are ignored.
   - If `--timeout=<N>` in arguments: Set `AGENT_TIMEOUT=N*1000` (convert to ms). Default: 120000ms (120 seconds).

2. **Find Plan(s)**:

   **2a. Default (single module — no `--all`):**
   - If explicit path in `$ARGUMENTS`: Use that file directly
   - Else detect **current session's module** (order of precedence):
     1. **Session context** (HIGHEST PRIORITY): Check TodoWrite todos for module references (e.g., "Implementing M2", "blprnt-M3"). Extract module ID from in_progress or recent completed todos.
     2. **Session history**: Look for recent `/implement-plan` or `/blueprint` invocations in current conversation that specify a module.
     3. **Status file (single match)**: Read `context/implementation-status.md` — if EXACTLY ONE module has status `🔨 IN PROGRESS`, use that module.
     4. **Status file (multiple matches)**: If MULTIPLE modules are `🔨 IN PROGRESS`, prompt user: "Multiple modules in progress: [list]. Specify which module to verify or use `--all`."
     5. **Fallback with warning**: If no session context and no in-progress modules, use most recently modified plan BUT display warning: "⚠️ Using most recently modified plan [name]. If working on a different module, specify it explicitly."
     6. If still none found, prompt user: "No active module detected. Specify a plan file or use `--all` to verify all completed modules."

   **Note**: Session context takes precedence over file modification time because multiple modules may be implemented in parallel across different sessions.

   **2b. All modules (`--all` flag):**
   - Read `context/implementation-status.md` — collect ALL modules with status `✅ COMPLETE` or `🔨 IN PROGRESS`
   - For each module, locate its plan file (`context/blueprints/blprnt-M*.md` or `context/plans/*.md`)
   - Queue all found plans for sequential verification
   - Output: `VERIFYING ALL: X modules found`

3. **Detect Blueprint System** (if `blprnt-*.md`):
   - Set `BLUEPRINT_MODE=true`
   - Load §7 Verification Playbook, registry, impl-contracts.md, impl spec §2 File Map

4. **Check Completion Status** (skip if `FORCE_MODE=true`):
   - Read `context/implementation-status.md` — if module marked `✅ COMPLETE`, prompt: "Module marked complete. Use `--force` to verify anyway."
   - Blueprint mode: Check registry stage gate — if `PRODUCTION`, prompt similarly
   - Standard mode: Check plan `## Implementation Progress` — if all phases `[x]`, prompt similarly

5. **Parse Plan**: Extract phases, features, expected files, endpoints, components, integration points
   - Blueprint mode: Also extract §7A checks, §7C integration checks, §12 pre-flight
   - **FORCE_MODE**: Re-verify ALL items regardless of `[x]` markers or completion annotations

6. **Output**: `PLAN: [name] | MODE: [standard/blueprint] | FORCE: [yes/no] | ALL: [yes/no] | PHASES: X | REQUIREMENTS: Y | FILES: Z`

---

## Phase 1.5: Status Query (if `STATUS_QUERY=true`)

**Short-circuit**: If `STATUS_QUERY=true`, execute this phase and EXIT immediately. No Phase 2-8.

### Read Status Sources
- Always: `context/implementation-status.md`
- If blueprint mode: registry `## Stub/Placeholder Tracking` section
- **Non-blueprint fallback**: If no registry exists, read only from `implementation-status.md`
- **File missing**: If `implementation-status.md` does not exist or is unparseable, display: `No modules tracked yet. Run /implement-plan to start.` and exit.
- **Unknown column**: If a module row lacks a `Stub Gate` column, display `UNKNOWN` (not PASSED)

### For a Specific Module (`--status M3`)
Display:
```
MODULE STATUS: M3 ({module name})
==================================
Implementation: {status from status file}
Stub Gate: {PASSED / FAILED / PENDING / UNKNOWN}
Last Scanned: {timestamp}

Stub Inventory:
  Actionable: {count} — stubs that can be fixed now
  Blocked: {count} — stubs awaiting upstream modules
  MVP (Intentional): {count} — OUT-* tagged, never remediated

{If actionable > 0:}
Actionable Stubs:
  [STUB-ID] [category] [file:line] — [description]
  ...

{If blocked > 0:}
Blocked Stubs:
  [STUB-ID] [category] [file:line] — Blocked by M[N] ({upstream status})
  ...
```

### For ALL Modules (`--status` or `--status ALL`)
Display:
```
MODULE STUB GATE STATUS
========================
| M-ID | Module | Impl Status | Stub Gate | Actionable | Blocked | MVP |
|------|--------|-------------|-----------|------------|---------|-----|
| M1 | ... | ✅ COMPLETE | PASSED | 0 | 0 | 1 |
| M3 | ... | ✅ COMPLETE | FAILED | 2 | 1 | 0 |
...

COMPLETE-IMPLEMENTATION STUB GATE: {PASSED / FAILED / NOT RUN}

{If any blocked stubs have actionable upstreams:}
⚠️ N blocked stubs have actionable upstreams — run --stubs --all --force to resolve

BLOCKED STUB DEPENDENCIES:
| STUB ID | Module | Blocked By | Upstream Status | Reclassifiable |
| ... | ... | M[N] | COMPLETE/PENDING | Yes/No |
```

### Log and Exit
```
Log: { event: 'STATUS_QUERY', module: STATUS_MODULE, source: 'implementation-status.md', timestamp }
```
Exit immediately — no Phase 2-8.

---

## Phase 2: Parallel Analysis (7 Agents)

**Launch ALL 7 agents in a SINGLE message using background mode with timeouts.**
**Note**: Agent 5 (UI/Mockup) only launches if `design/wireframes/` or `design/mockups/` exist.
**Note**: If `STUBS_FOCUS=true`, launch Agents 6 AND 7 (Stubs + Contract Compliance). Mark Agents 1-5 as `[SKIPPED - STUBS FOCUS]`.

### Agent Configuration (ALL agents)
```
run_in_background: true
max_turns: 25              # Prevents infinite loops - agent stops after 25 API round-trips
```

### Agent 1: Implementation Verification
```
subagent_type: "code-reviewer"
Verify: FILE EXISTENCE (all planned files exist) | CODE STRUCTURE (functions/classes with correct signatures) |
PLACEHOLDERS (TODO, FIXME, NotImplemented) | INTEGRATIONS (data flow between components) |
COMPLETENESS (core logic, error handling, validation, return types)
Blueprint adds: CONTRACT VERIFICATION (interface shapes match impl-contracts.md) |
FROZEN SCHEMA CHECK (LOCKED contracts unchanged - CRITICAL if mismatch)
FORCE_MODE: Re-verify ALL features including those marked complete — ignore [x] markers, ✅ annotations, COMPLETE status
Output: Per-feature status (COMPLETE/PARTIAL/MISSING), gaps IMP-*
```

### Agent 2: Logging Infrastructure
```
subagent_type: "architect-reviewer"
Audit: ENTRY POINTS (request/response on all API routes) |
ERROR PATHS (all try/catch log with context + stack, flag silent swallowing) |
CRITICAL OPS (DB, external APIs, auth, file system, background jobs) |
QUALITY (structured format, consistent levels, correlation IDs, no sensitive data)
Output: Coverage %, gaps LOG-*, security concerns SEC-LOG-*
```

### Agent 3: Testing Infrastructure
```
subagent_type: "test-automator"
Blueprint mode: Run §7A checks, record pass/fail, run §7C integration checks
Standard: COVERAGE (npm test --coverage, flag <80%) |
REQUIREMENT-TO-TEST (unit, integration, E2E for each requirement?) |
QUALITY (meaningful assertions, error/edge cases, mocking) |
INFRASTRUCTURE (runner, CI, coverage thresholds, test utilities)
Output: Playbook results (blueprint), coverage %, gaps TEST-*
```

### Agent 4: Security Analysis
```
subagent_type: "code-reviewer"
Audit: INPUT VALIDATION (Zod/schema, injection/XSS prevention) |
AUTH/AUTHZ (protected routes, session/token handling, rate limiting) |
SECRETS (no hardcoded, env vars, not logged, .env gitignored) |
DATA PROTECTION (encryption, PII handling)
Output: SECURITY STATUS (PASS/CONCERNS), gaps SEC-* with severity
```

### Agent 5: UI/Mockup Compliance (if UI_ASSETS_PRESENT)
```
subagent_type: "ui-designer"
**Skip if**: No design/wireframes/ or design/mockups/ directories exist.

Verify:
  MOCKUP MATCHING (compare mockup HTML structure with React component output) |
  DESIGN TOKENS (colors, spacing, fonts match design system values) |
  STATE COVERAGE (all states from wireframe implemented: default, loading, error, empty, success) |
  RESPONSIVE (breakpoints match wireframe spec) |
  ACCESSIBILITY (WCAG elements from mockup preserved in implementation)

For each UI component:
  1. Read corresponding mockup file (design/mockups/{Feature}/{XX}_*.html)
  2. Read corresponding wireframe file (design/wireframes/{Feature}/{XX}_*.md)
  3. Parse React component (src/components/*.tsx)
  4. Compare:
     - Element structure (div hierarchy, semantic HTML)
     - CSS properties (colors as hex, padding, margins, fonts)
     - Interactive states (hover, focus, disabled styles)
     - All wireframe states implemented
     - Responsive breakpoints

UI PLACEHOLDERS (CRITICAL severity):
  - Inline styles with literal color values not from design system
  - Text content: "Coming soon", "TODO", "Placeholder", "Lorem ipsum"
  - Empty state handlers: `return null` or `return <></>` without proper UI
  - Hardcoded dimensions not matching wireframe
  - Missing states from wireframe (empty, loading, error, success)

Output: UI compliance %, gaps UI-* with severity:
  UI-STRUCT-*: Structure mismatch (CRITICAL)
  UI-STYLE-*: Styling mismatch (HIGH if >3 properties, MEDIUM if 1-3)
  UI-STATE-*: Missing state (CRITICAL)
  UI-A11Y-*: Accessibility mismatch (HIGH)
  UI-PLACEHOLDER-*: Placeholder content/styling (CRITICAL)
```

### Agent 6: Stub/Placeholder Detection
```
subagent_type: "code-reviewer"

**Module-scoped scan**: Only scan files belonging to the current module (use File Map from impl spec §2 or plan).
If `--all` mode: scan all module files. If `--stubs` mode: Agents 6 AND 7 run (both stub and contract gaps).
```

### Agent 7: Contract Compliance (NEW)
```
subagent_type: "code-reviewer"

**Purpose**: Detect documented-but-unimplemented components by cross-referencing impl-contracts.md
and SYSTEM-OVERVIEW.md with actual codebase. Catches gaps like "action executor documented but never created".

**Module-scoped scan**: Only check contracts where `Producer: M[current]` matches current module.
If `--all` mode: check all contracts. If `--stubs` mode: this agent ALSO runs (contract gaps are stub-adjacent).

DETECTION PATTERNS:

1. **CONTRACT FILE EXISTENCE** (CRITICAL — documented file never created):
   - Parse `impl-contracts.md` for `Producer: M[0-9]+ \(([^)]+\.ts)\)` patterns
   - Extract file path from parentheses (e.g., `core/src/pipeline/action-executor.ts`)
   - Resolve to `packages/{path}` (handle core/, server/, logger/, llm/, ui/ prefixes)
   - Check if file EXISTS on disk
   - If MISSING: `CONTRACT-MISSING-*` (CRITICAL severity)

   Example detection:
   ```
   S16: Producer: M4 (core/src/pipeline/action-executor.ts)
   File: packages/core/src/pipeline/action-executor.ts
   Status: MISSING
   Gap: CONTRACT-MISSING-001 — action-executor.ts documented in S16 but never created
   ```

2. **CONTRACT INTERFACE MISMATCH** (HIGH — file exists but exports differ):
   - For existing files, parse exported interfaces/types
   - Compare against contract definitions in impl-contracts.md
   - Flag missing exports, wrong signatures, missing properties
   - If MISMATCH: `CONTRACT-MISMATCH-*` (HIGH severity)

3. **ORCHESTRATOR WIRING GAPS** (HIGH — utility not called):
   - For documented utilities (e.g., "Action Executor between stages 3 & 4"):
     - Check if orchestrator.ts imports the utility
     - Check if orchestrator.ts calls the utility at the documented location
   - If NOT WIRED: `CONTRACT-UNWIRED-*` (HIGH severity)

   Example detection:
   ```
   SYSTEM-OVERVIEW.md: "Action Executor (Between Stages 3 & 4)"
   orchestrator.ts: No import of executeAction, no call between scoring and transition
   Gap: CONTRACT-UNWIRED-001 — executeAction documented but not called in orchestrator
   ```

4. **DOCUMENTATION FLOW GAPS** (MEDIUM — SYSTEM-OVERVIEW describes flow not in code):
   - Parse SYSTEM-OVERVIEW.md "8-Stage Pipeline" diagram
   - Extract documented utilities/functions between stages
   - Verify each exists and is called in the flow
   - If MISSING from flow: `DOC-FLOW-*` (MEDIUM severity)

CROSS-REFERENCE (determines actionability):
- Read `context/implementation-status.md` for module completion status
- CONTRACT-MISSING for a COMPLETE module: CRITICAL + actionable=true
- CONTRACT-MISSING for a PENDING module: MEDIUM + actionable=false (expected)

Output: Contract compliance %, gaps CONTRACT-* with severity:
  CONTRACT-MISSING-*: Documented file never created (CRITICAL)
  CONTRACT-MISMATCH-*: Interface shape doesn't match contract (HIGH)
  CONTRACT-UNWIRED-*: Utility exists but not integrated (HIGH)
  DOC-FLOW-*: Documentation describes flow not in code (MEDIUM)

Each gap MUST include:
  - `contractRef`: Section reference (e.g., "S16", "SYSTEM-OVERVIEW §Action Executor")
  - `expectedPath`: File path from contract
  - `actionable`: true if module is COMPLETE/IN_PROGRESS, false if PENDING
  - `expectedExports`: List of interfaces/functions contract defines
```

### Agent 6: Stub/Placeholder Detection (continued)
```
subagent_type: "code-reviewer"

**Module-scoped scan**: Only scan files belonging to the current module (use File Map from impl spec §2 or plan).
If `--all` mode: scan all module files. If `--stubs` mode: this is the ONLY stub agent that runs (Agent 7 also runs).

DETECTION PATTERNS (scan in order of confidence):

1. **EXPLICIT MARKERS** (High confidence — always flag):
   - TODO, FIXME, HACK, STUB, NotImplemented in comments or code
   - "placeholder" in comments (exclude DOM `placeholder` attribute references)
   - "not implemented" / "not yet implemented"

2. **STRUCTURAL STUBS** (Medium confidence — requires context analysis):
   - `export {};` as sole file content (empty module)
   - Functions with empty bodies or that return `{}` / `[]` / `null` without logic
   - `unknown` type annotations with "when M* is implemented" comments
   - Parameters prefixed with `_` where the function body ignores them entirely
   - `{ stub: true }` in return values

3. **DEPENDENCY PLACEHOLDERS** (Cross-reference with status file):
   - Type definitions commented as "placeholder until M* delivers"
   - `createStubStage()` registrations where the real module is COMPLETE
   - `unknown` types in shared interfaces where the producer module is COMPLETE

4. **UI CONTENT PLACEHOLDERS** (if UI module):
   - Lorem ipsum, "Coming soon", "TODO" in rendered text
   - Empty render returns (`return null`, `return <></>`)
   - Hardcoded placeholder styling

CROSS-REFERENCE (CRITICAL — determines severity dynamically):
- Read `context/implementation-status.md` to get module completion status
- For each STUB-DEP/STUB-STAGE: check if upstream dependency module is COMPLETE
  - If COMPLETE → severity = HIGH (should have been replaced)
  - If PENDING → severity = LOW (expected, track with dependency note)
- For STUB-MVP (OUT-* tagged) → severity = INFO (intentional, document only)
- For STUB-EMPTY: CRITICAL if module marked COMPLETE, LOW if PENDING

EXCLUSIONS (do NOT flag):
- Test files (`__tests__/`) using stub factories for test mocking
- DOM `placeholder` attribute accesses (e.g., `el.placeholder`, `placeholder: z.string()`)
- `createNoopLogger()` (intentional utility, not a stub)
- Comments describing stubs in past tense ("was a stub", "replaced the stub")
- `node_modules/` directories

ACTIONABLE CLASSIFICATION TRUTH TABLE (single source of truth for severity AND actionable status):

| Stub Type | Module Status | Upstream Status | Severity | Actionable | Notes |
|-----------|--------------|-----------------|----------|------------|-------|
| STUB-EMPTY | COMPLETE | n/a | CRITICAL | true | Must implement exports |
| STUB-EMPTY | PENDING/IN_PROGRESS | n/a | LOW | false | Expected during development |
| STUB-DEP | any | COMPLETE | HIGH | true | Upstream delivered, replace placeholder |
| STUB-DEP | any | PENDING | LOW | false | Blocked by upstream |
| STUB-DEP | any | VERIFICATION_FAILED | LOW | false | Upstream incomplete |
| STUB-DEP | any | STUB_GATE_FAILED | LOW | false | Upstream stubs unresolved |
| STUB-DEP | any | TIMEOUT | LOW | false | Upstream incomplete |
| STUB-DEP | any | FAILED/BLOCKED | LOW | false | Upstream failed |
| STUB-STAGE | COMPLETE | n/a | HIGH | true | Replace createStubStage() |
| STUB-STAGE | IN_PROGRESS | n/a | MEDIUM | false | Still implementing |
| STUB-STAGE | PENDING | n/a | LOW | false | Not started |
| STUB-TEST | any | any | MEDIUM | true | Should use real types |
| STUB-MVP | any | any | INFO | false | Intentional (OUT-*), never remediate |

Rule: `actionable=true` if and only if the stub can be resolved with currently-available code.
Blocked stubs (upstream not COMPLETE) are never actionable at per-module level.

Output: Stub inventory count, gaps STUB-* with severity and dependency tracking:
  STUB-EMPTY-*: Empty module placeholders (CRITICAL if module COMPLETE, LOW if PENDING)
  STUB-MVP-*: Intentional MVP stubs (INFO — tracked only, never remediated)
  STUB-DEP-*: Upstream dependency placeholders (HIGH if upstream COMPLETE, LOW if PENDING)
  STUB-STAGE-*: Pipeline stage stubs (HIGH if module COMPLETE, MEDIUM if IN PROGRESS)
  STUB-TEST-*: Test fixture placeholders (MEDIUM, HIGH if coverage below threshold)

Each gap MUST include:
  - `actionable`: Boolean derived from truth table above
  - `blockedBy`: Module ID if dependency not yet implemented, or `null` if actionable now
  - `dependencyStatus`: Current status of upstream module from status file

Summary MUST include: `STUB GATE ELIGIBLE: [YES if Actionable==0 / NO]`
```

### Timeout & Collection Strategy

See `_shared-agent-timeout.md`. Command-specific settings:
- **AGENT_TIMEOUT**: 120000ms (120 seconds per agent), 240 seconds total ceiling
- **Agents**: Implementation, Logging, Testing, Security, UI (if assets exist), Stubs, Contract Compliance
- **Fallbacks**: Implementation → list existing files | Logging → "audit incomplete" | Testing → run `npm test` directly | Security → "requires manual security review" | UI → "UI mockup compliance requires manual review" | Stubs → run `grep -rn "TODO\|FIXME\|STUB\|NotImplemented" <module-files>` | Contract → run `grep -n "Producer:.*\.ts" impl-contracts.md` and check file existence

---

## Phase 2b: Persist Agent Findings (Context Checkpoint)

After all agents complete and before consolidation:

1. Write raw agent findings to `context/scratch/verify-scratch-[timestamp].json` (mkdir -p `context/scratch/` if needed):
   ```json
   { "plan": "[PLAN_PATH]", "agents": { "implementation": [...], "logging": [...], "testing": [...], "security": [...], "ui": [...], "stubs": [...], "contracts": [...] }, "ts": "[ISO]" }
   ```
2. **Context Compact**: Run `/compact`, read `context/scratch/verify-scratch-*.json` to restore findings; continue to Phase 3.
3. Delete scratch file after Phase 4 completes.

---

## Phase 3: Consolidate & Gap Analysis

**Handle partial data gracefully if any agent timed out.**

1. **Check Agent Status**: Note which agents completed vs timed out
   - If agent timed out: Add `AUDIT-INCOMPLETE-*` gap for that category
   - Example: `AUDIT-INCOMPLETE-TEST: Testing agent timed out, manual review required`

2. **Merge Findings**: Collect IMP-*, LOG-*, TEST-*, SEC-*, UI-*, STUB-*, CONTRACT-*; dedupe overlaps
   - For timed-out agents: Include any partial results captured before timeout
   - UI-* gaps: UI-STRUCT-*, UI-STYLE-*, UI-STATE-*, UI-A11Y-*, UI-PLACEHOLDER-*
   - STUB-* gaps: STUB-EMPTY-*, STUB-MVP-*, STUB-DEP-*, STUB-STAGE-*, STUB-TEST-*
   - CONTRACT-* gaps: CONTRACT-MISSING-*, CONTRACT-MISMATCH-*, CONTRACT-UNWIRED-*, DOC-FLOW-*

3. **Cross-Reference**: Flag compound issues (missing tests for insecure code, etc.)
   - Skip cross-references involving timed-out agent data (can't verify)
   - Flag UI gaps with no mockup: "UI-* gap but no mockup reference"

4. **Classify Severity**:
   - CRITICAL: breaks core/security, **UI-STRUCT-***, **UI-STATE-***, **UI-PLACEHOLDER-***, **STUB-EMPTY-* (module COMPLETE)**, **CONTRACT-MISSING-* (documented file never created)**
   - HIGH: incomplete/no tests, **UI-STYLE-* (>3 properties)**, UI-A11Y-*, **STUB-DEP-* (upstream COMPLETE)**, **STUB-STAGE-* (module COMPLETE)**, **CONTRACT-MISMATCH-***, **CONTRACT-UNWIRED-***
   - MEDIUM: logging/quality, **UI-STYLE-* (1-3 properties)**, **STUB-TEST-***, **STUB-STAGE-* (module IN PROGRESS)**, **DOC-FLOW-***
   - LOW: docs/edge cases, **STUB-EMPTY-* (module PENDING)**, **STUB-DEP-* (upstream PENDING)**
   - INFO: **STUB-MVP-* (intentional OUT-* stubs — tracked only, never remediated, NOT counted in SIGNIFICANT_GAPS)**
   - `AUDIT-INCOMPLETE-*` gaps are classified as HIGH (require manual follow-up)

5. **Gap Inventory**:
   ```
   [GAP-ID] SEVERITY: [description]
     Location: file:line | Plan Ref: Phase X, Item Y | Impact: [what breaks]
     Fix: [concrete change needed]
   ```
   For STUB-* gaps, include additional fields:
   ```
   [STUB-DEP-NNN] SEVERITY: [description]
     Location: file:line | Dependency: M[N] ([name]) — Status: [COMPLETE/PENDING]
     Fix: [concrete change needed]
     Blocked: [Yes (M[N] PENDING) / No]
   ```

6. **Statistics**: `GAPS: X CRITICAL, Y HIGH, Z MEDIUM, W LOW, I INFO (N total)`
   - INFO gaps (STUB-MVP) are tracked but NOT counted toward SIGNIFICANT_GAPS for VERIFY-LOOP exit conditions
   - Include note if any agents timed out: `⚠️ X agent(s) timed out - results may be incomplete`

---

## Phase 4: Remediation Plan

1. **Prioritized Queue**: Sort CRITICAL > HIGH > MEDIUM > LOW; identify dependencies between fixes
2. **Dependencies Map**: Optimal fix order to avoid rework
3. **Verification Steps**: Per gap, define test command + expected outcome

---

## Phase 5: Verification Report

```
VERIFY-IMPLEMENTATION REPORT
PLAN: [name] | DATE: [timestamp] | BRANCH: [branch]
Agents: ✓ Impl ✓ Log ✓ Test ✓ Sec ✓ UI ✓ Stubs [TIMEOUT] Contract
(If timeouts: "Results may be incomplete. Manual review: [list]")

PLAN COMPLIANCE: Phases X/Y (Z%) | Requirements X/Y (Z%) | Files X/Y

IMPLEMENTATION: [PASS/PARTIAL/FAIL/INCOMPLETE] — Complete: X | Partial: Y | Missing: Z
LOGGING: [PASS/NEEDS WORK/INCOMPLETE] — Entry: X% | Errors: X% | Critical: X%
TESTING: [PASS/NEEDS WORK/INCOMPLETE] — Coverage: X% | Requirement coverage: X/Y
SECURITY: [PASS/CONCERNS/INCOMPLETE] — Vulnerabilities: X critical, Y high
UI/MOCKUP: [PASS/NEEDS WORK/SKIP/INCOMPLETE] — Compliance: X% | States: X/Y | Placeholders: N
STUBS: [PASS/NEEDS WORK/INCOMPLETE] — Total: X | Actionable: Y | Blocked: Z | Intentional(MVP): W
CONTRACT: [PASS/NEEDS WORK/INCOMPLETE] — Missing: X | Mismatch: Y | Unwired: Z | DocFlow: W
STUB GATE: [PASS (0 actionable) / FAIL (Y actionable remain) / NOT RUN]
CONTRACT GATE: [PASS (0 missing/unwired) / FAIL (Y gaps remain) / NOT RUN]

GAPS: CRITICAL X | HIGH Y | MEDIUM Z | LOW W | INFO I | TOTAL N

VERDICT: [READY FOR PR / NOT READY / INCOMPLETE - MANUAL REVIEW REQUIRED]
```

**Note**: Use `INCOMPLETE` status for any section where the agent timed out. These sections require manual follow-up before the module can be considered fully verified.

---

## Phase 6: Automated Remediation

**Proceed autonomously. Do NOT ask permission.**

See `_shared-autonomous.md`. Scope: ALL remediation fixes. Only report when remediation is complete.

### Fix Order
1. **CRITICAL** (sequential): Read file, implement fix, run tests after each, resolve regressions
2. **HIGH** (parallel where possible): Launch fix agents for independent fixes in single message
3. **MEDIUM**: Direct fixes (logging, partial implementations)
4. **LOW**: Quick fixes only; skip major refactoring (note as deferred)
5. **INFO**: Do NOT fix — track only (STUB-MVP intentional stubs)

### Stub-Specific Remediation Rules

**STUB-EMPTY** (CRITICAL when module COMPLETE):
- Read the module's blueprint/impl spec §2 File Map
- Implement the module's expected exports per spec
- If module is PENDING: skip (LOW severity, tracked only)

**STUB-DEP** (HIGH when upstream COMPLETE):
1. Confirm upstream module status in `context/implementation-status.md`
2. Find the real type/interface in the upstream module's source code
3. Replace `unknown` with proper type import from the upstream module
4. Replace placeholder interfaces with imports from the real module
5. Run `npx tsc --noEmit` to verify type compatibility
6. If upstream is PENDING: skip fix, record as blocked with dependency note

**STUB-STAGE** (HIGH when module COMPLETE):
1. Check if the real stage handler exists (e.g., `IntentStageHandler` for `intent` stage)
2. Import and register the real handler instead of `createStubStage()`
3. Remove the stage from the `stubStages` array
4. Run tests to verify handler integration

**STUB-TEST** (MEDIUM):
1. Update fixture factories to use real types from implemented modules
2. Replace `() => {}` empty functions with proper mock implementations
3. Add type annotations to ensure mock shape matches real interface

**STUB-MVP** (INFO — NEVER remediate):
- Add tracking entry: `[STUB-MVP-NNN] INFO: Tracked — intentional MVP stub (OUT-NN). No action required.`

**CONTRACT-MISSING** (CRITICAL — documented file never created):
1. Read the contract section from `impl-contracts.md` (e.g., S16 Action Executor Types)
2. Extract the expected interfaces, types, and exports from the contract
3. Create the file at the documented path (e.g., `packages/core/src/pipeline/action-executor.ts`)
4. Implement the contract-defined interfaces and exports
5. Run `npx tsc --noEmit` to verify type correctness
6. Wire the new module into its consumers (e.g., orchestrator must import and call executeAction)

**CONTRACT-MISMATCH** (HIGH — interface shape differs from contract):
1. Read the contract definition from `impl-contracts.md`
2. Compare with current exports in the file
3. Update the file to match contract exactly (add missing properties, fix signatures)
4. Run `npx tsc --noEmit` to verify compatibility
5. Update any consumers that depend on the old shape

**CONTRACT-UNWIRED** (HIGH — utility exists but not integrated):
1. Identify where the utility should be called (from documentation)
2. Add import statement to the consumer file (e.g., orchestrator.ts)
3. Add the call at the documented location (e.g., "between scoring and transition")
4. Pass required arguments from context (step, selector, page, logger)
5. Run tests to verify integration

**DOC-FLOW** (MEDIUM — documentation describes flow not in code):
1. Determine if documentation or code is correct
2. If code is authoritative: update documentation to match
3. If documentation is authoritative: implement missing flow in code
4. Log decision: `DOC-FLOW-NNN: [doc-updated|code-updated] — [reason]`

**Blocked stubs** (any category, upstream PENDING):
- Do NOT attempt to fix
- Record with dependency note: `Blocked by M[N] (status: PENDING). Will be resolved when M[N] is implemented.`
- These are tracked in status files for future resolution

### Post-Fix Validation
```bash
npm test 2>/dev/null || npx vitest run
npx tsc --noEmit
npm run build 2>/dev/null
```
Fix failures (max 3 attempts each).

### Track Progress
`REMEDIATION: CRITICAL X/X | HIGH X/Y (Z deferred) | MEDIUM X/Y | LOW X/Y | INFO X (tracked) | BLOCKED Z (pending deps)`

---

## Phase 7: Post-Fix Verification

1. **Re-run Gap Check**: Verify each fix in place, tests pass
2. **Blueprint Mode Updates**: Stage gate status, regression history, deviation log, contract compliance, frozen schema timestamps
3. **Commit Fixes** (see `_shared-commit-protocol.md`): Group related fixes, reference gap IDs:
   ```
   fix: close verify-implementation gaps [GAP-001, GAP-003]
   - GAP-001: Added webhook retry logic
   - GAP-003: Implemented rate limiting
   ```
   Blueprint: include updated registry. Do NOT push.
4. **Final Report**:
   ```
   REMEDIATION REPORT
   ==================
   DISCOVERED: N | FIXED: X (Y%) | DEFERRED: Z | BLOCKED: B (pending deps) | TRACKED: T (INFO/MVP)
   CRITICAL X/X | HIGH X/Y | MEDIUM X/Y | LOW X/Y | INFO X (tracked)
   STUBS: Total X | Fixed Y | Blocked Z | Intentional(MVP) W
   VALIDATION: Tests [PASS/FAIL] | Types [PASS/FAIL] | Build [PASS/FAIL]
   COMMITS: [hashes]
   BLUEPRINT: Playbook X/Y pass | Contracts X/Y | Schemas X/Y | Registry [YES/NO]
   VERDICT: [ALL CLOSED / GAPS REMAIN]
   ```

---

## Phase 8: Context Sync

1. **Update Plan File**: Add verification record to `## Implementation Progress`:
   ```
   **Verification**: /verify-implementation [date]
   - Gaps: X (Y fixed, Z deferred) | Stubs: A (B actionable, C blocked, D MVP) | Tests: [pass/fail] | Coverage: X% | Build: [pass/fail]
   ```
   Annotate fixed items: `- [x] Item ✅ (commit: SHA) — gap [GAP-ID] fixed`

2. **Update Status File** (if exists): Upsert module row with verification status
   - Add/update `Stubs` column: `{N} actionable, {M} blocked, {K} MVP` (show `0` if all zero, omit zero categories)
   - Add/update `Stub Gate` column: `PASSED` / `FAILED` / `PENDING` / `UNKNOWN`
   - Example: `| M6 Intent Engine | ✅ COMPLETE | 94% | 0 actionable, 1 MVP | PASSED | feat/m6 | ... |`

3. **Update Blueprint Registry** (if `BLUEPRINT_MODE=true`) — update `context/blueprints/blprnt-registry.md`:
   - **YAML frontmatter**: Update `modules_complete` count, `last_updated`, `status` (if all modules done → `complete`), `current_phase`
   - **Module Status Table**: Upsert row — Status (`COMPLETE`/`IN_PROGRESS`), Gate (from gate check results), Tests (from test run), Coverage (from coverage report), Impl Files (created/expected), Deviations (count), Last Updated (today)
   - **Overall Status table**: Update aggregate metrics (Modules Complete X/14, Regression Suite test totals)
   - **Stage Gate Status**: If verification passed all checks for a gate, update gate section checks to PASS with command and date
   - **Implementation Progress**: Update Created vs Expected file counts for this module
   - **Contract Compliance Matrix**: Mark contracts produced by this module as Impl Status=`COMPLETE`, Integration Verified=`Yes`
   - **Regression History**: Add row — Run #, date, trigger description, modules tested, result (PASS/FAIL with test count), failure count
   - **Stub/Placeholder Tracking**: Create/update per-module stub summary table:
     ```
     | M-ID | Module | Total Stubs | Actionable | Blocked | MVP/Intentional | Gate Status | Last Scanned |
     ```
   - **Blocked Stub Dependencies**: Create/update sub-table for stubs awaiting upstream modules:
     ```
     | STUB ID | Module | Blocked By | Description | Auto-Resolve When |
     | STUB-DEP-002 | M4 types.ts | M8 | scoring typed as unknown | M8 marked COMPLETE |
     ```
   - When a blocked stub is resolved (upstream now COMPLETE), remove it from the blocked table

4. **Update Architecture Document** (MANDATORY if pipeline-affecting changes were made or verified):
   - Check if any gaps found/fixed affect documented pipeline behavior, config parameters, event types, error codes, or data structures
   - Update the architecture document (`docs/architecture/` or project-equivalent) with verified changes
   - Flag stale sections where implementation diverges from documentation
   - If no architecture doc exists for the project, note it as a gap in the final report

5. **Update MEMORY.md** (if new patterns): Max 5 lines, dedup by `[module]:` prefix, skip if >180 lines

6. **Include in Commit**: Stage plan file + status file + registry + architecture doc (not MEMORY.md)

---

## Usage Examples

```bash
/verify-implementation                                    # Current/active module
/verify-implementation context/blueprints/blprnt-M2.md   # Blueprint mode - specific module
/verify-implementation --stubs --all                      # Stub scan across all implemented modules
/verify-implementation --force                            # Force re-verify even if marked complete
/verify-implementation --status M2                        # Query stub gate status without running
/verify-implementation --timeout=180                      # 180 second timeout per agent (default: 120)
/verify-implementation --timeout=60 --all                 # Quick verification with shorter timeout
/verify-implementation --status                            # Show stub gate status for all modules
/verify-implementation --status M3                         # Show stub gate status for M3 only
/verify-implementation --status ALL                        # Explicit all-modules status query
```

## Integration

After running:
- All gaps fixed automatically (CRITICAL/HIGH/MEDIUM/LOW)
- Stub gaps detected, fixed where possible, blocked stubs tracked with dependency notes
- STUB-MVP (INFO) gaps tracked but never remediated (intentional post-MVP stubs)
- Tests/types/build validated
- Fixes committed locally (not pushed)
- Unfixable gaps documented
- Plan file + status file updated (includes Stubs column)
- Blueprint mode: contracts verified, registry updated, stub tracking section maintained
- **Default**: Verifies current session's module (detected from TodoWrite/recent commands, then status file; warns if falling back to file modification time)
- **`--all` mode**: Sequentially verifies all implemented modules from status file
- **`--force` mode**: Ignores completion markers — useful for regression testing, post-refactor validation, or auditing "complete" modules
- **`--stubs` mode**: Quick stub-only scan (Agent 6 only) — useful for fast stub audits without full verification overhead
- **`--status` mode**: Query-only — displays stub gate status per module from status files without running any agents
- **`--skip-stub-gate`**: Consumed by implement-plan/implement-batch — stub gate results are advisory only (do not block completion)
- **Non-batch workflows**: For individual `/implement-plan` calls, blocked stubs accumulate without an automated complete-implementation gate. Users should run `/verify-implementation --stubs --all --force` after all modules are implemented to catch previously-blocked stubs that are now actionable.

## Context Sync Notes

- **Plan file**: Source of truth — verification results written back
- **context/implementation-status.md**: Cross-session tracker — one row per module
- **MEMORY.md**: Receives reusable patterns only (max 3 lines, deduped)
- **CLAUDE.md**: NEVER auto-edited — use /optimize-context for manual sync
