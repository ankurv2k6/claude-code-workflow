---
description: Interactive planning command that transforms an initial idea into a comprehensive, implementation-ready plan. Gathers requirements through clarifying questions, generates structured plan, and auto-invokes /analyze-plan for one review round of gap detection and fixes.
---
# Plan Command

Transform an initial idea into a comprehensive, implementation-ready plan through structured discovery and one review round.

**Workflow**: `/plan → /recommend-agents → /blueprint (with /design-ui for UI modules) → /implement-plan → /verify-implementation → /commit`

Note: `/analyze-plan` runs automatically in Phase 6, once per MVP or cut.

**MVP first.** The plan opens with its MVP paragraph (Phase 1.5). It is agreed with the owner before any
research, question round or plan text, because the interaction model, the entry states and the UI words
shape every module: decided later, they re-spec modules that are already blueprinted.

## Arguments

| Flag | Effect |
|------|--------|
| `$ARGUMENTS` | Initial idea, feature description, or path to requirements doc |
| `--quick` | Skip deep discovery; generate from input directly |
| `--no-analyze` | Skip automatic `/analyze-plan` invocation |
| `--tech <stack>` | Pre-specify technology stack |
| `--research` | Enable web research without confirmation (still after the MVP paragraph is agreed) |
| `--no-research` | Skip web research entirely |

## Phases Overview

```
Phase 1: Input Analysis & Domain Detection
Phase 1.5: MVP Paragraph (agreed with the owner)
Phase 1.6: Research (optional, user-confirmed; after 1.5)
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

Read: `CLAUDE.md`, `package.json`/`go.mod`/`requirements.txt`, `context/blueprints/`, `context/plans/`, and the
project profile's `docs.*` entries when one exists (`~/.claude/commands/_shared-project-profile.md`).

**Find the UI brief**, the project's binding rules for screens and words: the profile's `docs.ui_brief` when
set, else a UI section of CLAUDE.md, else `design/**/*brief*.md`. None found: say so in the MVP paragraph.

Build context:
```
EXISTING_PROJECT: [yes/no]
TECH_STACK: [detected or TBD]
CONSTRAINTS: [from CLAUDE.md frozen params]
UI_BRIEF: [path, or none]
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

**Quick mode (`--quick`)**: Write the MVP paragraph (1.5), then skip to Phase 3 if no CRITICAL gaps.

---

## Phase 1.5: MVP Paragraph (agreed before anything else)

Draft the paragraph from the input and context, then confirm it with `AskUserQuestion` (one round, up to 4
questions, on the fields you could not infer). Research, the question rounds and the plan text all wait until
the owner agrees it. It becomes the plan's §0.

| Field | States |
|---|---|
| Who | the user, in the project's own words |
| End to end | what they do, from the entry point to the outcome |
| Acceptance scenario | **one** scenario that must work on the target environment through the real UI (or the real API, for a headless feature); "done" means it works |
| Interaction model | how the user and the system exchange work: request/response or batch, streamed, background job with progress, polled, push. Name what the user sees while waiting |
| Entry states | **at rest** (how the user finds it with nothing in progress), **after reload** (what survives a refresh or a new session), **empty** (first use, nothing yet) |
| UI words | the names of the screens, actions, states and statuses the user reads, each checked against the UI brief's word rules; a word the brief forbids is replaced here, not in design |
| After the MVP | each deferred item with its phase and the trigger that brings it in |

Never cut what the project's invariants, the law, a vendor, security or data integrity needs; those stay in
the MVP whatever its size. A headless MVP states "no UI" for the UI words and the API's entry states instead.

**Record** the agreed paragraph in the owner-decisions file (Phase 2) as its first row.

---

## Phase 1.6: Research (Optional, User-Confirmed)

**Skip if**: `--no-research` or `--quick` flag.
**Auto-proceed if**: `--research` flag.
**Starts only after the MVP paragraph is agreed**, and researches the MVP's scope; the After-the-MVP items are
researched in their own phase.

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
- **Ask in rounds of up to 4 questions, grouped by topic.** Keep asking while **owner-only** questions remain: business model, legal and consent, spend, vendors, production access. There is no fixed round cap; a large product can take 6 or more rounds.
- **Drop any question whose default is safe and reversible.** Record that default as a **configurable setting with a key** (`key · default · where it is read`), never as hard-coded behaviour. "Assume a default" always means "a default someone can change later".
- Record every answer in `context/plans/<set>/owner-decisions-<YYYY-MM-DD>.md`, one row per decision: question, answer, setting key and default if any, what it changes in the plan. The blueprint and the batch lanes cite this file.

### Question Templates (use AskUserQuestion)

**Round 1: Problem & Users**: settled by the MVP paragraph (1.5); ask only what it left open.

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
**Branch**: [integration branch the work lands on] | **Production**: [what must not change, e.g. "production stays as is"] | **Decisions**: [owner-decisions file]

## 0. MVP Scope
[The agreed paragraph from Phase 1.5: who, end to end, the acceptance scenario, interaction model,
entry states (at rest · after reload · empty), UI words (checked against: [UI brief path or "none"])]
### After the MVP
| Item | Phase | Trigger |

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
- [ ] [Question] — default: [assumption] — setting key: [key, if configurable]

## 11. Owner Items
Work only the owner can do, collected from the start rather than found at merge time: IAM grants,
secrets, infrastructure applies, billing, vendor accounts, legal review, sign-offs.
| Item | Needed by (phase/module) | Default until done |

## 12. Release Cuts
Milestones as release cuts (e.g. Beta, GA, On demand), each listing its modules with effort, so a batch
can build one cut at a time.
| Cut | Modules | Effort | Done when |

## Requirements Source
- User Input: [original]
- Q&A Summary: | Question | Answer |
- Context Files: [referenced]
```

### Phase Design Guidelines
1. Each phase = vertical slice (testable/demoable); the first one delivers the acceptance scenario
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
1. Runs one review round per MVP or cut: 2 reviewers by default (5 with `--deep`)
2. Generates maturity score (X/100) and gaps by severity (CRITICAL/HIGH/MEDIUM/LOW)
3. Fixes CRITICAL and HIGH without asking, through a fix agent; lists MEDIUM and LOW for the owner in one line
   (legal, security and compliance findings are never deferred)
4. Applies the fixes to the **plan document** (a single-phase plan may go straight to `/implement-plan`; a multi-module plan goes to `/blueprint` and never starts code from the remediation)

A later edit to the plan is reviewed by re-running `/analyze-plan`, which reviews only the text added since.

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
  ├─ Phase 1.5: MVP paragraph (agreed)
  ├─ Phase 1.6: Research (optional)
  ├─ Phase 2-4: Q&A + Requirements + Generation
  ├─ Phase 5: User Review
  ├─ Phase 6: /analyze-plan (auto) → gap detection → remediation applied to the plan
  └─ Phase 7: Handoff
         ↓
/recommend-agents → /blueprint (contracts LOCKED → /design-ui writes UI §4 → module specs) → /implement-batch (multi-module) or /implement-plan → /commit
              └─ Output: design/wireframes/**/*.md, design/mockups/**/*.html
```

## Key Differentiators

| Aspect | /plan | /blueprint | /analyze-plan |
|--------|-------|------------|---------------|
| Input | Idea/outline | Structured plan | Existing plan |
| Output | Implementation-ready plan | Three-layer system + registry | Gap analysis + score |
| Interactive | Yes (MVP paragraph, Q&A) | No | One-line owner list (MEDIUM/LOW) |
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
