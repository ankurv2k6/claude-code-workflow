---
description: Deeply analyze the plan against requirements, context and final outcome. Checks completeness, security, logging, and testing. After analysis, prompts to select gap tiers to fix and auto-runs /implement-plan.
---
# Analyze Plan Command

Analyze **the plan itself** for quality, completeness, feasibility, and infrastructure readiness. Unlike `/verify-implementation` (checks code against plan), this analyzes the plan document.

## Arguments
- `$ARGUMENTS` - Path to plan file, or focus: `completeness`, `security`, `logging`, `testing`, `all`
- `--no-fix` - Skip interactive gap resolution (Phase 6), output report only
- `--timeout=<seconds>` - Per-agent timeout in seconds (default: 120). Total max wait = timeout × 2 for all agents.

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

**CRITICAL: Launch ALL 5 agents in a SINGLE message using background mode with timeouts.**

### Agent Configuration (ALL agents)
```
run_in_background: true
max_turns: 20              # Prevents infinite loops - agent stops after 20 API round-trips
```

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

### Timeout & Collection Strategy

See `_shared-agent-timeout.md`. Command-specific settings:
- **AGENT_TIMEOUT**: 120000ms (120 seconds per agent), 240 seconds total ceiling
- **Agents**: Completeness, Security, Logging, Testing, Feasibility
- **Conservative default scores** for timed-out categories: Completeness 15/25 | Security 10/25 | Logging 10/25 | Testing 10/25 | Feasibility 10/25
- **Fallbacks**: Completeness → "manual review required" | Security → "REQUIRES SECURITY REVIEW" (HIGH) | Logging → "logging audit incomplete" | Testing → "testing strategy needs manual review" | Feasibility → "feasibility analysis incomplete"

---

## Phase 3b: Persist Agent Findings (Context Checkpoint)

After all agents complete:

1. Write raw agent findings to `context/scratch/analyze-scratch-[timestamp].json` (mkdir -p `context/scratch/` if needed):
   ```json
   { "plan": "[PLAN_PATH]", "agents": { "completeness": { "score": X, "gaps": [...] }, "security": {...}, "logging": {...}, "testing": {...}, "feasibility": {...} }, "ts": "[ISO]" }
   ```
2. **Context Compact**: Run `/compact`, read `context/scratch/analyze-scratch-*.json` to restore findings; continue to Phase 4.
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

**Context Compact**: Run `/compact`, re-read `[PLAN_PATH]` to recall the plan being analyzed; continue to Phase 6.

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

### 6C: Launch Implementation

```
REMEDIATION PLAN CREATED
========================
File: context/remediation/plan-remediation-[name]-[timestamp].md
Gaps: X (Critical: A, High: B, Medium: C, Low: D)
Launching /implement-plan...
```

Use `Skill` tool: `skill: "implement-plan"`, `args: "context/remediation/plan-remediation-[name]-[timestamp].md"`

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
NEXT: /implement-plan context/remediation/plan-remediation-[name].md
```

### 6E: Error Handling

| Failure | Action |
|---------|--------|
| Can't write remediation plan | Error, suggest alternative path |
| /implement-plan fails | Error with reason, manual steps |
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
/plan → /analyze-plan → [auto-fix] → /implement-plan → /verify-implementation
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
