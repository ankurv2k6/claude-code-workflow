---
description: Create a build-ready blueprint (architecture + implementation specs) from a planning document. Produces a three-layer system: architectural blueprints, code-level implementation specs, and a unified progress registry. Central files and contracts are written and LOCKED first, then module writers and design run in parallel; one verifier checks the set. Use --verify to audit all artifacts and get a ready score.
---
# Blueprint Command

Create a build-ready implementation blueprint from a planning/architecture document.

**Three-layer output**:
- **Layer 1 — Blueprints** (`context/blueprints/`): Architecture, module boundaries, verification playbooks
- **Layer 2 — Implementation Specs** (`context/implementation/`): Code-level details, TypeScript interfaces, algorithms
- **Layer 3 — Registry** (`blprnt-registry.md`): Progress tracking, stage gates, deviation log

## Arguments
- `$ARGUMENTS` - Path to planning doc or inline description
- `--verify` - Audit artifacts and produce a ready score (runs automatically after generation)
- `--no-verify` - Skip automatic verification after generation

## Who writes what

Agents per `_shared-effort-budget.md`, background, effort high, completion by notification (`_shared-agent-timeout.md`).

| Role | Writes | Starts when |
|---|---|---|
| **Central writer** (one agent) | master, `impl-contracts.md`, `impl-master.md`, registry | at once |
| **Module writers** (one per lane group of `impl-master` S1) | that group's module blueprints and impl specs | the central files are LOCKED (Phase 3C) |
| **Designer** (`/design-ui`) | each UI module's §4 and its Design Sync table | the central files are LOCKED; before that UI module's writer |
| **Verifier** (one) | findings only | every file is written |
| **Orchestrator** (you) | nothing in `context/blueprints/` or `context/implementation/` | — |

- **One writer per file.** No second agent rewrites a file another wrote; a finding goes back to that file's
  writer (resumed with `SendMessage` while it is addressable) or to one fix agent with the findings.
- **The orchestrator never writes blueprint files.** It launches, reads hand-backs, runs the scripts in Phase 3B
  and 7B, and records the result.
- Each writer returns at most 30 lines plus the paths it wrote.

## Assumptions & Constraints
- Small team (1-4), 4-12 weeks, MVP-first, clean separation, no premature optimization
- Prefer simplicity; single deployable unit; deterministic over probabilistic
- Design for parallel implementation; choose specific technologies with justification
- The blueprint covers the plan's MVP scope (its §0); After-the-MVP items go in master S12 only

## Context Optimization Rules

**Cross-Layer**: Blueprints = what/why; impl specs = how. Single source of truth: contracts in master S7 + `impl-contracts.md`. Every module starts with MUST LOAD / DO NOT LOAD manifest.

**Within-Layer**: Compact notation (`key: value`, tables over prose). Flow notation: `trigger -> step1 -> output`. Errors: table format. Decisions: one-liner. ASCII diagrams <15 lines. Cross-references over duplication. No boilerplate/changelog. Post-MVP in master S12 only.

**Size budgets** (checked by `wc -c` in Phase 7B):

| File | Budget |
|---|---|
| Module blueprint `blprnt-M*.md` | ≤ 25 KB |
| Impl spec `impl-M*.md` | ≤ 30 KB |
| `impl-contracts.md` | ≤ 40 KB |

A file over budget carries, under its title, `> Size: NN KB over the budget because [reason]`. Without that line
it is a HIGH finding; split the module or link the detail instead.

---

## Phase 1: Input Discovery & Context Gathering

1. **Locate Input**: `$ARGUMENTS` → `context/blueprints/blprnt-M*.md` → `context/plans/*.md` → `~/.claude/plans/*.md`
2. **Gather Context**: Read CLAUDE.md, package.json/go.mod, existing architecture docs, scan codebase patterns
3. **Read the profile** (`~/.claude/commands/_shared-project-profile.md`): detect and check it once. With a
   profile, the blueprint names gates from its registry (`gates`) by name, and test and build commands from
   `commands.*`. Without one, the blueprint names commands as written, as in v1.
4. **Extract Requirements**: functional, non-functional, personas, integrations, data model, deployment; the
   plan's MVP paragraph (acceptance scenario, interaction model, entry states, UI words) is binding
5. **Build Summary**: Input doc, system name, domain, requirement counts, stack (existing/GREENFIELD), complexity, profile (yes/no)

---

## Phase 2: Architecture Deep Thinking (central writer)

| Phase | Focus |
|-------|-------|
| 2A: Tech Stack | Evaluate 2-3 options per decision (weight: team familiarity, ecosystem maturity, MVP speed) |
| 2B: Module Boundaries | Single responsibility, public interface, hidden internals, independent testability |
| 2C: Dependency Graph | Map dependencies, resolve cycles, find foundation/leaf modules, critical path |
| 2D: Parallelization | Independent modules, merge points, contracts to lock upfront, stubs for parallel work |

---

## Phase 3: Central Files First (central writer)

### 3A: Master blueprint

Write to `context/blueprints/blprnt-master.md`.

| Section | Content |
|---------|---------|
| S1 | Executive summary: 3-5 sentences (pattern, tech, deployment, key decision) |
| S2 | Core design principles: 5-7 actionable, testable (PRINCIPLE/RULE/EXAMPLE/VIOLATION) |
| S3 | Tech stack matrix: per layer with chosen/alternatives/rationale/risks |
| S4 | System architecture: compact text diagram <15 lines |
| S5 | Module index: ID, module, responsibility, type (`ui` or not), priority, effort, owner, deps, plan file |
| S6 | Implementation order: 6A layered diagram, 6B dependency matrix, 6C phase table with parallelism |
| S7 | Shared contracts registry: contract, defined in, stability, producer, consumers, shape |
| S8 | Parallel implementation plan: workstreams with tasks, blocked by, produces, merge points |
| S9 | Critical path: longest chain, bottlenecks, mitigation, non-critical float |
| S10 | Milestone plan: weekly/phase with goal, modules, deliverables, done-when checklist |
| S11 | Risks: per severity (HIGH/MEDIUM/LOW) with probability, impact, mitigation, trigger |
| S12 | Post-MVP: scaling, out-of-scope, simplifications, rejected alternatives with trigger conditions |
| S13 | Regression matrix: policy, the test map (`context/testing/test-map.mjs`; create it from `~/.claude/templates/testing/` if absent), cross-package risks, the migration journal-order check. With a profile, the gates per stage are its `tiers.*`, named, not restated |
| S14 | Invariants and guardrails: the project's must-never-break rules (each one a CRITICAL finding in verification) and its hard guardrails (live services, protected records, credentials, deploy branches), referenced by section (the profile's `docs.invariants` and `docs.guardrails`, else CLAUDE.md), not copied. If CLAUDE.md has no `## Hard guardrails` section, propose one from `~/.claude/templates/CLAUDE-hard-guardrails.md` to the owner; never edit CLAUDE.md without confirmation |

### 3B: `impl-contracts.md` and `impl-master.md`

`mkdir -p context/implementation`

**`impl-contracts.md`**: single source of truth for TypeScript interfaces, Zod schemas, event types, and any
reach or permission table (who may call what). Code-level companion to master S7.
```markdown
## [N]. [Contract Group]
### [ContractName]
- Stability: LOCKED | DRAFT
- Producer: [M-ID] | Consumers: [M-IDs]
[Full TypeScript interface + Zod schema]
```

**LOCKED** = 3 or more consumers, or part of a contract-first cycle between modules. LOCKED sections land as code in **Phase 0** before any lane starts, so consumers build against them instead of waiting for the producer. Their hashes go in the registry's Frozen Schema Watch.

**`impl-master.md`**:

| Section | Content |
|---------|---------|
| S1 | **Lane map** for `/implement-batch`. **C0, Phase 0:** every LOCKED contract as code, plus every S5 stub. **C0-UI, when there are UI modules:** the theme port, every component used on 2+ screens, shared navigation, with their prop signatures. **Other lanes:** group modules that share files, at most 3 modules or about 8 screens each. Per lane: modules in order, inputs it waits on, all merged before it launches (C0's contracts and stubs, or a sibling lane; never a sibling's unmerged code), worktree and branch name, test DB prefix, merge order |
| S2 | Contract index: contract, section ref, producer, consumers, status |
| S3 | Shared infrastructure patterns (defined once, referenced by specs), incl. shared UI component props |
| S4 | Cross-cutting decisions: error handling, naming, file org, imports |
| S5 | Stub definitions for parallel work with replace instructions (written into each stub as a code comment) |
| S6 | Merge checklist: migration renumbering after merged ones + journal-order check, lockfile by reinstall, conflict-touched suites. With a profile: its `tiers.merge` gates, by name |
| S7 | Module implementation order |

**Registry**: write `context/blueprints/blprnt-registry.md` (template in Phase 6) with every module PENDING.

### 3C: Lock and check (orchestrator runs scripts, never edits)

1. **Lock.** The central writer marks the contracts LOCKED and records their hashes in the registry's Frozen
   Schema Watch. Module writers and the designer start only after this.
2. **Reach or permission walk.** When the profile's registry has a `reach-walk` gate (`gates.reach-walk`), run it
   over the LOCKED reach and permission tables; its output goes to the verifier. A walk found the reach defects
   that a reading of the same tables missed. No gate named: the verifier reads the tables (v1).
3. **Caller list.** When the registry has a `caller-list` gate (`gates.caller-list`), run it for every shared
   symbol a module will modify; the list goes into that module's impl spec §7 so its tests cover the callers.
   No gate named: module writers list callers with a search (v1).

**State is on disk:** if your context is summarized, re-read `blprnt-master.md` and the registry's Frozen Schema
Watch to see whether the lock is done, then continue to Phase 4.

---

## Phase 4: Module Blueprints and Impl Specs (module writers, in parallel)

Launch one module writer per lane group of `impl-master` S1, in one message, once 3C is done. Each writes its
modules' blueprint and impl spec together, from the LOCKED contracts; it never edits a central file (a contract
gap goes back to the central writer). **UI modules:** run `/design-ui` for them at the same time (the designer
writes §4, `design-ui.md` Phase 6); that module's writer starts after its §4 exists and links it, never rewrites it.

### 4A: Module blueprint

Write to `context/blueprints/blprnt-[M-ID]-[module-name].md`. Architecture specs only — no code details.

```markdown
# Module Plan: [M-ID] -- [Module Name]
> Master: blprnt-master.md S5 | Impl: impl-[M-ID]-[name].md | Phase: X | Effort: Xd | Deps: [M-IDs] | type: [ui | —]

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
UI module: §4 is the UI section, written by /design-ui (§4A components, §4B states, §4C UI Design Sync
table); the data it owns moves to §4D.

## 5. Data Flow
[Op]: trigger -> step1 -> output | Errors: error -> handling

## 6. Implementation Plan
TASK [N]: [Name] ([Xd], blocked by [M-ID])
  Files: [paths] | AC: [criteria — REQUIRED per task, testable] | Impl: see impl-[M-ID] S4.[N]
  Migrations: named `<next>_<module>_<name>.sql` — numbered at merge, never fixed here

## 7. Verification Playbook
### 7A. Automated (exit 0) — targeted: name test files by path; with a profile, `commands.test_task` with `{files}` or a gate by name; never "npm test"
| # | Check | Gate or command | Timeout | Pass |
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
| Build chain | `commands.build` (profile) or the build command |
ALL pass -> PROCEED / BLOCK

## 13. Session Guide
1. LOAD: This + impl spec + contracts + master S7
2. PRE-FLIGHT: Run S12, STOP on failure
3. IMPLEMENT: Follow impl spec tasks
4. VERIFY: Run S7A-7E, fix failures
5. UPDATE: Registry, commit
```

**Manifest budget:** a module's MUST LOAD totals at most 14k tokens. UI detail goes in the wireframes, the impl spec and `ui-mapping`, linked from §4A, not pasted (`_shared-effort-budget.md`).

### 4B: `impl-[M-ID]-[module-name].md`
```markdown
# Implementation Spec: [M-ID] -- [Module Name]
> Blueprint: blprnt-[M-ID].md | Contracts: impl-contracts.md | Patterns: impl-master.md S3 | Anchors read at: [sha]

## 1. Context Manifest (matches blueprint S0)
## 2. File Map: | Order | Path | Anchor | Purpose | Creates/Modifies |
## 3. Dependencies Setup: exact import statements
## 4. Core Implementation
### 4.1 [filename]
- Path, Exports (full TS signatures), Logic, Error handling, Logging
- Edits to an existing file: `path/to/file.ts:120-148` — what changes there, one line per range
## 5. Data Structures (module-internal only)
## 6. Test Guide: | File | Covers | Mocks | Fixtures |
## 7. Integration Points (ref impl-contracts.md) and callers of each modified shared symbol (3C caller list)
## 8. Parallel Notes (stubs from impl-master S5)
```

**Anchors:** every Modifies row and every edit names a `file:line` range, read at the sha in the header, so a
lane opens the range instead of reading the whole file. A range that no longer matches at build time is
re-found by its surrounding symbol, and the lane logs a Deviation.

**State is on disk:** if your context is summarized, glob `context/blueprints/blprnt-M*.md` and
`context/implementation/impl-*.md` against master S5 to see which modules are written, then continue.

---

## Phase 5: Gate Dry Run (orchestrator, scripts only)

Every gate or command the blueprint names (module §7A, §7E, §12, master S13, impl-master S6, the registry's
Stage Gate Status) is dry-run now, not first at the batch's final.

- **With a profile:** each name must exist in the gate registry (`gates`), and each tier entry the blueprint
  cites must exist in `tiers.*`. Run `node $WORKFLOW_HOME/scripts/workflow/profile-check.mjs
  .claude/workflow-profile.json --smoke` for the `smoke: true` gates. For a gate that is not smoke-safe, check
  without running it: placeholders fillable, every script and path it names exists, every env var it reads is
  set or documented. Script absent: do the same checks by hand.
- **Without a profile:** dry-run each command as written: the same existence checks, and the cheap static ones
  (a lint, a grep, a journal check) run once on the current head.
- **A gate that matches nothing is red**, like one that exits non-zero: a grep or selector with an empty match
  checks nothing.

Record each result (name, exit code, date) in the registry's Stage Gate Status. A red gate goes back to the
writer of the file that names it.

---

## Phase 6: Registry Template

The central writer writes `context/blueprints/blprnt-registry.md` in 3B; module writers fill their rows:
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
| # | Gate | Status | Command or registry name | Last Run |

## Contract Compliance
| Contract | Section | Producer | Status | Consumers | Verified |

## Deviation Log (populated during implementation)
## Regression History
## Frozen Schema Watch
| Schema | Location | Hash | Verified | Status |
```

---

## Phase 7: Review & Finalization

### 7A: Writer self-review (each writer, on its own files)
- [ ] Single responsibility per module, no circular deps
- [ ] Tech choices justified, milestones are vertical slices
- [ ] Critical path identified with mitigation, 2+ parallel workstreams
- [ ] Contracts have producer + consumer, interfaces type-complete
- [ ] Playbooks name gates or commands that Phase 5 dry-ran; gate criteria reference 7A/B/C
- [ ] Registry counts match artifacts, frozen schema watch covers LOCKED contracts
- [ ] impl-contracts covers all S7 contracts, impl-master S5 defines stubs
- [ ] Context manifests within 14k tokens each, no duplication (UI detail linked, not pasted)
- [ ] Every task has its own acceptance criterion; §7A names test files by path
- [ ] Every edit to an existing file is anchored as a `file:line` range
- [ ] impl-master S1 lane map present (Phase 0 C0, C0-UI if UI, lanes ≤ 3 modules / ~8 screens)
- [ ] Migrations are placeholders numbered at merge; master S14 lists invariants and guardrails
- [ ] UI modules: §4 and the UI Design Sync table come from `/design-ui`

### 7B: Structural scripts (orchestrator)
Cross-refs exist, the S5 module count matches the files, sizes are within budget (`wc -c`, or justified),
frozen-schema hashes match, the journal check passes. Read the exit codes; do not re-read the files.

**Output**: print the manifest with totals and sizes.

---

## Phase 8: Auto-Verification

**Skip if**: `--no-verify` flag or `--verify` flag (already in verify mode).

After generation completes:
1. Print: "Running automatic verification..."
2. Use `Skill` tool: `skill: "blueprint"`, `args: "--verify"`
3. Display verification results (score, verdict, gaps)
4. If score <90: List critical/high gaps requiring attention

---

## Verify Mode (`--verify`)

Skip generation. Run comprehensive verification instead.

**One verifier, one round** (`_shared-effort-budget.md`, row "Spec verifier"):
- **One verifier agent** for the set, background, effort high, on the profile's `agents.verifier_model`
  (default Opus). It writes full findings to a scratch file and returns at most 30 lines plus the path. A set too
  large for one context budget splits by file ownership (central files · module files), still one round, never
  two agents on the same files.
- **Scripts first:** the Phase 7B scripts, the Phase 5 gate dry run, and the 3C walk and caller list when the
  profile names them. The verifier reads their output instead of re-deriving it.
- **The orchestrator** merges the findings and **checks any claim by running it before acting on it.** A
  verifier's "X is unsupported" is tested, not trusted. It never edits a blueprint file: each finding goes to
  that file's writer, or to one fix agent.
- **A second verify only checks a CRITICAL fix**: scoped to the fix's diff and the files it touches, after a
  CRITICAL was fixed. HIGH and lower fixes are not re-verified by an agent; Phase 7B's scripts re-run.

### Verify Phase 1: Artifact Discovery
Locate: `blprnt-master.md`, `blprnt-registry.md`, `blprnt-M*.md`, `impl-contracts.md`, `impl-master.md`, `impl-M*.md`
If master/registry missing: CRITICAL GAP.

### Verify Phase 2: Structural Integrity
| Check | Verify |
|-------|--------|
| Cross-refs | Every S5 module has blueprint + impl spec |
| Contracts | Every S7 contract in impl-contracts.md with producer + consumer |
| Dependencies | No cycles, all M-IDs exist, order matches impl-master S7 |
| Registry | Module count matches, gates dry-run green (Phase 5), frozen schema complete |
| Sizes | Within budget, or justified in the file |

### Verify Phase 3: Content Quality
| Check | Required |
|-------|----------|
| Module blueprints | S0 manifest, S1 responsibility, S2 interface, S7 playbook, S12 pre-flight |
| Impl specs | S1 manifest matches blueprint, S2 file map concrete with anchors, S4 full signatures, `file:line` edit ranges |
| Master | S3 justified, S5 complete, S7 stability status, S10 vertical slices |
| Cross-cutting | Effort sums match, milestones cover all, manifests ≤ 14k tokens, no placeholders |
| Reach and permissions | Every reach or permission row matches the walk's output (3C), or was read row by row when no walk exists |
| Batch readiness | impl-master S1 lane map (C0 Phase 0 when LOCKED contracts exist, C0-UI when UI modules exist, lanes ≤ 3 modules / ~8 screens, no lane waiting on a sibling's unmerged code); a per-task acceptance criterion; §7A test files named by path; migrations as `<next>_` placeholders; master S14 invariants and guardrails |

### Verify Phase 3b: UI Module Completeness (BLOCKING for UI Modules)

**Applies to** modules with `type: ui` in master S5. `/design-ui` writes these; the verifier checks them.

| Check | Gap if missing | Severity | Fix |
|---|---|---|---|
| Wireframes exist for every UI component the module lists | UI-WIREFRAME-MISSING | CRITICAL | `/design-ui --module <M-ID>` |
| Mockups exist (when mockups were requested) | UI-MOCKUP-MISSING | HIGH | `/design-ui --mockups-only --module <M-ID>` |
| §4 present: components linked to wireframes, theme tokens, the states (acceptance scenario's, plus entry, empty, loading, error, refusal), responsive, accessibility | UI-SECTION-INCOMPLETE | HIGH | the designer, `/design-ui --module <M-ID>` |
| UI Design Sync table present and ✅ for every required asset | UI-SYNC-MISSING | HIGH | the designer |
| Impl spec tasks reference §4's wireframes, mockup states and tokens | UI-IMPL-UNLINKED | HIGH | the module's writer |
| Accessibility check recorded once, by an agent other than the one that chose the colours | UI-A11Y-MISSING | HIGH | `/design-ui` Phase 5c |

A failing UI module is `NOT READY (UI-INCOMPLETE)` in the report's Critical/High gaps.

### Verify Phase 4: Gap Classification & Fixes
| Severity | Category | Fixed by |
|----------|----------|--------------|
| CRITICAL | Missing artifact | that file's writer |
| CRITICAL | Broken reference | the writer, or the fix agent |
| CRITICAL | UI-WIREFRAME-MISSING | the designer |
| HIGH | Missing section, over budget unjustified | the writer |
| HIGH | Contract mismatch | the central writer |
| HIGH | UI-* (Phase 3b) | the designer or the module's writer, as listed |
| MEDIUM | Incomplete section, placeholder | the writer; logged when not fixed |
| LOW | Style violation | logged |

Triage per `_shared-triage.md`: CRITICAL and HIGH are fixed; the rest is logged with a reason.

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
The verifier writes `context/blueprints/blprnt-verify-report.md`:
```markdown
# Blueprint Verification Report
Generated: [ISO] | Score: **XX/100** | Verdict: [READY/...] | Round: 1 [or 2: CRITICAL fix check]

## Score Breakdown
| Category | Score | Max | Issues |

## Fixes (by whom)
## Critical Gaps (MUST FIX)
## High Priority Gaps
## Module Readiness Matrix
| M-ID | Module | Blueprint | Impl | Contracts | Playbook | Size | Ready |

## Recommendation
[PROCEED / FIX AND CHECK THE CRITICAL FIX / MAJOR REWORK]
```

### Verify Phase 7: Console Output
```
BLUEPRINT VERIFICATION COMPLETE
Score: XX/100 | Verdict: [VERDICT]
Artifacts: N | Fixes: N | Gaps: N (Critical: N, High: N) | Gates dry-run: N green, M red
Report: context/blueprints/blprnt-verify-report.md
```

---

## Workflow Integration

```
[Planning Doc] -> /blueprint
  -> central writer: master, contracts, impl-master, registry -> LOCKED (+ walk, caller list)
  -> in parallel: module writers | /design-ui (UI §4) -> UI module writers
  -> gate dry run -> one verify (a second only to check a CRITICAL fix)
  -> /implement-batch or /implement-plan -> /verify-implementation -> /commit
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
