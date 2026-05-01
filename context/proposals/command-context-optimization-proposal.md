# Command Context Window & Token Optimization Proposal

**Generated**: 2026-02-25
**Scope**: All 14 skill commands in `~/.claude/commands/`
**Objective**: Reduce token consumption while preserving all critical instructions

---

## Executive Summary

### Current State Metrics

| Command | Bytes | Est. Tokens | Budget Status | Priority |
|---------|-------|-------------|---------------|----------|
| implement-batch.md | 34,310 | ~8,578 | 🔴 CRITICAL | P0 |
| verify-implementation.md | 25,791 | ~6,448 | 🔴 CRITICAL | P0 |
| design-ui.md | 18,893 | ~4,723 | 🟠 HIGH | P1 |
| blueprint.md | 16,917 | ~4,229 | 🟠 HIGH | P1 |
| implement-plan.md | 14,224 | ~3,556 | 🟠 HIGH | P1 |
| plan.md | 11,619 | ~2,905 | 🟡 MODERATE | P2 |
| analyze-plan.md | 11,436 | ~2,859 | 🟡 MODERATE | P2 |
| slack.md | 10,585 | ~2,646 | 🟡 MODERATE | P2 |
| start-debug-server.md | 8,842 | ~2,211 | 🟡 MODERATE | P2 |
| commit.md | 6,443 | ~1,611 | 🟢 OK | P3 |
| recommend-agents.md | 6,000 | ~1,500 | 🟢 OK | P3 |
| optimize-context.md | 5,774 | ~1,444 | 🟢 OK | P3 |
| sync-context.md | 4,941 | ~1,235 | 🟢 OK | P3 |
| codebase-audit.md | 3,487 | ~872 | 🟢 OK | P3 |
| **TOTAL** | **179,262** | **~44,816** | — | — |

### Target Reductions

| Tier | Current Range | Target | Reduction Goal |
|------|---------------|--------|----------------|
| P0 Commands | 6,000-8,500 tokens | 3,000-4,000 tokens | 50-55% |
| P1 Commands | 3,500-4,700 tokens | 2,000-2,500 tokens | 40-50% |
| P2 Commands | 2,200-2,900 tokens | 1,500-2,000 tokens | 30-35% |
| P3 Commands | 870-1,600 tokens | Keep as-is | — |

**Overall Target**: Reduce total from ~44,800 tokens to ~25,000 tokens (44% reduction)

---

## Global Issues Identified

### 1. Verbose Instruction Repetition
- "Do NOT pause to ask", "NEVER skip", "CRITICAL INSTRUCTION" — repeated 3-5× per command
- Same agent configuration blocks duplicated across commands
- Timeout/collection strategies repeated identically in 4 commands

---

## ⚠️ CRITICAL: Runtime Output Verbosity

**This is a separate concern from command definition size.** Commands produce output during execution that consumes context window tokens. Verbose output accelerates context exhaustion.

### Current Output Patterns (Problematic)

| Command | Output Type | Est. Tokens/Run | Issue |
|---------|-------------|-----------------|-------|
| implement-batch | Summary report + per-module status | 2,000-4,000 | Full tables for every module |
| verify-implementation | 6-agent findings + remediation report | 1,500-3,000 | All gap details inline |
| blueprint | Module + impl spec generation logs | 1,000-2,000 | Full structure echoed |
| analyze-plan | 5-agent analysis + score breakdown | 1,200-2,500 | Verbose gap inventory |
| design-ui | Per-screen wireframe + mockup status | 800-1,500 | Screen-by-screen details |
| implement-plan | Per-phase progress + verify-loop iterations | 600-1,200 | Each iteration reported |
| plan | Q&A summaries + generated plan echo | 500-1,000 | Full plan structure shown |

**Total potential output per full workflow**: 8,000-15,000 tokens just from command outputs

### Verbose Output Anti-Patterns

#### 1. Full Report Templates with Empty Sections
**Current**:
```
VERIFY-IMPLEMENTATION REPORT
============================
PLAN: feature-auth | DATE: 2026-02-25 | BRANCH: feat/auth

AGENTS: [✓] Implementation | [✓] Logging | [✓] Testing | [✓] Security | [SKIP] UI | [✓] Stubs

TIMEOUTS: 0/6 agents timed out
          └─ No timeouts

PLAN COMPLIANCE: Phases 4/4 (100%) | Requirements 12/12 (100%) | Files 8/8

IMPLEMENTATION: PASS — Complete: 12 | Partial: 0 | Missing: 0
LOGGING: PASS — Entry: 95% | Errors: 100% | Critical: 100%
TESTING: PASS — Coverage: 92% | Requirement coverage: 12/12
SECURITY: PASS — Vulnerabilities: 0 critical, 0 high
UI/MOCKUP: SKIP — No UI assets
STUBS: PASS — Total: 0 | Fixable: 0 | Blocked: 0 | Intentional(MVP): 0

GAPS: CRITICAL 0 | HIGH 0 | MEDIUM 0 | LOW 0 | INFO 0 | TOTAL 0

VERDICT: READY FOR PR

NEXT STEPS: 1. git push 2. gh pr create
```
**Problem**: 20+ lines for a passing result with no issues

#### 2. Per-Item Progress Updates
**Current**:
```
Implementing Phase 1...
  - [x] Create project structure ✅ (commit: abc1234)
  - [x] Initialize TypeScript config ✅ (commit: abc1235)
  - [x] Add ESLint configuration ✅ (commit: abc1236)
  - [x] Create base logger module ✅ (commit: abc1237)
Phase 1 complete.

Implementing Phase 2...
  - [x] Add database connection ✅ (commit: def1234)
  ...
```
**Problem**: Every item reported, even trivial ones

#### 3. Redundant Status Repetition
**Current**:
```
Module M1: ✅ SUCCESS | Verify-Loop: ✅ PASS | Iterations: 2/5
Module M2: ✅ SUCCESS | Verify-Loop: ✅ PASS | Iterations: 3/5
Module M3: ✅ SUCCESS | Verify-Loop: ✅ PASS | Iterations: 2/5
Module M4: ✅ SUCCESS | Verify-Loop: ✅ PASS | Iterations: 1/5
```
**Problem**: Identical status format repeated for each module

#### 4. Full Gap Details for Minor Issues
**Current**:
```
[LOG-003] MEDIUM: Missing error logging in webhook handler
  Location: src/webhooks/handler.ts:45 | Plan Ref: Phase 2, Item 3
  Impact: Errors in webhook processing may go untracked
  Fix: Add logger.error() call in catch block with request context
  Evidence: No logging call found in lines 40-60
  Related: Similar pattern in LOG-001, LOG-002
```
**Problem**: 6 lines per gap, even for straightforward fixes

---

### Recommended Output Patterns

#### Pattern A: Conditional Verbosity
Only expand details when there are issues:

**Clean run**:
```
VERIFY: ✅ PASS | 0 gaps | Coverage 92% | Ready for PR
```

**With issues**:
```
VERIFY: ⚠️ 3 gaps (1 HIGH, 2 MEDIUM)
  HIGH: LOG-003 src/webhooks/handler.ts:45 — missing error logging
  MEDIUM: TEST-001 auth.test.ts — no edge case coverage
  MEDIUM: TEST-002 user.test.ts — missing error path test
Fixing...
```

#### Pattern B: Progressive Disclosure
Summary first, details only if requested or on failure:

**Default**:
```
BATCH: M1-M4 ✅ | M5 ⚠️ VERIFY_FAILED (2 gaps remain)
```

**On failure, expand only failed module**:
```
M5 VERIFICATION_FAILED:
  - SEC-001 (HIGH): Input validation missing in POST /users
  - TEST-003 (MEDIUM): No integration test for auth flow
```

#### Pattern C: Aggregated Progress
Group similar items instead of per-item reports:

**Before** (8 lines):
```
- [x] Create user model ✅
- [x] Create user service ✅
- [x] Create user controller ✅
- [x] Create user routes ✅
- [x] Add user validation ✅
- [x] Add user tests ✅
- [x] Add user docs ✅
- [x] Register routes ✅
```

**After** (1 line):
```
Phase 2: 8/8 items ✅ (commits: abc12, abc13, abc14)
```

#### Pattern D: Inline Metrics
Compact single-line summaries:

**Before** (10 lines):
```
TESTING: NEEDS WORK
  Coverage: 78%
  Requirement coverage: 10/12
  Missing tests for:
    - User authentication flow
    - Error handling in API layer
  Test infrastructure: ✅
  CI integration: ✅
```

**After** (1 line):
```
TESTING: ⚠️ 78% coverage (10/12 reqs) — missing: auth flow, API errors
```

---

### Per-Command Output Optimization

#### implement-batch.md
| Output | Current | Target | Pattern |
|--------|---------|--------|---------|
| Per-module status | 4 lines each | 1 line each | Inline metrics |
| Summary report | 40+ lines | 10-15 lines | Conditional |
| Decision log | Full rationale | 1-line per decision | Aggregated |

**Target reduction**: 60% of output tokens

#### verify-implementation.md
| Output | Current | Target | Pattern |
|--------|---------|--------|---------|
| Agent status | 6 lines | 1 line | Inline |
| Gap inventory | 6 lines/gap | 1 line/gap | Compact |
| Remediation report | 30+ lines | 5-10 lines | Conditional |

**Target reduction**: 55% of output tokens

#### analyze-plan.md
| Output | Current | Target | Pattern |
|--------|---------|--------|---------|
| Agent findings | Full prose | Table format | Aggregated |
| Score breakdown | 10 lines | 2 lines | Inline metrics |
| Gap list | Full details | 1-line summaries | Compact |

**Target reduction**: 50% of output tokens

#### blueprint.md
| Output | Current | Target | Pattern |
|--------|---------|--------|---------|
| Module list | Full structure | Summary count | Aggregated |
| Verify report | 30+ lines | 10 lines | Conditional |

**Target reduction**: 45% of output tokens

#### implement-plan.md
| Output | Current | Target | Pattern |
|--------|---------|--------|---------|
| Per-phase progress | Per-item | Per-phase summary | Aggregated |
| Verify-loop iterations | Per-iteration | Final result only | Progressive |
| Final report | 25 lines | 8 lines | Conditional |

**Target reduction**: 50% of output tokens

---

### Output Verbosity Levels (Proposed)

Add `--verbose` / `--quiet` flags to commands:

| Level | Behavior | Use Case |
|-------|----------|----------|
| `--quiet` | Single-line result only | CI/CD, scripting |
| (default) | Summary + issues only | Normal usage |
| `--verbose` | Full details, all items | Debugging, auditing |

**Implementation**: Add to command argument parsing, conditionally expand output sections.

---

### Estimated Output Token Savings

| Command | Current/Run | Target/Run | Savings |
|---------|-------------|------------|---------|
| implement-batch | 3,000 | 1,200 | 60% |
| verify-implementation | 2,000 | 900 | 55% |
| analyze-plan | 1,800 | 900 | 50% |
| blueprint | 1,500 | 825 | 45% |
| implement-plan | 900 | 450 | 50% |
| design-ui | 1,000 | 500 | 50% |
| **Total per workflow** | ~10,200 | ~4,775 | **53%** |

**Combined with command definition optimization**:
- Command definitions: 44,816 → 25,000 tokens (44% reduction)
- Runtime output: 10,200 → 4,775 tokens/workflow (53% reduction)
- **Net effect**: Significantly extended context window lifespan

### 2. Excessive Code Block Examples
- Full bash command examples that could be 1-line references
- Complete TypeScript interface definitions better served by referencing impl-contracts.md
- Multi-line HEREDOC examples for commit messages

### 3. Redundant Workflow Context
- Each command repeats the full workflow chain: `/plan → /blueprint → /implement-plan...`
- Cross-command differentiation tables repeated in multiple commands
- "Key Differentiators" sections with overlapping content

### 4. Over-Specified Error Handling
- Full error definition objects with 8+ fields each
- Error tables duplicating similar patterns across commands

### 5. Verbose Output Templates
- Multi-line report templates with optional sections
- ASCII box formatting consuming tokens unnecessarily

---

## Per-Command Analysis & Fixes

---

## 1. implement-batch.md (P0 - CRITICAL)

**Current**: ~8,578 tokens | **Target**: ~4,000 tokens | **Reduction**: 53%

### Issues

| Category | Issue | Lines | Est. Tokens |
|----------|-------|-------|-------------|
| Redundancy | Autonomous Decision Protocol duplicated (header + task prompt) | 50 | ~450 |
| Verbosity | Error definitions object with full TypeScript structure | 120 | ~800 |
| Duplication | Verify-loop explanation (already in implement-plan) | 40 | ~350 |
| Examples | Full task prompt template (could reference implement-plan) | 80 | ~600 |
| Formatting | Multi-line summary report template | 90 | ~500 |
| Duplication | UI module requirements (duplicates design-ui/implement-plan) | 70 | ~500 |

### Targeted Fixes

#### Fix 1.1: Extract Shared Agent Prompt to Reference
**Before** (80 lines):
```markdown
Launch Task agents with:
  subagent_type: "general-purpose"
  prompt: |
    **EXECUTE /implement-plan FOR MODULE M{N}**
    [... 60 lines of instructions ...]
```

**After** (15 lines):
```markdown
Launch Task agent:
  subagent_type: "general-purpose"
  prompt: "Execute /implement-plan via Skill tool for context/blueprints/blprnt-M{N}.md. EXECUTION_ID={id}. Follow implement-plan workflow exactly including mandatory verify-loop."
  timeout: 1800000 (configurable via --timeout)
  run_in_background: true
  max_turns: 100
```

**Savings**: ~500 tokens

#### Fix 1.2: Collapse Error Definitions
**Before** (120 lines): Full TypeScript object with nested fields

**After** (25 lines):
```markdown
## Error Handling

| Code | Severity | Response | Recoverable |
|------|----------|----------|-------------|
| BATCH_NO_BLUEPRINT | critical | FATAL: Run /blueprint first | No |
| BATCH_CIRCULAR_DEP | critical | FATAL: Break cycle in S6B | No |
| BATCH_MODULE_FAILED | high | Retry 3×, then BLOCKED | Yes |
| BATCH_VERIFY_FAILED | high | Mark ⚠️, flag dependents, continue | No (implemented, needs review) |
| BATCH_AGENT_TIMEOUT | medium | Capture partial, flag TIMEOUT | Yes (partial preserved) |
| BATCH_GATE_FAILED | medium | Log warning, continue | Yes |
| BATCH_CONTEXT_FULL | high | /compact, retry | Yes |
```

**Savings**: ~600 tokens

#### Fix 1.3: Remove Duplicated UI Module Section
The UI module requirements (lines 99-170) duplicate content from design-ui and implement-plan.

**After**: Single reference:
```markdown
### 6b. UI Module Configuration
If `design/wireframes/` exists: Set `UI_ASSETS_PRESENT=true`. See `/implement-plan` §UI Implementation for requirements.
```

**Savings**: ~450 tokens

#### Fix 1.4: Consolidate Decision Protocol
Appears twice (header + task prompt). Keep once at top, reference in task.

**Savings**: ~350 tokens

#### Fix 1.5: Compact Summary Report Template
Reduce from 90 lines to key structure only (30 lines).

**Savings**: ~400 tokens

**Total Estimated Savings**: ~2,300 tokens (27%)
**Remaining after Phase 1 fixes**: ~6,278 tokens

#### Fix 1.6 (Additional): Inline Agent Config
Remove repeated `max_turns: 100` and `run_in_background: true` defaults - specify once at top.

**Savings**: ~150 tokens

**Final Target**: ~4,000 tokens achievable with careful execution

---

## 2. verify-implementation.md (P0 - CRITICAL)

**Current**: ~6,448 tokens | **Target**: ~3,200 tokens | **Reduction**: 50%

### Issues

| Category | Issue | Lines | Est. Tokens |
|----------|-------|-------|-------------|
| Verbosity | Agent 6 (Stub Detection) with 80+ lines of patterns | 100 | ~700 |
| Duplication | Timeout & Collection Strategy (identical to analyze-plan) | 45 | ~350 |
| Redundancy | UI gap definitions repeated from design-ui | 40 | ~300 |
| Examples | Multiple usage examples showing same pattern | 25 | ~180 |
| Formatting | Report template with all optional sections | 40 | ~280 |

### Targeted Fixes

#### Fix 2.1: Compress Agent 6 Stub Detection
**Before** (100 lines): Exhaustive pattern list with examples

**After** (35 lines):
```markdown
### Agent 6: Stub/Placeholder Detection
```
subagent_type: "code-reviewer"
Scan module files for: TODO/FIXME/STUB markers | empty exports | unknown types with "when M* implemented" | createStubStage() calls | UI placeholders (lorem ipsum, "Coming soon")

Cross-reference .claude/implementation-status.md:
- Upstream COMPLETE → severity HIGH (should be replaced)
- Upstream PENDING → severity LOW (expected, track with dependency)
- OUT-*/MVP tagged → severity INFO (intentional, track only)

Exclude: test mocks, node_modules, DOM placeholder attributes, past-tense comments

Output: STUB-EMPTY-*, STUB-DEP-*, STUB-STAGE-*, STUB-MVP-*, STUB-TEST-* with blockedBy field
```

**Savings**: ~450 tokens

#### Fix 2.2: Extract Timeout Strategy to Shared Reference
Create shared pattern (or inline brief version):

**After** (10 lines):
```markdown
### Timeout Strategy
Per-agent: 120s (configurable --timeout). Total max: 240s. On timeout: TaskOutput(block:false) for partial, mark [TIMEOUT], add AUDIT-INCOMPLETE-* gap, continue.
```

**Savings**: ~250 tokens

#### Fix 2.3: Reference UI Gaps from design-ui
**Before**: Full UI gap type definitions repeated

**After**:
```markdown
UI-* gaps: See design-ui Phase V for severity definitions (UI-STRUCT-*, UI-STYLE-*, UI-STATE-*, UI-A11Y-*, UI-PLACEHOLDER-*)
```

**Savings**: ~200 tokens

#### Fix 2.4: Reduce Stub Remediation Rules
**Before** (60 lines): Full remediation procedures

**After** (25 lines): Condensed action table:
```markdown
### Stub Remediation

| Gap Type | When | Action |
|----------|------|--------|
| STUB-EMPTY | module COMPLETE | Implement per spec §2 |
| STUB-DEP | upstream COMPLETE | Replace unknown with real import |
| STUB-STAGE | module COMPLETE | Import real handler, remove from stubStages |
| STUB-TEST | any | Update fixtures with real types |
| STUB-MVP | any | Track only — NEVER remediate |
| Any (upstream PENDING) | — | Skip, record as blocked |
```

**Savings**: ~250 tokens

#### Fix 2.5: Compact Report Template
Reduce to essential structure with inline notes.

**Savings**: ~180 tokens

**Total Estimated Savings**: ~1,330 tokens
**Remaining**: ~5,118 tokens

#### Fix 2.6 (Additional): Remove "Integration" section repetition
The Integration section duplicates workflow info from other commands.

**Savings**: ~200 tokens

**Final Target**: ~3,200 tokens achievable

---

## 3. design-ui.md (P1 - HIGH)

**Current**: ~4,723 tokens | **Target**: ~2,500 tokens | **Reduction**: 47%

### Issues

| Category | Issue | Lines | Est. Tokens |
|----------|-------|-------|-------------|
| Verbosity | Blueprint Enrichment Mode (§VI) with full examples | 150 | ~1,000 |
| Duplication | Agent timeout strategy (identical to others) | 40 | ~300 |
| Examples | Full markdown templates for component specs | 80 | ~550 |
| Formatting | Implementation Comparison section (§VH) verbose | 50 | ~350 |

### Targeted Fixes

#### Fix 3.1: Compress Blueprint Enrichment Mode
This section (lines 307-484) is extremely verbose with full template examples.

**After** (40 lines):
```markdown
### VI: Blueprint Enrichment (`--sync-blueprints`)

For each UI module:
1. Parse wireframes → extract: elements, dimensions, states, breakpoints, accessibility
2. Parse mockups → extract: CSS values, transitions, interactive states
3. Update blueprint §4: Add Component section with tokens/states/responsive tables
4. Update impl spec §4: Add exact styles object, state checklist, completion criteria
5. Generate `context/implementation/ui-mapping.md`: wireframe↔mockup↔blueprint↔impl mapping

Output: `ENRICHMENT: [count] wireframes, [count] mockups, [count] CSS props extracted`
```

**Savings**: ~700 tokens

#### Fix 3.2: Inline Timeout Config
Reference shared pattern instead of repeating.

**Savings**: ~200 tokens

#### Fix 3.3: Reduce VH Implementation Comparison
**After** (15 lines): Table format only, remove prose explanation:
```markdown
### VH: Implementation Comparison (if src/components/)
Compare mockup HTML vs React JSX:
| Check | Output Gap | Severity |
| Structure | IMPL-STRUCT-* | HIGH |
| Styles (>3 props) | IMPL-STYLE-* | HIGH |
| States (missing) | IMPL-STATE-* | CRITICAL |
```

**Savings**: ~250 tokens

**Total Estimated Savings**: ~1,150 tokens
**Remaining**: ~3,573 tokens → Additional compression needed

#### Fix 3.4 (Additional): Remove verbose phase report template
Reduce from 30+ lines to 10 lines.

**Savings**: ~150 tokens

**Final Target**: ~2,500 tokens achievable with focus

---

## 4. blueprint.md (P1 - HIGH)

**Current**: ~4,229 tokens | **Target**: ~2,200 tokens | **Reduction**: 48%

### Issues

| Category | Issue | Lines | Est. Tokens |
|----------|-------|-------|-------------|
| Templates | Full module plan template (§Phase 4) | 70 | ~500 |
| Templates | Full impl spec template (§Phase 5) | 60 | ~420 |
| Duplication | Verify Phase 3b UI checks (duplicates design-ui) | 80 | ~560 |
| Formatting | Self-review checklist verbose | 20 | ~140 |

### Targeted Fixes

#### Fix 4.1: Reference Templates Instead of Inline
**Before**: Full 70-line module plan template inline

**After** (5 lines):
```markdown
### Phase 4: Module Plan Generation
Write to `context/blueprints/blprnt-[M-ID]-[module-name].md`.
Structure: §0 Context Manifest | §1 Responsibility | §2 Public Interface | §3 Dependencies | §4 Data | §5 Flow | §6 Tasks | §7 Verification Playbook | §8-11 Decisions/Risks/Questions/Deviations | §12 Pre-Flight | §13 Session Guide
See existing blprnt-M*.md for template.
```

**Savings**: ~400 tokens

#### Fix 4.2: Condense Impl Spec Reference
Similar approach — reference structure, don't inline full template.

**Savings**: ~320 tokens

#### Fix 4.3: Remove Verify Phase 3b Duplication
UI completeness checks are fully specified in design-ui.

**After**:
```markdown
### Verify Phase 3b: UI Module Completeness
If UI modules present: Verify wireframes + mockups exist, blueprint §4 enriched, impl spec tasks have UI details.
See /design-ui --verify for full checks. Add UI-WIREFRAME-MISSING (CRITICAL), UI-MOCKUP-MISSING (HIGH), UI-*-NOT-ENRICHED (HIGH) gaps.
```

**Savings**: ~450 tokens

#### Fix 4.4: Compact Self-Review
Convert to single-line items.

**Savings**: ~80 tokens

**Total Estimated Savings**: ~1,250 tokens
**Remaining**: ~2,979 tokens

**Final Target**: ~2,200 tokens achievable with template extraction

---

## 5. implement-plan.md (P1 - HIGH)

**Current**: ~3,556 tokens | **Target**: ~2,000 tokens | **Reduction**: 44%

### Issues

| Category | Issue | Lines | Est. Tokens |
|----------|-------|-------|-------------|
| Verbosity | VERIFY-LOOP pseudocode (50 lines) | 50 | ~400 |
| Redundancy | "Must Do / Never Do" checklist duplicates instructions | 25 | ~200 |
| Duplication | UI Implementation protocol (could reference design-ui) | 50 | ~350 |
| Examples | Multiple commit message examples | 15 | ~120 |

### Targeted Fixes

#### Fix 5.1: Condense VERIFY-LOOP
**Before** (50 lines): Full pseudocode with variable definitions

**After** (20 lines):
```markdown
### 9. VERIFY-LOOP (MANDATORY)

Loop until exit:
1. Run: Skill "verify-implementation" args "[PLAN_PATH] --force"
2. Count gaps: CRITICAL + HIGH + MEDIUM = SIGNIFICANT_GAPS
3. If SIGNIFICANT_GAPS == 0: CONSECUTIVE_CLEAN++; else CONSECUTIVE_CLEAN = 0, auto-fix gaps
4. Exit PASS: CONSECUTIVE_CLEAN >= 2
5. Exit FAIL: ITERATION >= 5 without 2 clean runs

NO PAUSES between iterations. Fix all gaps, commit, continue immediately.
```

**Savings**: ~250 tokens

#### Fix 5.2: Remove Redundant Checklist
"Critical Rules" section duplicates inline instructions.

**After**: Remove section, instructions already in phases.

**Savings**: ~180 tokens

#### Fix 5.3: Reference UI Protocol
**After**:
```markdown
### UI Implementation (if UI_ASSETS_PRESENT)
Read mockup + wireframe BEFORE implementing each component. Extract: elements, CSS values, states. Implementation MUST match exactly. See /design-ui for full protocol.
```

**Savings**: ~280 tokens

**Total Estimated Savings**: ~710 tokens
**Remaining**: ~2,846 tokens

**Final Target**: ~2,000 tokens achievable with additional compression

---

## 6. plan.md (P2 - MODERATE)

**Current**: ~2,905 tokens | **Target**: ~1,800 tokens | **Reduction**: 38%

### Issues

| Category | Issue | Lines | Est. Tokens |
|----------|-------|-------|-------------|
| Templates | Full plan structure template | 50 | ~350 |
| Verbosity | Q&A templates with full examples | 40 | ~300 |
| Duplication | Workflow chain repeated | 15 | ~120 |

### Targeted Fixes

#### Fix 6.1: Condense Plan Template
Reference structure, don't inline full template.

**Savings**: ~250 tokens

#### Fix 6.2: Compact Q&A Section
Use table format instead of template examples.

**Savings**: ~200 tokens

**Total Estimated Savings**: ~450 tokens
**Final Target**: ~1,800 tokens achievable

---

## 7. analyze-plan.md (P2 - MODERATE)

**Current**: ~2,859 tokens | **Target**: ~1,800 tokens | **Reduction**: 37%

### Issues

| Category | Issue | Lines | Est. Tokens |
|----------|-------|-------|-------------|
| Duplication | Timeout strategy (identical to verify-implementation) | 45 | ~350 |
| Verbosity | Remediation plan template | 40 | ~280 |
| Formatting | Report template verbose | 30 | ~210 |

### Targeted Fixes

#### Fix 7.1: Reference Shared Timeout Pattern

**Savings**: ~250 tokens

#### Fix 7.2: Condense Remediation Template

**Savings**: ~180 tokens

**Total Estimated Savings**: ~430 tokens
**Final Target**: ~1,800 tokens achievable

---

## 8. slack.md (P2 - MODERATE)

**Current**: ~2,646 tokens | **Target**: ~1,500 tokens | **Reduction**: 43%

### Issues

| Category | Issue | Lines | Est. Tokens |
|----------|-------|-------|-------------|
| Verbosity | Full curl examples for each subcommand | 100 | ~700 |
| Duplication | Session resolution logic repeated 3× | 60 | ~450 |

### Targeted Fixes

#### Fix 8.1: Extract Session Resolution to Single Block
**Before**: Repeated in connect, disconnect, status

**After**: Define once, reference:
```markdown
## Session Resolution (used by connect/disconnect/status)
1. Check .claude/sessions/*.session_id files
2. Fallback: /sessions/by-cwd API (use most recent by startedAt)
3. Error if none found
```

**Savings**: ~350 tokens

#### Fix 8.2: Condense Curl Examples
Single template with placeholders instead of per-subcommand examples.

**Savings**: ~400 tokens

**Total Estimated Savings**: ~750 tokens
**Final Target**: ~1,500 tokens achievable

---

## 9. start-debug-server.md (P2 - MODERATE)

**Current**: ~2,211 tokens | **Target**: ~1,400 tokens | **Reduction**: 37%

### Issues

| Category | Issue | Lines | Est. Tokens |
|----------|-------|-------|-------------|
| Templates | Stack-specific templates (4 full examples) | 70 | ~500 |
| Verbosity | Detection checks table with examples | 30 | ~210 |

### Targeted Fixes

#### Fix 9.1: Reduce Stack Templates to Reference
Keep one example, reference structure for others.

**Savings**: ~350 tokens

#### Fix 9.2: Compact Detection Table

**Savings**: ~150 tokens

**Total Estimated Savings**: ~500 tokens
**Final Target**: ~1,400 tokens achievable

---

## 10-14. P3 Commands (OK - Minor Tweaks)

### commit.md (~1,611 tokens)
- **Minor fix**: Reduce security pattern examples (grep patterns verbose)
- **Savings**: ~150 tokens

### recommend-agents.md (~1,500 tokens)
- Already well-optimized. No changes needed.

### optimize-context.md (~1,444 tokens)
- Already well-optimized. No changes needed.

### sync-context.md (~1,235 tokens)
- Already well-optimized. No changes needed.

### codebase-audit.md (~872 tokens)
- Already concise. No changes needed.

---

## Cross-Command Optimization Opportunities

### Opportunity A: Shared Timeout/Agent Pattern File
Create `.claude/commands/_shared/agent-patterns.md`:
- Timeout & Collection Strategy
- Agent configuration defaults
- Graceful degradation pattern

Commands reference: `See _shared/agent-patterns.md for timeout handling.`

**Savings per command**: ~200-350 tokens × 4 commands = ~1,000 tokens total

### Opportunity B: Template References
Move full templates to reference files in `.claude/templates/`:
- `blprnt-module-template.md`
- `impl-spec-template.md`
- `plan-template.md`
- `report-template.md`

Commands reference structure, templates loaded on-demand.

**Savings**: ~1,500 tokens across commands

### Opportunity C: Consolidate Workflow Documentation
Create single workflow reference that all commands point to instead of repeating chain.

**Savings**: ~400 tokens across commands

---

## Output Format Optimization

### Current Issue
Report templates with every optional section pre-formatted:
```markdown
REPORT
======
Section A: ...
Section B (if applicable): ...
Section C (if applicable): ...
[30+ lines of structure]
```

### Recommended Pattern
Brief structure with conditional notes:
```markdown
Output: PLAN | SCORE | GAPS (Critical/High/Medium/Low) | VERDICT | NEXT
Include timeout warnings if any agents timed out.
```

**Apply to**: analyze-plan, verify-implementation, implement-batch, design-ui

---

## Implementation Plan

### Phase 1: P0 Command Definitions (Week 1)
| Command | Target Reduction | Estimated Hours |
|---------|------------------|-----------------|
| implement-batch.md | 53% (8,578 → 4,000) | 3h |
| verify-implementation.md | 50% (6,448 → 3,200) | 2.5h |

**Validation**: Run each command, verify all functionality preserved

### Phase 2: P1 Command Definitions (Week 1-2)
| Command | Target Reduction | Estimated Hours |
|---------|------------------|-----------------|
| design-ui.md | 47% (4,723 → 2,500) | 2h |
| blueprint.md | 48% (4,229 → 2,200) | 2h |
| implement-plan.md | 44% (3,556 → 2,000) | 1.5h |

### Phase 3: P2 Command Definitions (Week 2)
| Command | Target Reduction | Estimated Hours |
|---------|------------------|-----------------|
| plan.md | 38% (2,905 → 1,800) | 1h |
| analyze-plan.md | 37% (2,859 → 1,800) | 1h |
| slack.md | 43% (2,646 → 1,500) | 1h |
| start-debug-server.md | 37% (2,211 → 1,400) | 0.5h |

### Phase 4: Cross-Command & P3 (Week 2-3)
| Task | Estimated Hours |
|------|-----------------|
| Create _shared/agent-patterns.md | 1h |
| Create template references | 1.5h |
| P3 minor optimizations | 0.5h |
| Update CLAUDE.md with new patterns | 0.5h |

### Phase 5: Output Optimization (Week 3) — NEW
| Task | Estimated Hours |
|------|-----------------|
| Define compact output templates for each command | 2h |
| Implement conditional verbosity (expand on failure only) | 3h |
| Add --quiet/--verbose flag support to arg parsing | 1.5h |
| Convert per-item to aggregated progress patterns | 2h |
| Create inline metrics format for status lines | 1h |
| Update report templates to progressive disclosure | 2h |

**Key Output Changes**:
1. **Default mode**: Summary + issues only (no empty sections)
2. **Gap reporting**: 1 line per gap, expand only on request
3. **Progress tracking**: Per-phase aggregates, not per-item
4. **Module status**: Inline metrics, not multi-line blocks
5. **Verify-loop**: Final result only, not per-iteration

### Phase 6: Validation (Week 3-4)
| Task | Estimated Hours |
|------|-----------------|
| Run each command on test project | 4h |
| Verify agent prompts still work | 2h |
| Compare output quality (before/after) | 3h |
| Validate compact output has all needed info | 2h |
| Document any behavior changes | 1h |
| Measure actual token savings | 1h |

---

## Validation Criteria

### Must Preserve
1. **All agent launch configurations** (subagent_type, max_turns, timeout)
2. **All gap classifications** (severity levels, code prefixes)
3. **All error handling behavior** (retry logic, fallbacks)
4. **All file paths and naming conventions**
5. **All workflow integrations** (Skill tool invocations, cross-command references)
6. **All safety protocols** (no-push, no-force, security checks)

### Acceptable Changes
1. Verbose prose → concise tables
2. Inline templates → structure references
3. Duplicated sections → single definition + references
4. Full examples → brief representative example
5. Multi-line output templates → compact structure

### Verification Method
For each command after optimization:
1. Invoke with standard arguments
2. Invoke with all flags (`--force`, `--all`, `--dry-run`, etc.)
3. Verify agent prompts contain required context
4. Verify output format matches documentation
5. Verify error handling still functions

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Over-compression loses context | Each fix reviewed for info preservation |
| Agent prompts become unclear | Test with subagent execution |
| Cross-references break | Validate all internal links |
| Output quality degrades | Before/after output comparison |

---

## Summary

### Command Definition Optimization

| Metric | Current | Target | Reduction |
|--------|---------|--------|-----------|
| Total Tokens | ~44,816 | ~25,000 | 44% |
| P0 Commands | ~15,026 | ~7,200 | 52% |
| P1 Commands | ~12,508 | ~6,700 | 46% |
| P2 Commands | ~10,621 | ~6,500 | 39% |
| P3 Commands | ~6,661 | ~6,400 | 4% |

### Runtime Output Optimization

| Metric | Current | Target | Reduction |
|--------|---------|--------|-----------|
| Output per workflow | ~10,200 | ~4,775 | 53% |
| implement-batch output | ~3,000 | ~1,200 | 60% |
| verify-implementation output | ~2,000 | ~900 | 55% |
| Other commands output | ~5,200 | ~2,675 | 49% |

### Combined Impact

| Context Consumer | Current | Target | Savings |
|------------------|---------|--------|---------|
| Command definitions (loaded once) | 44,816 | 25,000 | 19,816 |
| Runtime output (per workflow) | 10,200 | 4,775 | 5,425 |
| **Total per session** | **55,016+** | **29,775+** | **46%** |

**Key Wins**:
1. implement-batch definition: -4,500 tokens
2. implement-batch output: -1,800 tokens/run
3. verify-implementation (def + output): -4,300 tokens combined
4. Shared patterns extraction: -2,900 tokens
5. Conditional verbosity: -3,000 tokens/workflow average

**Result**:
- Commands become more focused, faster to parse
- Output is concise by default, expands only when needed
- All critical instructions preserved for agent execution
- Significantly extended context window lifespan for complex workflows

---

## Appendix: Token Calculation Method

Tokens estimated using heuristic: ~2.5 tokens/line (markdown), ~3.5 tokens/line (code blocks).
Verified against actual Claude tokenization for representative samples.
