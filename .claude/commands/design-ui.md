---
name: design-ui
description: Generate detailed wireframes (Markdown + ASCII) from architecture or implementation plans, and write each UI module's blueprint §4 and Design Sync table. Runs after the blueprint's contracts are LOCKED and before the UI module blueprints. Discovers and follows the project's existing design system, rules, and conventions automatically. Add --with-mockups to also generate interactive HTML/CSS/JS mockups. Add --verify to run a detailed audit and auto-fix pass on existing wireframes and mockups.
---
# Design UI

**Command**: `/design-ui [path-or-options]`

| Flag | Effect |
|------|--------|
| `<plan-path>` | Wireframes from specific plan |
| (none) | Auto-detect plan, wireframes only |
| `--with-mockups` | Wireframes + interactive HTML |
| `--mockups-only` | Mockups from existing wireframes |
| `--module <name or M-ID>` | Single module only |
| `--update` | Update wireframes from revised plan |
| `--verify` | Audit + auto-fix wireframes/mockups |
| `--guide` | Output Design Input Guide |
| `--areas=<n>` | Screens per area agent (default 3–6, grouped by module, then feature) |

**Mode detection**: Default = wireframes-only | `--with-mockups` = full | `--mockups-only` = mockups | `--verify` = verify

**Where it runs:** after `/blueprint` has LOCKED its central files and contracts (its Phase 3C), and before
the UI module blueprints are written. **The designer writes each UI module's §4 and its UI Design Sync table**
(Phase 6), once; the module's blueprint writer links §4 and never rewrites it. There is no separate sync or
re-sync step. With no blueprint set yet, design runs from the plan and Phase 6 is skipped; `/blueprint` later
calls `/design-ui --module <M-ID>` to write §4.

---

## Design Input Guide (`--guide`)

If `--guide`, print and stop:
```
REQUIRED: Architecture/implementation plan (.md). Use /plan to generate if needed.
RECOMMENDED: Design rules (*ui*rules*, *design*rules*), design system CSS, safety rules
OUTPUT: design/wireframes/{Feature}/*.md, design/mockups/{Feature}/*.html (with --with-mockups)
WORKFLOW: /plan → /blueprint (contracts LOCKED) → /design-ui (writes UI §4) → UI module blueprints → build
```

---

## Phase 1: Context Gathering

### 1A-B: Locate & Parse Plan
Find: `$ARGUMENTS` → `context/blueprints/blprnt-M*.md` → `context/plans/*.md` → `~/.claude/plans/*.md`
Extract: UI requirements (pages, modals, dialogs), user flows, state machines, data models, and from the plan's
MVP paragraph (§0): the acceptance scenario, the interaction model, the entry states and the UI words. With a
blueprint set, read the LOCKED contracts (`impl-contracts.md`) for the fields and refusals each screen shows.

### 1C: Discover Design Context
Limits: max 10 files/glob, 3 levels deep, early-exit after 3 format examples

| Discovery | Patterns |
|-----------|----------|
| Project overview | `CLAUDE.md`, `README.md`, `package.json` |
| UI brief | the profile's `docs.ui_brief` when set (`~/.claude/commands/_shared-project-profile.md`), else a UI section of CLAUDE.md or `design/**/*brief*.md` |
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
Document entry screen → transitions → error paths. Every screen in the acceptance scenario carries these
states, each one a row in its wireframe and a `?state=` in its mockup:

| State | Is |
|---|---|
| the scenario's own | each step of the acceptance scenario, in the plan's interaction model (e.g. streaming, job running, done) |
| entry: at rest | how the user finds the screen with nothing in progress |
| entry: after reload | what a refresh or a new session shows mid-task |
| empty | first use, nothing yet |
| loading | waiting on data |
| error | a failure the user can act on |
| refusal | the system says no: a permission, a limit, a rule or a validation refusal, in the user's words |

Other screens carry the states that apply. Interaction states (Hover, Focus, Active, Disabled) come from the
shared components.

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
- the shared patterns every screen reuses (navigation, confirms, empty, error and refusal states);
- the UI words from the plan's MVP paragraph, checked against the UI brief; screens use these words only.

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

Group screens into **areas of 3–6 screens**, by UI module where possible (so one designer owns each module's
§4), then by feature or flow, and launch one background agent per area. Use effort high (row "Design area: wireframes"; a project or user rule overrides), with no turn cap and no
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
In wireframes-only mode, each area agent then writes its modules' §4 (Phase 6).

---

## Phase 5: Mockups by area

**Full mode (`--with-mockups`) or mockups-only.** In mockups-only, read the existing wireframes first.
Use area agents as in Phase 4, but at effort medium (row "Design area: mockups"): a mockup renders
decisions its wireframe already made.

In full mode, the mockup area agent writes its modules' §4 (Phase 6) after its mockups. Each standalone HTML:
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
consistent (the UI words), every screen in `INDEX.md`, the brief's Omit tier respected. Areas written in
parallel drift; this catches it. It writes `context/implementation/ui-mapping.md` (one row per component), and
edits a §4 only where its own fix changes that screen.

### 5c: Accessibility check (once)
A **separate** agent from the ones that chose colours (row "Accessibility check"; the agent choosing colours
never signs off its own contrast) verifies AA contrast and keyboard completeness, **once per design set**: on
the mockups, or on the wireframes' token pairs and focus order in wireframes-only mode. It writes the
Accessibility row of each UI Design Sync table and its report path; its HIGH findings go to one fix agent, and
it is not re-run for them.

---

## Phase 6: Write the UI module's §4 and Design Sync table

**Skip when there is no blueprint set** (see "Where it runs"). Otherwise, for each UI module (master S5
`type: ui`), the last design agent for its area in this run (wireframes-only: the wireframe agent; full: the
mockup agent) writes §4 of `context/blueprints/blprnt-{M-ID}-{name}.md`, once. If the module file does not exist
yet, it creates it with only the header line and §4; the module's writer adds the rest around it.

**Link the wireframe; don't copy it.** Copied ASCII trees and style objects pushed module manifests past budget
(`_shared-effort-budget.md`: 14k tokens per module).

```markdown
## 4. UI (written by /design-ui)
### 4A. Component: {ComponentName}
**Source**: design/wireframes/{Feature}/{XX}_{component}.md (layout, Information decisions)
**Mockup**: design/mockups/{Feature}/{XX}_{component}.html — states: at-rest, after-reload, empty, loading, error, refusal, {scenario states}
**Show**: {item} · {item} — **On demand**: {item} — **Omitted**: {item}
**Words**: {the UI words this component shows}
| Property | Token | Source |
|----------|-------|--------|
| Background | --surface | mockup |
| Padding | --space-4 | wireframe §Layout |

### 4B. States
| State | Trigger | What the user sees |
|-------|---------|--------------------|
| at rest | no task in progress | — |
| after reload | refresh mid-task | {what survives} |
| empty | no items yet | {empty copy} |
| loading | awaiting data | {skeleton or progress} |
| error | request failed | {message, retry} |
| refusal | permission, limit or rule says no | {refusal copy, next step} |
| {scenario step} | {trigger} | {visual} |

Responsive: {breakpoint → change} · Accessibility: focus order {list}; ARIA {roles}; keyboard {keys}

### 4C. UI Design Sync
| Asset | Status | Written |
|-------|--------|---------|
| Wireframes | ✅ / ⚠️ Missing | [date, agent] |
| Mockups | ✅ / ⚠️ Missing / N/A | [date, agent] |
| §4 | ✅ Written | [date, agent] |
| Accessibility | ✅ Checked / ⚠️ Findings open | [date, 5c report path] |
```

Tokens are **theme tokens**, never raw hex: map each value to the token the shared sheet defines; a value with
no token is a design-system gap to report, not a literal to copy. A UI module that also owns data keeps its
tables in §4D, which the module's writer owns. The impl spec's UI tasks are the module writer's: they link §4,
the wireframes and the mockup states.

**Documentation:** ensure `design/wireframes/{Feature}/README.md` exists; in full or mockups mode update
`design/mockups/INDEX.md` and verify cross-references.

---

## Phase 7: Verification & Quality

### 7A-D: Checks
| Check | Verify |
|-------|--------|
| Files | All planned files created |
| Design compliance | Uses design system consistently, touch targets |
| Safety | Content constraints, age-appropriate, data minimization |
| Accessibility | 5c's report: semantic HTML, ARIA, keyboard nav, color contrast 4.5:1, focus indicators, reduced-motion (not re-checked here) |
| States | every acceptance-scenario screen has the 2B-C states, each reachable with `?state=` |
| §4 | every UI module has §4 and a UI Design Sync table (Phase 6) |

---

## Verify Mode (`--verify` flag)

### VA: Asset Discovery
Catalog wireframes (`design/wireframes/**/*.md`), mockups (`design/mockups/**/*.html`), design rules.
If none found: abort, suggest running `/design-ui` first.

**Agents for verify mode** (`_shared-effort-budget.md`):
- **2 verifiers split by file ownership:** one for wireframes plus plan coverage, one for mockups. Never one agent per file.
- **The accessibility check is 5c's,** run once: reused here, and re-run only for mockups changed since it ran.
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

### VI: §4 findings
A verify finding against a UI module's §4 or its UI Design Sync table goes to the designer of that module
(`/design-ui --module <M-ID>`), which edits §4 in place. There is no separate sync step.

---

## Phase 8: Final Report

```
DESIGN UI REPORT
PROJECT: [name] | PLAN: [path] | MODE: [mode] | DATE: [timestamp]
Agents: Foundation ✓ | Areas X✓ Y⚠ | Consolidation ✓ | A11y ✓ (once)
(If an area agent failed: "Area {name} incomplete; re-run /design-ui --module {Feature}")

DELIVERABLES
  Wireframes: X files | Mockups: Z files (states reachable via ?state=) | Shared: N files | Docs: M files
  Brief: design/wireframes/_<set>-brief.md | Information decisions tables: X/X
  Screens: X (A pages, B modals, C dialogs) | States: Y (scenario + entry, empty, loading, error, refusal)
  §4 written: N/N UI modules | UI Design Sync tables: N

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
12. **Design writes UI §4, once** — after the contracts are LOCKED, before the UI module's blueprint; no sync step

---

## Usage Examples

```bash
/design-ui --with-mockups                     # Wireframes + mockups
/design-ui --mockups-only                     # Mockups from existing wireframes only
/design-ui --update                           # Update from revised plan
/design-ui --module M7                        # One UI module's screens and its §4
/design-ui --verify                           # Audit + auto-fix
/design-ui --guide                            # Show input guide
```
