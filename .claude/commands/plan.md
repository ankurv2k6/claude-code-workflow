---
description: Interactive planning command that transforms an initial idea into a comprehensive, implementation-ready plan. Gathers requirements through clarifying questions, generates structured plan, and auto-invokes /analyze-plan for gap detection and iterative refinement.
---
# Plan Command

Transform an initial idea into a comprehensive, implementation-ready plan through structured discovery and iterative refinement.

**Workflow**: `/plan → /recommend-agents → /blueprint → /design-ui (if UI) → /implement-plan → /verify-implementation → /commit`

Note: `/analyze-plan` runs automatically at the end of Phase 6.

## Arguments

| Flag | Effect |
|------|--------|
| `$ARGUMENTS` | Initial idea, feature description, or path to requirements doc |
| `--quick` | Skip deep discovery; generate from input directly |
| `--no-analyze` | Skip automatic `/analyze-plan` invocation |
| `--tech <stack>` | Pre-specify technology stack |
| `--research` | Enable web research without confirmation |
| `--no-research` | Skip web research entirely |

## Phases Overview

```
Phase 1: Input Analysis & Domain Detection
Phase 1.5: Research (optional, user-confirmed)
Phase 2: Clarifying Questions (interactive)
Phase 3: Requirements Synthesis
Phase 4: Plan Generation → context/plans/plan-[name]-[date].md
Phase 5: User Review & Refinement
Phase 6: Auto-Invoke /analyze-plan
Phase 7: Output & Handoff
```

Use `TodoWrite` to track progress.

---

## Phase 1: Input Analysis & Domain Detection

### 1.1: Parse Input

| Input Type | Detection | Action |
|-----------|-----------|--------|
| File path | Path exists, ends in `.md/.txt/.json` | Read file as requirements |
| URL | Starts with `http://` | Fetch and extract |
| Inline text | Everything else | Parse as requirement |

If empty: prompt for description of what to build.

### 1.2: Extract Initial Signals

```
TITLE: [project/feature name]
DOMAIN: [Web app, CLI, API, Library, Mobile, Desktop]
SCOPE: [Feature, Module, Full system, Integration]
COMPLEXITY: [LOW <5 | MEDIUM 5-15 | HIGH 15-30 | VERY HIGH 30+]
USER_TYPES: [who uses this]
CORE_PROBLEM: [1-2 sentence problem statement]
```

### 1.3: Gather Project Context

Read: `CLAUDE.md`, `package.json`/`go.mod`/`requirements.txt`, `context/blueprints/`, `context/plans/`

Build context:
```
EXISTING_PROJECT: [yes/no]
TECH_STACK: [detected or TBD]
CONSTRAINTS: [from CLAUDE.md frozen params]
RELATED_MODULES: [if extending]
```

### 1.4: Identify Information Gaps

| Category | Required Info | Status | Gap Type |
|----------|--------------|--------|----------|
| Problem | Clear statement | ✓/✗ | CRITICAL |
| Users | Target types | ✓/✗ | CRITICAL |
| Scope | Feature boundaries | ✓/✗ | HIGH |
| Tech | Technology choices | ✓/✗ | MEDIUM |
| Data | Model/storage | ✓/✗ | HIGH |
| Auth | Authentication needs | ✓/✗ | MEDIUM |
| UI | Interface requirements | ✓/✗ | MEDIUM |
| Integration | External connections | ✓/✗ | LOW |
| Scale | Performance/volume | ✓/✗ | LOW |

**Quick mode (`--quick`)**: Skip to Phase 3 if no CRITICAL gaps.

---

## Phase 1.5: Research (Optional, User-Confirmed)

**Skip if**: `--no-research` or `--quick` flag.
**Auto-proceed if**: `--research` flag.

### Research Value Assessment

| Condition | Value | Topics |
|-----------|-------|--------|
| Greenfield project | HIGH | Architecture, tech comparisons |
| Tech not specified | HIGH | Library comparisons, ecosystem |
| External APIs | HIGH | API docs, rate limits, SDKs |
| Security-sensitive | MEDIUM | OWASP, best practices |
| Well-defined + existing stack | LOW | Skip unless requested |

### User Confirmation (unless --research)

Use `AskUserQuestion`:
- **Question**: "Research best practices before planning?"
- **Options**: "Yes (Recommended)" | "Quick research only" | "No, use existing knowledge"

### Execute Research

If confirmed:
1. Generate 5-8 targeted queries (tech comparisons, architecture patterns, security, APIs)
2. Use `WebSearch` for each query
3. Extract 2-3 bullet points per search
4. Synthesize into research findings table
5. Update gap analysis with resolved/new gaps

---

## Phase 2: Clarifying Questions (Interactive)

**Skip if**: `--quick` AND no CRITICAL gaps.

### Question Design Principles
- Be specific, offer defaults, explain why, respect existing context
- Max 3 question rounds, then proceed with defaults

### Question Templates (use AskUserQuestion)

**Round 1: Problem & Users** (if gaps)
- Who is the primary user? Options: End users / Internal team / Developers / Multiple types
- What is the core problem? Options: [inferred] / Different problem

**Round 2: Scope & Boundaries**
- What is explicitly OUT of scope? (multiSelect): Admin features / Advanced search / Real-time collab / Offline support
- Deployment target? Options: Cloud / Self-hosted / Local only / Hybrid

**Round 3: Tech Stack** (skip if `--tech` or existing stack)
- Frontend: React+TS (Recommended) / Vue+TS / No frontend / Server-rendered
- Backend: Node+Express (Recommended) / Python+FastAPI / Go / Serverless
- Database: PostgreSQL (Recommended) / MongoDB / SQLite / None/External

**Round 4: Feature-Specific** (based on domain)
- UI pattern? Dashboard / List-detail / Form-heavy / Canvas
- Auth method? Email/password / OAuth / SSO/SAML / API keys
- Data volume? Small <10K / Medium 10K-1M / Large 1M-100M / Very large 100M+

### Synthesize Answers

```markdown
## Requirements Summary
### Core
- Problem: [synthesized] | Users: [types] | Scope: [in/out]
### Technical
- Frontend: [choice] | Backend: [choice] | Database: [choice] | Deployment: [target]
### Features
- [Feature]: [description]
### Constraints
- [From CLAUDE.md, user answers, codebase]
### Unknowns
- [Item]: [default assumption]
```

---

## Phase 3: Requirements Synthesis

1. **Validate Completeness**: Check all categories covered
2. **Identify Implicit Requirements**:
   - Auth → session management, password reset
   - Multi-user → permissions, data isolation
   - API → rate limiting, error handling, versioning
   - Data storage → backup, migration
3. **Conflict Resolution**: Use `AskUserQuestion` if conflicts found

---

## Phase 4: Plan Generation

**Output**: `context/plans/plan-[feature-name]-[YYYY-MM-DD].md`

### Plan Structure

```markdown
# Plan: [Name]
**Generated**: [timestamp] | **Status**: 📝 Draft | **Source**: /plan

## 1. Executive Summary
[2-3 sentences: what, for whom, key value]

## 2. Problem Statement
### 2.1 Current State | 2.2 Desired State | 2.3 Success Metrics

## 3. User Stories
As a [user], I want [action] so that [benefit]

## 4. Scope
### 4.1 In Scope (v1) | 4.2 Out of Scope | 4.3 Assumptions

## 5. Technical Approach
### 5.1 Technology Stack
| Layer | Choice | Rationale |
### 5.2 Architecture Overview (ASCII, max 15 lines)
### 5.3 Data Model
| Entity | Key Fields | Relationships |
### 5.4 API Design
| Endpoint | Method | Purpose |

## 6. Implementation Phases
### Phase N: [Name]
**Goal**: [what achieved]
**Deliverables**: - [ ] item
**Acceptance Criteria**: [testable]

## 7. Testing Strategy
| Type | Coverage Target | Framework |

## 8. Security Considerations
- [ ] [item]: [approach]

## 9. Risks & Mitigations
| Risk | Probability | Impact | Mitigation |

## 10. Open Questions
- [ ] [Question] — default: [assumption]

## Requirements Source
- User Input: [original]
- Q&A Summary: | Question | Answer |
- Context Files: [referenced]
```

### Phase Design Guidelines
1. Each phase = vertical slice (testable/demoable)
2. Foundation first (infra, auth, logging)
3. Dependencies flow forward (N never depends on N+1)
4. 3-5 phases typical
5. Clear boundaries with distinct deliverables

---

## Phase 5: User Review & Refinement

### Present Summary
```
PLAN GENERATED
==============
File: context/plans/plan-[name]-[date].md
Summary: [2-3 sentences]
Phases: [N] | Tech: [stack] | Risks: [count] | Questions: [count]
```

### Offer Options (AskUserQuestion)
| Option | Action |
|--------|--------|
| Analyze for gaps (Recommended) | Proceed to Phase 6 |
| Looks good, ready for blueprint | Skip to Phase 7, `SKIP_ANALYSIS=true` |
| I have changes | Apply changes, re-present |
| Start over | Delete plan, exit |

---

## Phase 6: Auto-Invoke /analyze-plan

**Skip if**: User selected "Looks good" OR `--no-analyze` flag.

Use `Skill` tool: `skill: "analyze-plan"`, `args: "context/plans/plan-[name]-[date].md"`

The `/analyze-plan` command:
1. Runs 5 parallel analysis agents (completeness, security, logging, testing, feasibility)
2. Generates maturity score (X/100)
3. Identifies gaps by severity (CRITICAL/HIGH/MEDIUM/LOW)
4. Prompts gap selection and auto-generates remediation plan
5. Invokes `/implement-plan` to fix gaps

**Iteration Guard**: After 3 runs without improvement → recommend manual review.

---

## Phase 7: Output & Handoff

### Update Plan Header
```markdown
**Status**: ✅ Analyzed (Score: X/100) | 📝 Draft (if skipped)
**Analysis**: [ran/skipped] — [score]
```

### Completion Summary
```
PLANNING COMPLETE
=================
Plan: context/plans/plan-[name]-[date].md
Score: [X/100 or "Not analyzed"]
Status: Ready for blueprint

NEXT STEPS:
1. Review plan
2. /recommend-agents — install agents for this project (optional but recommended)
3. /blueprint context/plans/plan-[name]-[date].md — for complex systems
4. /implement-plan (after blueprint or directly for simple features)

For complex systems: /recommend-agents → /blueprint → /blueprint --verify → /implement-plan
```

### Update Status
Add to `context/implementation-status.md` Active Plans section if exists.

---

## Usage Examples

```bash
/plan "Build a notification system"                    # Interactive, asks about research
/plan --research "Real-time collaboration"             # With web research
/plan --no-research "Add dark mode toggle"             # Skip research
/plan --quick "Simple CRUD API"                        # Quick mode
/plan --tech "React, Node, PostgreSQL" "User auth"     # Pre-specified tech
/plan ./docs/requirements.md                           # From document
/plan --no-analyze "Todo API"                          # Skip analysis
```

## Workflow Integration

```
USER IDEA → /plan (this command)
  ├─ Phase 1: Input Analysis
  ├─ Phase 1.5: Research (optional)
  ├─ Phase 2-4: Q&A + Requirements + Generation
  ├─ Phase 5: User Review
  ├─ Phase 6: /analyze-plan (auto) → gap detection → /implement-plan remediation
  └─ Phase 7: Handoff
         ↓
/recommend-agents → /blueprint → /design-ui → /implement-plan → /verify-implementation → /commit
              └─ Output: design/wireframes/**/*.md, design/mockups/**/*.html
```

## Key Differentiators

| Aspect | /plan | /blueprint | /analyze-plan |
|--------|-------|------------|---------------|
| Input | Idea/outline | Structured plan | Existing plan |
| Output | Implementation-ready plan | Three-layer system + registry | Gap analysis + score |
| Interactive | Yes (Q&A) | No | Partial (gap selection) |
| Tech decisions | Makes + justifies | Assumes made | Evaluates quality |
| When | Start of planning | After plan solid | After plan exists |

## Error Handling

| Situation | Action |
|-----------|--------|
| Empty input | Prompt for description |
| File not found | Error with path suggestion |
| URL fetch fails | Fallback to manual input |
| User abandons Q&A | Save partial, allow resume |
| /analyze-plan fails | Report error, offer manual review |
