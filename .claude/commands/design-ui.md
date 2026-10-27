---
name: design-ui
description: Generate detailed wireframes (Markdown + ASCII) from architecture or implementation plans. Discovers and follows the project's existing design system, rules, and conventions automatically. Add --with-mockups to also generate interactive HTML/CSS/JS mockups. Add --verify to run a detailed audit and auto-fix pass on existing wireframes and mockups.
---
# Design UI

**Command**: `/design-ui [path-or-options]`

| Flag | Effect |
|------|--------|
| `<plan-path>` | Wireframes from specific plan |
| (none) | Auto-detect plan, wireframes only |
| `--with-mockups` | Wireframes + interactive HTML |
| `--mockups-only` | Mockups from existing wireframes |
| `--module <name>` | Single module only |
| `--update` | Update wireframes from revised plan |
| `--verify` | Audit + auto-fix wireframes/mockups |
| `--sync-blueprints` | Sync UI specs from wireframes/mockups back to blueprints |
| `--guide` | Output Design Input Guide |
| `--areas=<n>` | Screens per area agent (default 3–6, grouped by feature) |

**Mode detection**: Default = wireframes-only | `--with-mockups` = full | `--mockups-only` = mockups | `--verify` = verify | `--sync-blueprints` = enrich

---

## Design Input Guide (`--guide`)

If `--guide`, print and stop:
```
REQUIRED: Architecture/implementation plan (.md). Use /plan to generate if needed.
RECOMMENDED: Design rules (*ui*rules*, *design*rules*), design system CSS, safety rules
OUTPUT: design/wireframes/{Feature}/*.md, design/mockups/{Feature}/*.html (with --with-mockups)
WORKFLOW: /plan → /design-ui → review → /design-ui --with-mockups → test → iterate
```

---

## Phase 1: Context Gathering

### 1A-B: Locate & Parse Plan
Find: `$ARGUMENTS` → `context/blueprints/blprnt-M*.md` → `context/plans/*.md` → `~/.claude/plans/*.md`
Extract: UI requirements (pages, modals, dialogs), user flows, state machines, data models

### 1C: Discover Design Context
Limits: max 10 files/glob, 3 levels deep, early-exit after 3 format examples

| Discovery | Patterns |
|-----------|----------|
| Project overview | `CLAUDE.md`, `README.md`, `package.json` |
| Design rules | `**/*ui*rules*`, `**/*design*rules*`, `**/*style*guide*` |
| Safety rules | `**/*safety*rules*`, `**/*compliance*`, `**/*coppa*`, `**/*wcag*` |
| Design system | `**/shared/css/*.css`, `**/design/*.css`, `**/tokens/**` |
| Existing wireframes | `**/design/wireframes/**/*.md` (3 examples) |
| Existing mockups | `**/design/mockups/**/*.html` (3 examples, full/mockups mode only) |

### 1D: Build Summary
```
PROJECT: [name] | PLAN: [path] | MODE: [wireframes-only/full/mockups-only]
AUDIENCE: [persona] | Accessibility: [WCAG] | Device: [primary]
TOKENS: Colors [list] | Fonts [list] | Spacing [scale]
```

### 1E: Design Direction
- **System exists**: Use it
- **Partial**: Use what exists, note gaps
- **None**: Ask user via `AskUserQuestion`: style, color, font, device target. Generate `design/mockups/shared/css/design-system.css` in full mode.
- **Safety rules found**: Binding constraints on every design

---

## Phase 2: Design Analysis

### 2A: Screen Inventory
| # | Screen | Type | Audience | Device | States | Priority |

Types: Page, Modal, Dialog, Overlay, Toast, Sidebar, Drawer, Panel, Card, Section
Priority: P0 (critical), P1 (important), P2 (nice-to-have)

### 2B-C: User Flows & State Matrix
Document entry screen → transitions → error paths. Enumerate states per screen (Default, Loading, Error, Empty, Success, Disabled, Hover, Focus, Active).

### 2D-E: Responsive & Naming
Use existing breakpoints or defaults based on device target. Follow existing naming convention or default: `design/wireframes/{Feature}/01_screen.md`

### 2F: Checkpoint
Present inventory for confirmation. If plan path provided (autonomous), proceed without confirmation.

### 2G: The declutter brief (binding)
Before any screen, write `design/wireframes/_<set>-brief.md` (or extend the project's existing one):
- the owner's direction, in their words (audience, tone, "don't overload", reuse of the current style);
- **three tiers:** **Show** (the main information for this page's job), **On demand** (one deliberate
  action away: a drawer, a "Details" disclosure, a tooltip-free help line), **Omit** (not needed in
  this context);
- the shared patterns every screen reuses (navigation, confirms, empty and error states).

Every wireframe then carries an **Information decisions** table, one row per item considered:

| Item | Tier (Show / On demand / Omit) | Why, in this page's context |
|---|---|---|

Implementation adds nothing the table omits.

---

## Phase 3: Foundation first (shared assets)

**Full or mockups mode.** One agent, run before any screen agent (`_shared-effort-budget.md`, row "Design
foundation", effort high). It builds or extends:
- the shared sheet(s): reuse the project's design system (`design/mockups/shared/css/*.css`); create
  `design-system.css` only when none exists; never a second, competing sheet;
- shared chrome and UI scripts (navigation, drawers, confirms, state switching) and realistic fixtures,
  in `design/mockups/shared/js/`: vanilla JS with JSDoc, no frameworks.

Every screen then builds on these, so screens match each other by construction.

---

## Phase 4: Wireframes by area

See `_shared-autonomous.md`. **Skip in mockups-only mode.**

Group screens into **areas of 3–6 screens** by feature or flow, and launch one background agent per
area. Use effort medium (row "Design area"; a project or user rule overrides), with no turn cap and no
wall-clock timeout. Completion comes by notification (`_shared-agent-timeout.md`). Each agent reads the
brief and the foundation once, and reports in 15 lines or fewer.

Each wireframe includes:
1. **Header:** screen, feature, type, audience, WCAG, version, date.
2. **Information decisions table** (2G).
3. **Layout:** an ASCII diagram (`─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼`) with dimensions.
4. **Components:** ASCII sketches; specs (dimensions, padding, typography); all states.
5. **Responsive:** breakpoint changes.
6. **Accessibility:** WCAG level, contrast, keyboard navigation, ARIA, touch targets, focus indicators.
7. **Interactions:** a state transition table.
8. **Tokens:** references to CSS custom properties.

**Output:** `design/wireframes/{Feature}/{XX_screen}.md`, plus `design/wireframes/{Feature}/README.md`
per module. State lives on disk: if your context is summarized, glob the wireframes and continue.

---

## Phase 5: Mockups by area

**Full mode (`--with-mockups`) or mockups-only.** In mockups-only, read the existing wireframes first.
Use the same area agents and configuration as Phase 4.

Each standalone HTML:
- **Styling:** the project's own design-system sheet(s) and fonts from Phase 3. Add Tailwind only if the
  project already uses it.
- **States the browser can reach:** every state in the wireframe is selectable with `?state=<name>`, and
  the page lists its states (e.g. a `data-states` attribute or a states block). Design verify and
  implementation parity drive these (`_shared-ui-parity.md`).
- **Interactive JS:** validation (300ms debounce); button, loading and error states; modal and drawer
  management; transitions that respect `prefers-reduced-motion`.
- Responsive, matching the wireframe breakpoints.
- **Accessibility:** semantic HTML5, ARIA, keyboard navigation (Tab, Enter, Escape), focus trapping,
  skip-to-content.
- Realistic domain content, never lorem ipsum.
- Navigation to adjacent screens.

**Output:** `design/mockups/{Feature}/{XX_screen}.html`, `index.html`, `README.md`.

### 5b: Consolidation pass
One agent reconciles across areas: shared components used the same way, copy and terminology
consistent, every screen in `INDEX.md`, the brief's Omit tier respected. Areas written in parallel drift;
this catches it before `--sync-blueprints`.

### 5c: Accessibility check
A **separate** agent from the one that chose colours (row "Accessibility check") verifies AA contrast and
keyboard completeness on the mockups.

---

## Phase 6: Documentation

- **Wireframes**: Ensure `design/wireframes/{Feature}/README.md` exists
- **Mockups** (full/mockups): Update `design/mockups/INDEX.md`, verify cross-references

---

## Phase 7: Verification & Quality

### 7A-D: Checks
| Check | Verify |
|-------|--------|
| Files | All planned files created |
| Design compliance | Uses design system consistently, touch targets |
| Safety | Content constraints, age-appropriate, data minimization |
| Accessibility | Semantic HTML, ARIA, keyboard nav, color contrast 4.5:1, focus indicators, reduced-motion |

---

## Verify Mode (`--verify` flag)

### VA: Asset Discovery
Catalog wireframes (`design/wireframes/**/*.md`), mockups (`design/mockups/**/*.html`), design rules.
If none found: abort, suggest running `/design-ui` first.

**Agents for verify mode** (`_shared-effort-budget.md`):
- **2 verifiers split by file ownership:** one for wireframes plus plan coverage, one for mockups. Never one agent per file.
- **Plus the separate accessibility check** (5c).
- Background, no turn caps or timeouts, completion by notification (`_shared-agent-timeout.md`).
- Structural checks (file exists, every screen in `INDEX.md`, relative paths resolve) are a script, not an agent.

### VB: Plan Coverage Audit

Build Screen Registry from plan. For each feature folder, cross-reference: `COVERED | MISSING | STUB`. A screen with no Information decisions table is a STUB.

### VC: Per-File Deep Audit

An agent that cannot finish marks its remaining files `[AUDIT INCOMPLETE]`, with the partial findings it has, for manual review.

**Wireframes (.md)**:
| Check | Severity |
|-------|----------|
| Header present | WARNING |
| Information decisions table present (2G) | CRITICAL |
| ASCII diagram valid | CRITICAL |
| Component specs complete | WARNING |
| All states documented | WARNING |
| Responsive section | WARNING |
| Accessibility section | CRITICAL |
| No lorem ipsum | INFO |

**Mockups (.html)**:
| Check | Severity |
|-------|----------|
| Valid HTML5 | CRITICAL |
| ARIA labels | CRITICAL |
| Keyboard nav works | CRITICAL |
| Focus trapping | CRITICAL |
| Color contrast | CRITICAL |
| Loading/error states | WARNING |
| Every wireframe state reachable via `?state=` | CRITICAL |
| Uses the project's shared sheet, no competing styles | WARNING |
| prefers-reduced-motion | WARNING |
| Relative paths valid | CRITICAL |

### VD-E: Aggregate & Auto-Fix
Compile Issue Registry. Launch fix agents for CRITICAL/WARNING. Fix constraints: Don't change design intent, mark ambiguous as `MANUAL REVIEW NEEDED`.

### VF-G: Coverage Gaps & Post-Fix
Ask user about MISSING screens. Re-scan to confirm CRITICAL resolved.

### VH: Implementation Comparison (if the app implements these screens)

**Compare the running app with the mockups in a real browser**, per `~/.claude/commands/_shared-ui-parity.md`. Do not parse JSX against mockup HTML; that comparison passed defects that showed only in a browser.

For each mockup in `design/mockups/{Feature}/` with an implemented screen:
  1. No implementation found: report `IMPL-MISSING`.
  2. Otherwise, for each key state: screenshot the mockup (`?state=<s>`) and the app in the same state.
  3. Compare the pair:
     - structure and copy (`IMPL-STRUCT-*`);
     - states, missing or broken (`IMPL-STATE-*`);
     - spacing and shade (`IMPL-STYLE-*`, LOW).

**Output format**:
```markdown
| Screen | Mockup | States compared | Structure | States | Style | Pairs | Status |
|--------|--------|-----------------|-----------|--------|-------|-------|--------|
| Connect | 01_connect.html | 4 | ✅ | 4/4 | ✅ | parity/01-*.png | COMPLETE |
| Issue list | 02_issues.html | 3 | ✅ | 2/3 | ⚠️ LOW | parity/02-*.png | PARTIAL |
```

**Fix suggestions** (triage per `_shared-triage.md`):
- `IMPL-STRUCT-*` and `IMPL-STATE-*` are HIGH: give the missing element or state handler and its expected behaviour.
- `IMPL-STYLE-*` is LOW: log it, and suggest the theme token (never a hex literal).

### VI: Blueprint Enrichment Mode (`--sync-blueprints`)

When wireframes/mockups are finalized, sync UI specifications back to blueprints to ensure
implementation specs are complete and precise.

**Trigger**: `--sync-blueprints` flag OR automatic when `--verify` finds UI modules

**For each UI module (blueprint declares `type: ui`)**:

#### 1. Locate Blueprint Files
- Blueprint: `context/blueprints/blprnt-{M-ID}-{name}.md`
- Impl spec: `context/implementation/impl-{M-ID}-{name}.md`

#### 2. Extract UI Specifications from Wireframes
For each wireframe in `design/wireframes/{Feature}/*.md`:

**Parse and extract**:
- Component name and type (page, modal, card, etc.)
- ASCII layout structure → element hierarchy
- Dimensions (width, height, padding, margins)
- States enumerated (default, loading, error, empty, success, disabled)
- Responsive breakpoints
- Accessibility requirements (WCAG level, ARIA, focus order)
- Typography specs
- Color references

#### 3. Extract UI Specifications from Mockups
For each mockup in `design/mockups/{Feature}/*.html`:

**Parse and extract** (as **theme tokens**, never raw hex: map each value to the token the shared sheet defines; a value with no token is a design-system gap to report, not a literal to copy):
- Colour, spacing and type tokens used
- Font families, sizes, weights
- Border radii, shadows
- Transition/animation durations
- Interactive states (hover, focus, active styles)
- Z-index layering
- Icon references

#### 4. Update Blueprint §4 (Component Specifications)

Inject extracted specs into blueprint component section. **Link the wireframe; don't copy it.** Copied ASCII trees and style objects pushed module manifests past budget (`_shared-effort-budget.md`: 14k tokens per module); keep §4A to what implementation needs at a glance:

```markdown
### Component: {ComponentName}

**Source**: design/wireframes/{Feature}/{XX}_{component}.md (layout, Information decisions)
**Mockup**: design/mockups/{Feature}/{XX}_{component}.html — states: default, loading, error, empty

#### Show items (from the Information decisions table)
- {item} · {item} — On demand: {item} — Omitted: {item}

#### Design Tokens
| Property | Token | Source |
|----------|-------|--------|
| Background | --surface | mockup |
| Primary Text | --ink | mockup |
| Padding | --space-4 / --space-5 | wireframe §Layout |
| Border Radius | --radius-sm | mockup |

#### States
| State | Trigger | Visual Changes |
|-------|---------|----------------|
| default | initial | — |
| loading | isLoading=true | spinner, disabled inputs |
| error | hasError=true | red border, error message |
| empty | items.length===0 | empty state illustration |
| success | onSuccess | green checkmark, fade out |

#### Responsive
| Breakpoint | Changes |
|------------|---------|
| ≤480px | Stack vertically, full width |
| ≤768px | Reduce padding to 12px |

#### Accessibility
- WCAG AA contrast: verified
- Focus order: {list}
- ARIA: role="dialog", aria-modal="true"
- Keyboard: Tab navigation, Escape to close
```

#### 5. Update Implementation Spec §4 (Tasks)

For each component task, add precise implementation details:

```markdown
### Task 4.2: Implement {ComponentName}

**Wireframe**: design/wireframes/{Feature}/{XX}_{component}.md
**Mockup**: design/mockups/{Feature}/{XX}_{component}.html

**Implementation Requirements** (extracted from mockup):

1. Element Structure:
   - Root: `<div role="dialog" aria-modal="true">`
   - Header: `<header>` with close button
   - Body: `<div>` with form content
   - Footer: `<footer>` with action buttons

2. Styles: the shared components and theme tokens named in the blueprint's Design Tokens table. No colour literals.

3. States to Implement (each reachable in the mockup with `?state=`):
   - [ ] Default state
   - [ ] Loading state (spinner, disabled form)
   - [ ] Error state (error banner, field highlights)
   - [ ] Success state (checkmark animation, auto-close)

4. Interactions:
   - Hover / focus / disabled: as the shared components and tokens define them

**Completion Criteria**:
- [ ] All Show items from the Information decisions table present; nothing it omits
- [ ] Screenshot pairs (mockup vs app) match in every state above (`_shared-ui-parity.md`)
- [ ] All interactions work
- [ ] Accessibility verified
```

#### 6. Generate Mapping File

Create `context/implementation/ui-mapping.md`:

```markdown
# UI Component Mapping

| Component | Wireframe | Mockup | Blueprint | Impl Spec | Status |
|-----------|-----------|--------|-----------|-----------|--------|
| ConnectGitHub | 02_connect_github.md | 01_connect_github.html | blprnt-M9 §4.1 | impl-M9 §4.2 | ✅ Synced |
| IssueList | 03_linked_issues_list.md | 02_linked_issues_list.html | blprnt-M10 §4.1 | impl-M10 §4.3 | ✅ Synced |
| CreateModal | 05_create_issue_modal.md | 03_create_issue_modal.html | blprnt-M11 §4.2 | impl-M11 §4.4 | ⚠️ Partial |
```

#### 7. Validation

After enrichment, verify:
- [ ] All wireframe components have blueprint entries
- [ ] All mockup styles map to theme tokens in the blueprints (gaps reported, not copied as literals)
- [ ] Each UI module's manifest stays within budget (detail linked, not copied)
- [ ] All states from wireframes are listed in tasks
- [ ] No placeholder or TBD sections remain

**Output**:
```
BLUEPRINT ENRICHMENT REPORT
===========================
Module: M9 (ui-auth)
Wireframes analyzed: 2
Mockups analyzed: 2
Blueprint sections updated: 3
Impl spec tasks enriched: 4
Tokens mapped: 47 (gaps: 0)
States documented: 8

SYNC STATUS: ✅ COMPLETE
Blueprint now contains precise UI specifications from finalized designs.
```

**Error Handling**:
- Missing wireframe for component: WARN, create stub entry
- Mockup CSS parse error: WARN, include raw values
- Blueprint section not found: CREATE new section
- Conflicting values: WARN, use mockup as source of truth

---

## Phase 8: Final Report

```
DESIGN UI REPORT
PROJECT: [name] | PLAN: [path] | MODE: [mode] | DATE: [timestamp]
Agents: Foundation ✓ | Areas X✓ Y⚠ | Consolidation ✓ | A11y ✓
(If an area agent failed: "Area {name} incomplete; re-run /design-ui --module {Feature}")

DELIVERABLES
  Wireframes: X files | Mockups: Z files (states reachable via ?state=) | Shared: N files | Docs: M files
  Brief: design/wireframes/_<set>-brief.md | Information decisions tables: X/X
  Screens: X (A pages, B modals, C dialogs) | States: Y

COMPLIANCE: WCAG [level] | Breakpoints: [list]

VERIFY MODE (if applicable)
  Audited: X wireframes, Y mockups | Issues: A CRITICAL, B WARNING, C INFO
  Auto-fixed: A'/B'/C' | Manual review: [count]
  Coverage: N/M screens | Missing generated: [list]
  Incomplete audits: X files (if any)
```

---

## Key Principles

1. **Discover, don't assume** — adapt to project
2. **Wireframes-first** — mockups opt-in
3. **Follow conventions** — match existing patterns
4. **Design system reuse** — use existing before creating
5. **Accessibility always** — WCAG AA minimum
6. **Realistic content** — never lorem ipsum
7. **Standalone files** — each HTML works directly
8. **Safety-first** — compliance rules are non-negotiable
9. **Declutter by decision** — every item is Show, On demand or Omit, decided per page (2G)
10. **Foundation first, then areas** — shared sheets and chrome before any screen; one agent per area, not per screen
11. **States are addressable** — every state reachable with `?state=`, so parity can be proven in a browser

---

## Usage Examples

```bash
/design-ui --with-mockups                     # Wireframes + mockups
/design-ui --mockups-only                     # Mockups from existing wireframes only
/design-ui --update                           # Update from revised plan
/design-ui --verify --sync-blueprints         # Verify + sync UI specs to blueprints
/design-ui --guide                            # Show input guide
```
