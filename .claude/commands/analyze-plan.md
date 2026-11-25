---
description: Deeply analyze the plan against requirements, context and final outcome, in one review round per MVP or cut. Checks completeness, security, logging, testing and feasibility. A fix agent applies CRITICAL and HIGH fixes to the plan document without asking; MEDIUM and LOW are listed for the owner in one line. It never starts code (a multi-module plan goes on to /blueprint).
---
# Analyze Plan Command

Analyze **the plan itself** for quality, completeness, feasibility, and infrastructure readiness. Unlike `/verify-implementation` (checks code against plan), this analyzes the plan document.

**One review round per MVP or cut.** The first round found the defects that mattered; later rounds over the same
text mostly found issues in text added since, plus scope creep and false findings. So a plan is reviewed once
per MVP or cut, and a re-run reviews only the text added since the last round (Phase 1, step 4).

## Arguments
- `$ARGUMENTS` - Path to plan file, or focus: `completeness`, `security`, `logging`, `testing`, `all`
- `--no-fix` - Skip gap resolution (Phase 6), output report only
- `--deep` - Run the 5 specialist agents (one lens each) instead of the default 2.
- `--ask-tiers` - Ask which severity tiers to fix (the v1 question) instead of the default triage in 6A.
- `--full` - Review the whole plan even when a round is already recorded (a new MVP or cut in the same file).

Use TodoWrite to track progress. **Launch parallel agents for Phase 3.**

---

## Phase 1: Context Gathering

1. **Locate Plan**: `$ARGUMENTS` path → `context/blueprints/blprnt-M*.md` → `context/plans/*.md` → `~/.claude/plans/*.md`
2. **Gather Context**: Read `CLAUDE.md`, `context/CONTEXT_GUIDE.md`, `package.json`, `.env.example`
3. **Protected categories**: legal, security and compliance, plus each category the project's invariants
   protect: the profile's `docs.invariants` section when a profile exists
   (`~/.claude/commands/_shared-project-profile.md`), else CLAUDE.md's invariants and hard-guardrails sections.
   List them as `PROTECTED: [...]`; Phase 6 never defers a finding in one.
4. **Scope of this round**: read the plan header's `**Analysis**` line.
   - No round recorded, or `--full`: review the whole plan (its MVP scope, §0; the After-the-MVP items are
     out of scope, and a gap there is logged against its phase, not fixed).
   - A round recorded at `<sha>`: review only the delta, `git diff <sha> -- <plan>` (added and changed lines,
     with their section headings for context). An empty delta: print "No new text since round N" and stop.
   - The plan is not in git: review the sections whose text is not in the last remediation file's list.
   - Before a round starts, commit the plan if it has uncommitted changes (`docs(plan): …`), so the round has a
     sha. The next delta then includes this round's fixes as well as the owner's new text.
5. **Build Summary**:
   ```
   PLAN: [name]  |  PHASES: X  |  REQUIREMENTS: Y  |  FILES: Z  |  ENDPOINTS: N
   STACK: [...]  |  TEST FRAMEWORK: [...]  |  SCOPE: [full | delta since <sha>]  |  PROTECTED: [...]
   ```

---

## Phase 2: Pre-Agent Prep (Quick, 2 min max)

Build agent context string (plan summary, components, endpoints, deps, stack, the round's scope and the
protected categories). Do NOT explore files. A delta round passes the diff and the section headings it touches,
not the whole plan.

**Quick Phase Order Check**: Scan for ordering issues (Phase N depends on N+1? Circular deps? Infra built before features?). Output 0-3 concerns only.

---

## Phase 3: Parallel Expert Analysis (2 Agents; 5 with `--deep`)

**Default: 2 agents** (`~/.claude/commands/_shared-effort-budget.md`: every agent re-reads the plan, so fewer lenses per agent costs more):
- **Agent A:** the Completeness and Feasibility checklists below;
- **Agent B:** the Security, Logging and Testing checklists.

**`--deep`:** launch the 5 specialist agents, one checklist each.

Launch in one message, in the background, with effort high. No turn caps; completion comes by notification (`_shared-agent-timeout.md`).

**Reviewer hand-back:** each agent writes its full findings to `context/scratch/analyze-<plan>-<lens>.md` and
returns **at most 30 lines plus that path**: its score, then one line per gap (`CODE SEVERITY section: summary`),
CRITICAL first. Each gap names the plan section it is about and whether it falls in a protected category.

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

1. Write the merged agent findings to `context/scratch/analyze-scratch-[timestamp].json` (mkdir -p `context/scratch/` if needed):
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
   - Mark each gap in a protected category (Phase 1, step 3) with `P`, whatever its severity.

5. **Plan Maturity Score**: Completeness X/25 + Security X/25 + Logging X/25 + Testing X/25 = X/100 (a delta round scores only the categories its findings touch, and keeps the rest from the last round)
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

## Phase 6: Gap Resolution

See `_shared-autonomous.md`. **Skip if**: `--no-fix` flag.

### 6A: Triage (no question by default)

| Gap | Action |
|---|---|
| CRITICAL or HIGH | **fixed without asking** |
| Any severity in a protected category (`P`) | **fixed**, never auto-deferred; a fix that needs an owner decision becomes an Owner Item in the plan, with its default |
| MEDIUM or LOW, not protected | **listed for the owner** in one line, and recorded as deferred in the remediation file |

Print the owner list as one line, then continue without waiting:
```
DEFERRED (MEDIUM/LOW, say which to fix): COMP-4 M pagination on list API · TEST-7 L perf baseline · …
```
The owner may name any of them later; those go to a fix agent in the same round, not to a new review.

**`--ask-tiers`:** use `AskUserQuestion` (multiSelect: true) instead: "Which gap severity levels to fix?",
options CRITICAL (Recommended) | HIGH | MEDIUM | LOW. Protected (`P`) gaps are fixed whichever tiers are chosen.
Exit when none are chosen or no gaps fall in the chosen tiers.

### 6B: Generate Remediation Plan

Create `context/remediation/plan-remediation-[name]-[timestamp].md` (ensure the directory exists):

```markdown
# Remediation Plan: [Original Plan Name]
**Generated**: [timestamp] | **Source**: /analyze-plan on [path] | **Round**: N ([full | delta since <sha>]) | **Gaps**: X

**Plan Updates** (fix list)
- [ ] **[GAP-CODE]** [SEVERITY][ P]: [summary]
  - Location: [plan section] | Fix: [specific change] | Rationale: [why]

**Deferred for the owner** (MEDIUM/LOW, not protected)
- [GAP-CODE] [SEVERITY] [section]: [summary]

## Original Gap Details
[Full details per fixed gap, or the scratch paths]
```

### 6C: Apply the Plan Updates (fix agent)

Launch **one fix agent** (background, effort high, `_shared-effort-budget.md`) with the remediation file and the
plan path. It edits **only the sections each item names**, with targeted edits, ticks each item, and returns
at most 30 lines: items applied, items it could not apply and why. **The orchestrator never rewrites the plan
whole** and does not apply the edits itself.

Then the orchestrator checks the fix by reading its diff (`git diff -- <plan>`), not the whole plan: every
ticked item has a hunk, and no hunk falls outside the named sections. It does not launch a second review round.
A gap whose fix needs an owner decision becomes an Open Question (with its default) or an Owner Item in the
plan. These are document edits: do not launch `/implement-plan`, and never start code from a remediation.

**Record the round** in the plan header (the fix agent writes it):
`**Analysis**: round N @ <sha reviewed> · score X/100 · fixed A · deferred B (remediation file)`.
A later `/analyze-plan` reviews only what changed after that sha.

### 6D: Summary

**Success**:
```
REMEDIATION COMPLETE (round N)
==============================
Gaps Fixed: X/Y | Deferred for the owner: Z (listed above) | Score: [original] → [estimated]
Updated: [original-plan], context/remediation/plan-remediation-[name].md
NEXT: /blueprint (multi-module) or /implement-plan. Re-run /analyze-plan only after adding text; it reviews the delta.
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
| Fix agent left items unapplied | List them in the Partial summary; never apply them by rewriting the plan |
| Blocked/interrupted | Partial progress, resume command |
| `--ask-tiers` answer unclear | Default to CRITICAL and HIGH |

---

## Usage Examples

```bash
/analyze-plan                                    # One round: review, fix CRITICAL/HIGH, list MEDIUM/LOW
/analyze-plan --ask-tiers                        # Ask which tiers to fix (v1 behaviour)
/analyze-plan --full                             # Whole plan again (a new MVP or cut in the same file)
/analyze-plan ~/.claude/plans/feature.md         # Specific plan
/analyze-plan completeness                       # Focus on completeness
/analyze-plan security                           # Focus on security
/analyze-plan --no-fix                           # Report only
```

## Workflow Integration

```
/plan → /analyze-plan (one round per MVP or cut) → [plan updated by the fix agent] → /blueprint (multi-module) or /implement-plan (single feature)
          (a re-run after new text reviews only that text)
```

## Key Differentiators

| Aspect | /analyze-plan | /verify-implementation | /codebase-audit |
|--------|---------------|------------------------|-----------------|
| Target | Plan document | Implemented code | Full codebase |
| When | Before implementation | After implementation | Any time |
| Logging | Is it DESIGNED? | Is it IMPLEMENTED? | Patterns |
| Testing | Is STRATEGY sufficient? | Are tests WRITTEN? | Coverage |
| Security | Is DESIGN secure? | Is CODE secure? | Vulnerabilities |
