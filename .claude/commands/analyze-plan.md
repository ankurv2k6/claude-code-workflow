---
description: Deeply analyze the plan against requirements, context and final outcome. Checks completeness, security, logging, testing and feasibility. After analysis, prompts to select gap tiers to fix and applies the fixes to the plan document itself; it never starts code (a multi-module plan goes on to /blueprint).
---
# Analyze Plan Command

Analyze **the plan itself** for quality, completeness, feasibility, and infrastructure readiness. Unlike `/verify-implementation` (checks code against plan), this analyzes the plan document.

## Arguments
- `$ARGUMENTS` - Path to plan file, or focus: `completeness`, `security`, `logging`, `testing`, `all`
- `--no-fix` - Skip interactive gap resolution (Phase 6), output report only
- `--deep` - Run the 5 specialist agents (one lens each) instead of the default 2.

Use TodoWrite to track progress. **Launch parallel agents for Phase 3.**

---

## Phase 1: Context Gathering

1. **Locate Plan**: `$ARGUMENTS` path → `context/blueprints/blprnt-M*.md` → `context/plans/*.md` → `~/.claude/plans/*.md`
2. **Gather Context**: Read `CLAUDE.md`, `context/CONTEXT_GUIDE.md`, `package.json`, `.env.example`
3. **Build Summary**:
   ```
   PLAN: [name]  |  PHASES: X  |  REQUIREMENTS: Y  |  FILES: Z  |  ENDPOINTS: N
   STACK: [...]  |  TEST FRAMEWORK: [...]
   ```

---

## Phase 2: Pre-Agent Prep (Quick, 2 min max)

Build agent context string (plan summary, components, endpoints, deps, stack). Do NOT explore files.

**Quick Phase Order Check**: Scan for ordering issues (Phase N depends on N+1? Circular deps? Infra built before features?). Output 0-3 concerns only.

---

## Phase 3: Parallel Expert Analysis (5 Agents)

**Default: 2 agents** (`~/.claude/commands/_shared-effort-budget.md`: every agent re-reads the plan, so fewer lenses per agent costs more):
- **Agent A:** the Completeness and Feasibility checklists below;
- **Agent B:** the Security, Logging and Testing checklists.

**`--deep`:** launch the 5 specialist agents, one checklist each.

Launch in one message, in the background, with effort high. No turn caps; completion comes by notification (`_shared-agent-timeout.md`). Each agent writes full findings to a scratch file and returns a short summary.

### Agent 1: Completeness
```
subagent_type: "architect-reviewer"
Analyze: FUNCTIONAL (approach specified? CRUD? State transitions? Error states? Edge cases?) |
NON-FUNCTIONAL (caching, pagination, retry, observability, accessibility?) |
INTEGRATION (API contracts, DB schema, env vars?) |
MISSING PIECES (implicit assumptions, unaddressed risks)
Output: COMPLETENESS SCORE X/100, gaps COMP-*/MISS-* with severity
```

### Agent 2: Security
```
subagent_type: "code-reviewer"
Analyze: THREAT MODEL (attack surfaces, data at risk, blast radius) |
AUTH DESIGN (all endpoints protected? Authorization? Session/token handling?) |
DATA FLOW (encryption, PII leaks, input validation, injection?) |
DEPENDENCIES & STANDARDS (OWASP Top 10)
Output: SECURITY POSTURE (STRONG/ADEQUATE/WEAK/CRITICAL), gaps SEC-*
```

### Agent 3: Logging
```
subagent_type: "architect-reviewer"
CRITICAL: Logging must enable Claude Code to autonomously identify, trace, fix issues.
Analyze: STRUCTURED FORMAT (timestamp, level, requestId, error codes?) |
ERROR TAXONOMY (systematic codes, cause/fix mapping?) |
COVERAGE (entry/exit, auth, DB, external calls, errors?) |
TRACE FLOW (end-to-end via requestId?) | SENSITIVE DATA (redaction?)
Output: LOGGING READINESS, TRACEABILITY (FULL/PARTIAL/INSUFFICIENT), gaps LOG-*
```

### Agent 4: Testing
```
subagent_type: "test-automator"
TARGET: 90% coverage (not default 80%)
Analyze: STRATEGY (unit, integration, E2E, perf, security?) |
COVERAGE FEASIBILITY (per module estimate to 90%) |
REQUIREMENT-TO-TEST MAPPING (every requirement has tests?) |
QUALITY (assertions, negative cases, mocks, isolation?) |
INFRASTRUCTURE (runner, CI threshold, E2E env?)
Output: TESTING READINESS, PROJECTED COVERAGE X%, gaps TEST-*
```

### Agent 5: Outcome & Feasibility
```
subagent_type: "architect-reviewer"
Analyze: OUTCOME ALIGNMENT (fully addresses requirement? Unnecessary complexity?) |
FEASIBILITY (technically feasible? Hidden complexities? Dependency assumptions?) |
RISK (table: probability, impact, mitigation adequacy) |
DEPENDENCY CHAIN (critical path, parallelizable, single points of failure) |
ROLLBACK (reversible? Feature flags? Blast radius?)
Output: OUTCOME ALIGNMENT, FEASIBILITY, RISK LEVEL, gaps OUT-*/FEAS-*/RISK-*
```

### Completion & fallbacks

See `_shared-agent-timeout.md`.
- **Conservative default scores** for a category whose agent failed or returned incomplete: Completeness 15/25 | Security 10/25 | Logging 10/25 | Testing 10/25 | Feasibility 10/25
- **Fallbacks**: Completeness → "manual review required" | Security → "REQUIRES SECURITY REVIEW" (HIGH) | Logging → "logging audit incomplete" | Testing → "testing strategy needs manual review" | Feasibility → "feasibility analysis incomplete"

---

## Phase 3b: Persist Agent Findings (Context Checkpoint)

After all agents complete:

1. Write raw agent findings to `context/scratch/analyze-scratch-[timestamp].json` (mkdir -p `context/scratch/` if needed):
   ```json
   { "plan": "[PLAN_PATH]", "agents": { "completeness": { "score": X, "gaps": [...] }, "security": {...}, "logging": {...}, "testing": {...}, "feasibility": {...} }, "ts": "[ISO]" }
   ```
2. **State is on disk**: if your context is summarized, re-read `context/scratch/analyze-scratch-*.json`, then continue to Phase 4.
3. Delete scratch file after Phase 5 report is printed.

---

## Phase 4: Consolidate & Cross-Reference

**Handle partial data gracefully if any agent timed out.**

1. **Check Agent Status**: Note which agents completed vs timed out
   - If agent timed out: Add `AUDIT-INCOMPLETE-*` gap for that category
   - Example: `AUDIT-INCOMPLETE-SEC: Security agent timed out, manual security review required`

2. **Merge Findings**: Collect all gaps: `COMP-*`, `SEC-*`, `LOG-*`, `TEST-*`, `OUT-*`, `FEAS-*`, `RISK-*`
   - For timed-out agents: Include any partial results captured before timeout
   - Use conservative default scores for timed-out categories

3. **Cross-Reference**: Identify compound issues (Security+No tests=CRITICAL, Missing logging+tests=debugging blind spot)
   - Skip cross-references involving timed-out agent data (can't verify)

4. **Classify Severity**:
   - CRITICAL: Plan cannot succeed
   - HIGH: Significant risk (includes `AUDIT-INCOMPLETE-*` gaps)
   - MEDIUM: Notable weakness
   - LOW: Improvement opportunity

5. **Plan Maturity Score**: Completeness X/25 + Security X/25 + Logging X/25 + Testing X/25 = X/100
   - If any agent timed out: Use conservative defaults and add note "⚠️ Score may be inaccurate due to X agent timeout(s)"
   - 90-100: Production-ready
   - 75-89: Solid, address HIGH items
   - 60-74: Needs revision
   - <60: Major rework

---

## Phase 5: Final Report

```
PLAN: [name]  |  SCORE: XX/100  |  VERDICT: [PLAN READY / REVISE / MAJOR REWORK]
Completeness XX/25 | Security XX/25 | Logging XX/25 | Testing XX/25 | Feasibility XX/25
(Append * to scores from timeout defaults; if timeouts: "Score may be inaccurate. Manual review: [list]")

GAPS  (Critical: X  High: X  Medium: X  Low: X)
────────────────────────────────────────────────────────────────────────────
[GAP-CODE]  [SEVERITY]  [one-line summary]
... (all gaps, sorted by severity)

NEXT: [single most important action]
```

Rules: One line per gap. NEXT: one sentence max. Omit empty sections.
**Note**: If any agent timed out, mark affected scores with `*`.

**State is on disk**: if your context is summarized, re-read `[PLAN_PATH]` and the scratch file, then continue to Phase 6.

---

## Phase 6: Interactive Gap Resolution

See `_shared-autonomous.md`. **Skip if**: `--no-fix` flag.

### 6A: Gap Selection

Use `AskUserQuestion` (multiSelect: true):
- Question: "Which gap severity levels to automatically fix?"
- Options: CRITICAL (Recommended) | HIGH | MEDIUM | LOW

**Exit conditions**: User selects none, responds "skip/no/none", or no gaps for selected tiers.

### 6B: Generate Remediation Plan

Create `context/remediation/plan-remediation-[name]-[timestamp].md`:

```markdown
# Remediation Plan: [Original Plan Name]
**Generated**: [timestamp] | **Source**: /analyze-plan on [path] | **Tiers**: [selected] | **Gaps**: X

## Implementation Progress
| Phase | Status | Items |
| Plan Updates | ⬜ Pending | 0/N |
| Verification | ⬜ Pending | 0/N |

**Plan Updates**
- [ ] **[GAP-CODE]** [SEVERITY]: [summary]
  - Location: [plan section] | Fix: [specific change] | Rationale: [why]

**Verification**
- [ ] Re-run analysis checks
- [ ] Verify gaps addressed
- [ ] Recalculate maturity score

## Original Gap Details
[Full details per selected tier]
```

Ensure `context/remediation/` directory exists.

### 6C: Apply the Plan Updates

```
REMEDIATION PLAN CREATED
========================
File: context/remediation/plan-remediation-[name]-[timestamp].md
Gaps: X (Critical: A, High: B, Medium: C, Low: D)
Applying the plan updates...
```

Apply each **Plan Updates** item **directly to the plan document**, tick it in the remediation file, and re-check only the changed sections (at most 2 sweeps, `_shared-triage.md`). These are document edits: do not launch `/implement-plan`, and never start code from a remediation. A gap whose fix needs an owner decision becomes an Open Question (with its default) or an Owner Item in the plan.

### 6D: Post-Implementation Summary

**Success**:
```
REMEDIATION COMPLETE
====================
Gaps Fixed: X/Y | Score: [original] → [new]
Updated: [original-plan], context/remediation/plan-remediation-[name].md
RECOMMENDATION: Run /analyze-plan again to verify.
```

**Partial/Fail**:
```
REMEDIATION PARTIAL
===================
Gaps Fixed: X/Y (Z remaining) | Status: [reason]
NEXT: resolve the remaining items in context/remediation/plan-remediation-[name].md (owner decisions listed in the plan's Open Questions)
```

### 6E: Error Handling

| Failure | Action |
|---------|--------|
| Can't write remediation plan | Error, suggest alternative path |
| A plan update conflicts with an owner decision | Keep the decision; record the gap as an Open Question |
| Blocked/interrupted | Partial progress, resume command |
| Unclear input | Default to CRITICAL only |

**Iteration Guard**: After 3 runs without score improvement → recommend manual review.

---

## Usage Examples

```bash
/analyze-plan                                    # Full analysis + fix prompt
/analyze-plan ~/.claude/plans/feature.md         # Specific plan
/analyze-plan completeness                       # Focus on completeness
/analyze-plan security                           # Focus on security
/analyze-plan --no-fix                           # Report only
```

## Workflow Integration

```
/plan → /analyze-plan → [plan updated] → /blueprint (multi-module) or /implement-plan (single feature)
              ↑____________↓
          (re-run to verify improvement)
```

## Key Differentiators

| Aspect | /analyze-plan | /verify-implementation | /codebase-audit |
|--------|---------------|------------------------|-----------------|
| Target | Plan document | Implemented code | Full codebase |
| When | Before implementation | After implementation | Any time |
| Logging | Is it DESIGNED? | Is it IMPLEMENTED? | Patterns |
| Testing | Is STRATEGY sufficient? | Are tests WRITTEN? | Coverage |
| Security | Is DESIGN secure? | Is CODE secure? | Vulnerabilities |
