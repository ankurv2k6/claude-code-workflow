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
| `--timeout=<seconds>` | Per-screen agent timeout in seconds (default: 90) |

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

---

## Phase 3: Wireframe Generation (Parallel)

See `_shared-autonomous.md`. **Skip in mockups-only mode.**

### Agent Configuration
```
run_in_background: true
max_turns: 15              # Prevents infinite loops per screen
timeout: 90000             # 90 seconds per screen (configurable via --timeout)
```

### Timeout & Collection Strategy

See `_shared-agent-timeout.md`. Command-specific settings:
- **AGENT_TIMEOUT**: 90000ms (90 seconds per screen, configurable via `--timeout`)
- **Total ceiling**: 180 seconds (or 2x screen count x timeout)
- **Recovery**: Timed-out wireframes saved with `_partial` suffix; re-run `/design-ui --module {Feature}` to regenerate

Launch parallel agents per screen. Each wireframe includes:
1. **Header**: Screen, feature, type, audience, WCAG, version, date
2. **Layout**: ASCII diagram (`─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼`) with dimensions
3. **Components**: ASCII, specs (dimensions, padding, typography), all states
4. **Responsive**: Breakpoint changes
5. **Accessibility**: WCAG level, contrast, keyboard nav, ARIA, touch targets, focus indicators
6. **Interactions**: State transition table
7. **Tokens**: CSS custom property references

**Output**: `design/wireframes/{Feature}/{XX_screen}.md`
Also generate `design/wireframes/{Feature}/README.md` per module.

**Context Compact**: If `--with-mockups` or `--mockups-only` is active: run `/compact`, glob `design/wireframes/{Feature}/*.md` to confirm wireframes complete; continue to Phase 4.

---

## Phase 4: Mockup Generation (Parallel)

**Full mode (`--with-mockups`) or mockups-only only.**

In mockups-only, read existing wireframes first.

### Agent Configuration (same as Phase 3)
```
run_in_background: true
max_turns: 20              # Mockups are more complex, allow more turns
timeout: 120000            # 120 seconds per mockup (longer than wireframes)
```

### Timeout Handling
See `_shared-agent-timeout.md`. Same strategy as Phase 3 with AGENT_TIMEOUT=120000ms.
Partial mockups saved with `_partial.html` suffix. Continue with completed mockups even if some timeout.

Each standalone HTML:
- Tailwind CDN, project fonts, design system CSS
- Interactive JS: validation (300ms debounce), button/loading/error states, modal management, transitions (respect prefers-reduced-motion)
- Responsive matching wireframe breakpoints
- Accessibility: semantic HTML5, ARIA, keyboard nav (Tab/Enter/Escape), focus trapping, skip-to-content
- Realistic domain content (never lorem ipsum)
- Navigation to adjacent screens, localStorage for state

**Output**: `design/mockups/{Feature}/{XX_screen}.html`, `index.html`, `README.md`

---

## Phase 5: Shared Assets

**Full/mockups mode only. Create only if needed.**

- New design system: `design/mockups/shared/css/design-system.css` with tokens, reset, typography, components
- Extensions: Follow existing structure, add only missing
- Shared JS: `design/mockups/shared/js/{module}.js` — vanilla, JSDoc, no frameworks

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

### VB: Plan Coverage Audit (Parallel)

**Agent Configuration**:
```
run_in_background: true
max_turns: 10
timeout: 60000  # 60 seconds for coverage audit
```

Build Screen Registry from plan. For each feature folder, cross-reference: `COVERED | MISSING | STUB`

**Timeout Handling**: If coverage audit times out, flag as `AUDIT-INCOMPLETE` and proceed with per-file audit.

### VC: Per-File Deep Audit (Parallel)

**Agent Configuration**:
```
run_in_background: true
max_turns: 15
timeout: 90000  # 90 seconds per file audit
```

**Timeout Handling**:
- Timed-out file audits marked as `[AUDIT INCOMPLETE]`
- Include partial findings captured before timeout
- Flag for manual review

**Wireframes (.md)**:
| Check | Severity |
|-------|----------|
| Header present | WARNING |
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
| prefers-reduced-motion | WARNING |
| Relative paths valid | CRITICAL |

### VD-E: Aggregate & Auto-Fix
Compile Issue Registry. Launch fix agents for CRITICAL/WARNING. Fix constraints: Don't change design intent, mark ambiguous as `MANUAL REVIEW NEEDED`.

### VF-G: Coverage Gaps & Post-Fix
Ask user about MISSING screens. Re-scan to confirm CRITICAL resolved.

### VH: Implementation Comparison (if src/components/ exists)

**Compare mockups against actual implementation:**

For each mockup in `design/mockups/{Feature}/`:
  1. Find corresponding component: `src/components/{Component}.tsx`
  2. If not found: report `IMPL-MISSING`
  3. If found, compare:

**Structure Check**:
- Parse mockup HTML structure
- Parse React component JSX
- Compare element hierarchy
- Report: `IMPL-STRUCT-*` for mismatches

**Style Check**:
- Extract inline styles and CSS classes from mockup
- Extract inline styles from React component
- Compare CSS values (colors, spacing, fonts)
- Report: `IMPL-STYLE-*` for mismatches (severity based on count)

**State Check**:
- List states from wireframe (default, loading, error, empty, success, disabled)
- Check if component handles each state
- Report: `IMPL-STATE-*` for missing states

**Output format**:
```markdown
| Component | Mockup | Structure | Styles | States | Status |
|-----------|--------|-----------|--------|--------|--------|
| ConnectGitHub | 01_connect_github.html | ✅ | ✅ | 4/4 | COMPLETE |
| IssueCard | 02_linked_issues_list.html | ✅ | ⚠️ 2 gaps | 3/4 | PARTIAL |
| CreateModal | 03_create_issue_modal.html | ❌ | - | - | MISSING |
```

**Auto-fix suggestions**:
- For `IMPL-STYLE-*` gaps: suggest CSS corrections with exact values from mockup
- For `IMPL-STATE-*` gaps: list missing state handlers with expected behavior

### VI: Blueprint Enrichment Mode (`--sync-blueprints`)

When wireframes/mockups are finalized, sync UI specifications back to blueprints to ensure
implementation specs are complete and precise.

**Trigger**: `--sync-blueprints` flag OR automatic when `--verify` finds UI modules

**For each UI module (M8-M12 typically)**:

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

**Parse and extract**:
- Exact CSS values (colors as hex, spacing in px/rem)
- Font families, sizes, weights
- Border radii, shadows
- Transition/animation durations
- Interactive states (hover, focus, active styles)
- Z-index layering
- Icon references

#### 4. Update Blueprint §4 (Component Specifications)

Inject extracted specs into blueprint component section:

```markdown
### Component: {ComponentName}

**Source**: design/wireframes/{Feature}/{XX}_{component}.md
**Mockup**: design/mockups/{Feature}/{XX}_{component}.html

#### Element Structure
```
{extracted ASCII hierarchy from wireframe}
```

#### Design Tokens
| Property | Value | Source |
|----------|-------|--------|
| Background | #FFFFFF | mockup line 45 |
| Primary Text | #2F3941 | mockup line 52 |
| Padding | 16px 20px | wireframe §Layout |
| Border Radius | 4px | mockup line 48 |

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

2. Exact Styles (from mockup):
   ```typescript
   const styles = {
     container: {
       backgroundColor: '#FFFFFF',
       borderRadius: '8px',
       boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
       maxWidth: '480px',
       padding: '20px 24px',
     },
     // ... all styles from mockup
   };
   ```

3. States to Implement:
   - [ ] Default state
   - [ ] Loading state (spinner, disabled form)
   - [ ] Error state (error banner, field highlights)
   - [ ] Success state (checkmark animation, auto-close)

4. Interactions:
   - Hover: button background #F8F9F9
   - Focus: outline 2px solid #1f73b7
   - Disabled: opacity 0.6, cursor not-allowed

**Completion Criteria**:
- [ ] All elements from mockup present
- [ ] All CSS values exact match
- [ ] All 4 states implemented
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
- [ ] All mockup styles are captured in impl specs
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
CSS properties extracted: 47
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
Agents: Wireframes X✓ Y⚠ Z✗ | Mockups X✓ Y⚠ Z✗
(If timeouts: "Partial files saved with _partial suffix. Re-run to complete.")

DELIVERABLES
  Wireframes: X files (Y partial) | Mockups: Z files (W partial) | Shared: N files | Docs: M files
  Screens: X (A pages, B modals, C dialogs) | States: Y

COMPLIANCE: WCAG [level] | Breakpoints: [list]

VERIFY MODE (if applicable)
  Audited: X wireframes, Y mockups | Issues: A CRITICAL, B WARNING, C INFO
  Auto-fixed: A'/B'/C' | Manual review: [count]
  Coverage: N/M screens | Missing generated: [list]
  Timeouts: X file audits incomplete (if any)
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

---

## Usage Examples

```bash
/design-ui --with-mockups                     # Wireframes + mockups
/design-ui --mockups-only                     # Mockups from existing wireframes only
/design-ui --update                           # Update from revised plan
/design-ui --verify --sync-blueprints         # Verify + sync UI specs to blueprints
/design-ui --guide                            # Show input guide
```
