---
description: Create a build-ready blueprint (architecture + implementation specs) from a planning document. Produces a three-layer system: architectural blueprints, code-level implementation specs, and a unified progress registry. Use --verify to audit all artifacts, auto-fix issues, and get a ready score.
---
# Blueprint Command

Create a build-ready implementation blueprint from a planning/architecture document.

**Three-layer output**:
- **Layer 1 — Blueprints** (`context/blueprints/`): Architecture, module boundaries, verification playbooks
- **Layer 2 — Implementation Specs** (`context/implementation/`): Code-level details, TypeScript interfaces, algorithms
- **Layer 3 — Registry** (`blprnt-registry.md`): Progress tracking, stage gates, deviation log

## Arguments
- `$ARGUMENTS` - Path to planning doc or inline description
- `--verify` - Audit artifacts, auto-fix, produce ready score (runs automatically after generation)
- `--no-verify` - Skip automatic verification after generation

## Assumptions & Constraints
- Small team (1-4), 4-12 weeks, MVP-first, clean separation, no premature optimization
- Prefer simplicity; single deployable unit; deterministic over probabilistic
- Design for parallel implementation; choose specific technologies with justification

## Context Optimization Rules

**Cross-Layer**: Blueprints = what/why; impl specs = how. Single source of truth: contracts in master S7 + `impl-contracts.md`. Every module starts with MUST LOAD / DO NOT LOAD manifest.

**Within-Layer**: Compact notation (`key: value`, tables over prose). Flow notation: `trigger -> step1 -> output`. Errors: table format. Decisions: one-liner. ASCII diagrams <15 lines. Cross-references over duplication. No boilerplate/changelog. Post-MVP in master S12 only.

---

## Phase 1: Input Discovery & Context Gathering

1. **Locate Input**: `$ARGUMENTS` → `context/blueprints/blprnt-M*.md` → `context/plans/*.md` → `~/.claude/plans/*.md`
2. **Gather Context**: Read CLAUDE.md, package.json/go.mod, existing architecture docs, scan codebase patterns
3. **Extract Requirements**: functional, non-functional, personas, integrations, data model, deployment
5. **Build Summary**: Input doc, system name, domain, requirement counts, stack (existing/GREENFIELD), complexity

---

## Phase 2: Architecture Deep Thinking

| Phase | Focus |
|-------|-------|
| 2A: Tech Stack | Evaluate 2-3 options per decision (weight: team familiarity, ecosystem maturity, MVP speed) |
| 2B: Module Boundaries | Single responsibility, public interface, hidden internals, independent testability |
| 2C: Dependency Graph | Map dependencies, resolve cycles, find foundation/leaf modules, critical path |
| 2D: Parallelization | Independent modules, merge points, contracts to lock upfront, stubs for parallel work |

---

## Phase 3: Master Blueprint Generation

Write to `context/blueprints/blprnt-master.md`.

| Section | Content |
|---------|---------|
| S1 | Executive summary: 3-5 sentences (pattern, tech, deployment, key decision) |
| S2 | Core design principles: 5-7 actionable, testable (PRINCIPLE/RULE/EXAMPLE/VIOLATION) |
| S3 | Tech stack matrix: per layer with chosen/alternatives/rationale/risks |
| S4 | System architecture: compact text diagram <15 lines |
| S5 | Module index: ID, module, responsibility, priority, effort, owner, deps, plan file |
| S6 | Implementation order: 6A layered diagram, 6B dependency matrix, 6C phase table with parallelism |
| S7 | Shared contracts registry: contract, defined in, stability, producer, consumers, shape |
| S8 | Parallel implementation plan: workstreams with tasks, blocked by, produces, merge points |
| S9 | Critical path: longest chain, bottlenecks, mitigation, non-critical float |
| S10 | Milestone plan: weekly/phase with goal, modules, deliverables, done-when checklist |
| S11 | Risks: per severity (HIGH/MEDIUM/LOW) with probability, impact, mitigation, trigger |
| S12 | Post-MVP: scaling, out-of-scope, simplifications, rejected alternatives with trigger conditions |
| S13 | Regression matrix: policy, cumulative suite table, cross-package risks |

**Context Compact**: Run `/compact`, re-read `blprnt-master.md` to confirm generation complete; continue to Phase 4.

---

## Phase 4: Module Plan Generation

Write to `context/blueprints/blprnt-[M-ID]-[module-name].md`. Architecture specs only — no code details.

```markdown
# Module Plan: [M-ID] -- [Module Name]
> Master: blprnt-master.md S5 | Impl: impl-[M-ID]-[name].md | Phase: X | Effort: Xd | Deps: [M-IDs]

## 0. Context Manifest
### MUST LOAD
| File | Sections | Tokens | Why |
### DO NOT LOAD
- Other module blueprints, full master (S7 only), source docs
### Total Budget: ~X,XXX tokens

## 1. Responsibility
[2-3 sentences]

## 2. Public Interface
- Contracts (ref S7): [name] — produced/consumed
- Exports: [func](params): Return
- Endpoints: [METHOD] [path] — Req/Res/Errors
- Events: Emits/Consumes with payloads

## 3. Dependencies
Imports: [M-ID].[func] | Exports to: [M-ID] ([what])

## 4. Data Owned (omit if stateless)
Tables, columns, indexes

## 5. Data Flow
[Op]: trigger -> step1 -> output | Errors: error -> handling

## 6. Implementation Plan
TASK [N]: [Name] ([Xd], blocked by [M-ID])
  Files: [paths] | AC: [criteria] | Impl: see impl-[M-ID] S4.[N]

## 7. Verification Playbook
### 7A. Automated (exit 0)
| # | Check | Command | Timeout | Pass |
### 7B. Manual
- [ ] [observation]
### 7C. Integration
| Consumer | Verify | How |
### 7D. Gate: ALL 7A exit 0 + 7B marked + 7C confirmed + registry updated
### 7E. Regression Commands

## 8. Decisions
- chose X over Y,Z because [reason]. Reversibility: Easy/Medium/Hard

## 9. Risks (module-specific only)
| Risk | Impact | Mitigation |

## 10. Open Questions (omit if none)

## 11. Deviations (empty at generation)

## 12. Pre-Flight Checks
| Check | Verification |
| Dependency status | [M-ID] required status |
| Interface verification | import check command |
| Contract verification | LOCKED status check |
| Build chain | build commands |
ALL pass -> PROCEED / BLOCK

## 13. Session Guide
1. LOAD: This + impl spec + contracts + master S7
2. PRE-FLIGHT: Run S12, STOP on failure
3. IMPLEMENT: Follow impl spec tasks
4. VERIFY: Run S7A-7E, fix failures
5. UPDATE: Registry, commit
```

**Context Compact**: Run `/compact`, glob `context/blueprints/blprnt-M*.md` to confirm module plans written; continue to Phase 5.

---

## Phase 5: Implementation Spec Generation

Create directory: `mkdir -p context/implementation`

### 5A: `impl-contracts.md` (generate FIRST)
Single source of truth for TypeScript interfaces, Zod schemas, event types. Code-level companion to master S7.
```markdown
## [N]. [Contract Group]
### [ContractName]
- Stability: LOCKED | DRAFT
- Producer: [M-ID] | Consumers: [M-IDs]
[Full TypeScript interface + Zod schema]
```

### 5B: `impl-master.md`
| Section | Content |
|---------|---------|
| S1 | Parallel workstream map: modules, start conditions, blockers, merge points |
| S2 | Contract index: contract, section ref, producer, consumers, status |
| S3 | Shared infrastructure patterns (defined once, referenced by specs) |
| S4 | Cross-cutting decisions: error handling, naming, file org, imports |
| S5 | Stub definitions for parallel work with replace instructions |
| S6 | Integration checklist at merge points |
| S7 | Module implementation order |

### 5C: `impl-[M-ID]-[module-name].md`
```markdown
# Implementation Spec: [M-ID] -- [Module Name]
> Blueprint: blprnt-[M-ID].md | Contracts: impl-contracts.md | Patterns: impl-master.md S3

## 1. Context Manifest (matches blueprint S0)
## 2. File Map: | Order | Path | Purpose | Creates/Modifies |
## 3. Dependencies Setup: exact import statements
## 4. Core Implementation
### 4.1 [filename]
- Path, Exports (full TS signatures), Logic, Error handling, Logging
## 5. Data Structures (module-internal only)
## 6. Test Guide: | File | Covers | Mocks | Fixtures |
## 7. Integration Points (ref impl-contracts.md)
## 8. Parallel Notes (stubs from impl-master S5)
```

**Context Compact**: Run `/compact`, glob `context/implementation/impl-*.md` to confirm impl specs written; continue to Phase 6.

---

## Phase 6: Registry Generation

Write to `context/blueprints/blprnt-registry.md`:
```markdown
---
blueprint: [name] | generated: [ISO] | status: pending | modules_total: N | modules_complete: 0
---
# Blueprint Registry

## Overall Status
| Metric | Value |
| Modules Complete | 0/N |
| Stage Gates | None |
| Deviations | 0 |
| Frozen Violations | 0 |

## Module Status
| M-ID | Module | Status | Gate | Tests | Coverage | Files | Deviations | Updated |
Status: PENDING | IN_PROGRESS | COMPLETE | BLOCKED([M-ID])

## Stage Gate Status
| # | Check | Status | Command | Last Run |

## Contract Compliance
| Contract | Section | Producer | Status | Consumers | Verified |

## Deviation Log (populated during implementation)
## Regression History
## Frozen Schema Watch
| Schema | Location | Hash | Verified | Status |
```

**Context Compact**: Run `/compact`, read `blprnt-registry.md` header to confirm registry written; continue to Phase 7.

---

## Phase 7: Review & Finalization

**Self-Review Checklist**:
- [ ] Single responsibility per module, no circular deps
- [ ] Tech choices justified, milestones are vertical slices
- [ ] Critical path identified with mitigation, 2+ parallel workstreams
- [ ] Contracts have producer + consumer, interfaces type-complete
- [ ] Playbooks have executable commands, gate criteria reference 7A/B/C
- [ ] Registry counts match artifacts, frozen schema watch covers LOCKED contracts
- [ ] impl-contracts covers all S7 contracts, impl-master S5 defines stubs
- [ ] Context manifests have token estimates <3000, no duplication

**Output**: Create directories, save all files, print manifest with totals.

---

## Phase 8: Auto-Verification

**Skip if**: `--no-verify` flag or `--verify` flag (already in verify mode).

After generation completes:
1. Print: "Running automatic verification..."
2. Use `Skill` tool: `skill: "blueprint"`, `args: "--verify"`
3. Display verification results (score, verdict, gaps)
4. If score <90: List critical/high gaps requiring attention

This ensures all blueprints are validated before proceeding to implementation.

---

## Verify Mode (`--verify`)

Skip generation. Run comprehensive verification instead.

### Verify Phase 1: Artifact Discovery
Locate: `blprnt-master.md`, `blprnt-registry.md`, `blprnt-M*.md`, `impl-contracts.md`, `impl-master.md`, `impl-M*.md`
If master/registry missing: CRITICAL GAP.

### Verify Phase 2: Structural Integrity
| Check | Verify |
|-------|--------|
| Cross-refs | Every S5 module has blueprint + impl spec |
| Contracts | Every S7 contract in impl-contracts.md with producer + consumer |
| Dependencies | No cycles, all M-IDs exist, order matches impl-master S7 |
| Registry | Module count matches, gate commands executable, frozen schema complete |

### Verify Phase 3: Content Quality
| Check | Required |
|-------|----------|
| Module blueprints | S0 manifest, S1 responsibility, S2 interface, S7 playbook, S12 pre-flight |
| Impl specs | S1 manifest matches blueprint, S2 file map concrete, S4 full signatures |
| Master | S3 justified, S5 complete, S7 stability status, S10 vertical slices |
| Cross-cutting | Effort sums match, milestones cover all, manifests <3000 tokens, no placeholders |

### Verify Phase 3b: UI Module Completeness (BLOCKING for UI Modules)

**Applies to**: Modules with UI components (typically M8-M12 or modules with `type: ui` in blueprint)

**For each UI module, verify**:

#### 1. Wireframes Exist Check
```
Verify: design/wireframes/{Feature}/*.md exists for all UI components listed in blueprint
If MISSING:
  - GAP: UI-WIREFRAME-MISSING (CRITICAL)
  - Impact: "Cannot implement UI without wireframe specifications"
  - Fix: "Run /design-ui [plan-path] to generate wireframes"
```

#### 2. Mockups Exist Check (if `--with-mockups` was requested)
```
Verify: design/mockups/{Feature}/*.html exists for all UI components
If MISSING:
  - GAP: UI-MOCKUP-MISSING (HIGH)
  - Impact: "UI implementation may not match intended design"
  - Fix: "Run /design-ui --mockups-only to generate mockups from wireframes"
```

#### 3. Blueprint Enrichment Check
```
Verify: Blueprint §4 (Component Specifications) contains:
  - Element structure from wireframes
  - Design tokens (colors, spacing, fonts) from mockups
  - State coverage (default, loading, error, empty, success)
  - Responsive breakpoints
  - Accessibility requirements

If MISSING or PLACEHOLDER:
  - GAP: UI-BLUEPRINT-NOT-ENRICHED (HIGH)
  - Impact: "Implementation will lack precise UI specifications"
  - Fix: "Run /design-ui --sync-blueprints to enrich blueprints from wireframes/mockups"
```

#### 4. Impl Spec Enrichment Check
```
Verify: impl-[M-ID]-*.md §4 tasks contain:
  - Wireframe reference for each UI component
  - Mockup reference (if exists)
  - Exact CSS values (not placeholders)
  - State implementation checklist
  - Interaction specifications

If MISSING or PLACEHOLDER:
  - GAP: UI-IMPL-NOT-ENRICHED (HIGH)
  - Impact: "Implementation tasks lack precise UI requirements"
  - Fix: "Run /design-ui --sync-blueprints to enrich impl specs"
```

#### 5. UI Design Sync Status
Add to UI module blueprints:
```markdown
## UI Design Sync
| Asset | Status | Last Synced |
|-------|--------|-------------|
| Wireframes | ✅ Synced / ⚠️ Missing / 🔄 Outdated | [timestamp] |
| Mockups | ✅ Synced / ⚠️ Missing / N/A | [timestamp] |
| Blueprint §4 | ✅ Enriched / ⚠️ Needs enrichment | [timestamp] |
| Impl Spec | ✅ Enriched / ⚠️ Needs enrichment | [timestamp] |
```

#### UI Module Ready Criteria
**UI module blueprint is NOT READY until**:
- [ ] Wireframes exist for all UI components ✓
- [ ] Blueprint §4 enriched from wireframes ✓
- [ ] Impl spec tasks have UI details ✓
- [ ] (If mockups generated) Mockups exist ✓
- [ ] UI Design Sync status shows ✅ for all required assets

**If UI completeness check fails**:
- Mark module as `NOT READY (UI-INCOMPLETE)`
- Add to verification report under Critical/High Gaps
- Suggest: "Run `/design-ui --sync-blueprints` before `/implement-plan`"

### Verify Phase 4: Gap Classification & Auto-Fix
| Severity | Category | Auto-Fixable |
|----------|----------|--------------|
| CRITICAL | Missing artifact | No |
| CRITICAL | Broken reference | Yes |
| CRITICAL | UI-WIREFRAME-MISSING (UI modules) | No |
| HIGH | Missing section | Partial |
| HIGH | Contract mismatch | Yes |
| HIGH | UI-MOCKUP-MISSING (UI modules) | No |
| HIGH | UI-BLUEPRINT-NOT-ENRICHED | Partial (run /design-ui --sync-blueprints) |
| HIGH | UI-IMPL-NOT-ENRICHED | Partial (run /design-ui --sync-blueprints) |
| MEDIUM | Incomplete section | Partial |
| MEDIUM | Placeholder detected | No |
| LOW | Style violation | Yes |

Execute auto-fixes, generate manual fix list.

**UI Gap Auto-Fix Actions**:
- `UI-WIREFRAME-MISSING`: Cannot auto-fix. Suggest `/design-ui [plan-path]`
- `UI-MOCKUP-MISSING`: Cannot auto-fix. Suggest `/design-ui --mockups-only`
- `UI-BLUEPRINT-NOT-ENRICHED`: Invoke `/design-ui --sync-blueprints` to enrich
- `UI-IMPL-NOT-ENRICHED`: Invoke `/design-ui --sync-blueprints` to enrich

### Verify Phase 5: Ready Score
| Category | Weight | Max |
|----------|--------|-----|
| Structural Integrity | 25% | 25 |
| Contract Completeness | 20% | 20 |
| Module Coverage | 20% | 20 |
| Verification Readiness | 15% | 15 |
| Implementation Clarity | 10% | 10 |
| Context Optimization | 10% | 10 |

**Thresholds**: 90-100 = READY | 75-89 = MOSTLY READY | 50-74 = NEEDS WORK | <50 = NOT READY

### Verify Phase 6: Report
Write to `context/blueprints/blprnt-verify-report.md`:
```markdown
# Blueprint Verification Report
Generated: [ISO] | Score: **XX/100** | Verdict: [READY/...]

## Score Breakdown
| Category | Score | Max | Issues |

## Auto-Fixes Applied
## Critical Gaps (MUST FIX)
## High Priority Gaps
## Module Readiness Matrix
| M-ID | Module | Blueprint | Impl | Contracts | Playbook | Ready |

## Recommendation
[PROCEED / FIX AND RE-VERIFY / MAJOR REWORK]
```

### Verify Phase 7: Console Output
```
BLUEPRINT VERIFICATION COMPLETE
Score: XX/100 | Verdict: [VERDICT]
Artifacts: N | Auto-Fixes: N | Gaps: N (Critical: N, High: N)
Report: context/blueprints/blprnt-verify-report.md
```

---

## Workflow Integration

```
[Planning Doc] -> /blueprint -> Three-layer system + auto-verify
  -> (if score <90) Fix gaps, re-run /blueprint --verify
  -> /implement-plan -> Execute per module
  -> /verify-implementation -> Verify playbooks
  -> /commit
```

Note: `/blueprint --verify` runs automatically after generation unless `--no-verify` is specified.

## Key Differentiators vs /plan

| Aspect | /plan | /blueprint |
|--------|-------|------------|
| Input | User idea | Planning doc |
| Output | Single plan | Three-layer + registry |
| Depth | Phase-level | Module-level: arch + code + verification |
| Parallelism | Sequential | Workstreams, locked contracts, stubs |
| Tracking | None | Registry: status, gates, deviations |
| Context | Load entire plan | Manifests — only what's needed |
| Self-Audit | None | --verify mode |
