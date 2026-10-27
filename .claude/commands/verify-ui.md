---
description: Verify a UI implementation against its wireframes and mockups with real-browser screenshot pairs in each state. Fixes structure, copy, state and accessibility gaps (HIGH), logs the rest, and reports a compliance score that informs but never gates.
---
# Verify UI Command

Verification of UI implementation against approved wireframes and mockups. Visual parity is proven with **real-browser screenshot pairs** (`~/.claude/commands/_shared-ui-parity.md`), not by reading component code. Functional, accessibility and design-system checks complete the picture. Blocking follows `~/.claude/commands/_shared-triage.md`: a difference a user can see in structure, copy or state is HIGH and gets fixed; a few pixels of spacing is LOW and is logged. The compliance score is reported for trend, never used as a gate — re-running to raise a grade chases LOW items.

**When:** after every UI module (`/implement-plan` and `/implement-batch` run it, or its parity protocol, per screen). Size the pass by how much normal use the module touches: S (one screen), M (a flow), L (a whole area).

## Arguments
- `$ARGUMENTS` - Optional: specific component name, wireframe path, or keyword (`visual`, `accessibility`, `functional`, `design-system`, `all`)

## Workflow

Use TodoWrite to track progress. **Launch parallel agents for independent analysis phases.** After analysis, **automatically fix CRITICAL, HIGH and normal-use gaps** without asking for permission; log MEDIUM and LOW with reasons. At most 2 sweeps: analysis + fixes, then a re-check of the fixes only.

---

### Phase 1: Discovery and Asset Location

> **Project path resolution (read first).** The paths, file names and MUI checks below come from the project this
> command was written for (`admin-ui/`, `design/*/AdminUI/`). Resolve them per project:
> - **If `admin-ui/` exists**: use the paths as written.
> - **Otherwise**, discover from the repo:
>   - wireframes = `design/wireframes/<Feature>/NN_*.md`
>   - mockups = `design/mockups/<Feature>/*.html` (a shared `shared/` folder is not a feature)
>   - implementation = the web app's source (e.g. `apps/web/src/{routes,features,components}/**`)
>   - theme = the project's token file (e.g. `apps/web/src/theme/design-system.css`)
>   - tests = the web package's test script (e.g. `pnpm --filter @idn/web test`; Playwright via `pnpm test:e2e`)
> - **Component library**: verify against whatever the project's design-system doc names (e.g.
>   `design/wireframes/_design-system.md`, `_phase2-components.md`). Skip MUI-specific checks when MUI is not imported,
>   and score "Design System" against the project's own tokens and classes.
> - **Scope**: when invoked by `/implement-plan` for one module, verify only the screens that module's blueprint lists.

1. **Locate Design Assets**
   ```
   Wireframes: design/wireframes/AdminUI/*.md
   Expected: 01_dashboard.md, 02_cluster_detail.md, 03_scale_modal.md,
             04_schedule_editor_modal.md, 05_show_mode_panel.md, 06_audit_log.md

   Mockups: design/mockups/AdminUI/*.html
   Expected: 6 HTML files + index.html
   ```

2. **Locate Implementation Files**
   ```
   Pages: admin-ui/src/pages/*.tsx
   Components: admin-ui/src/components/*.tsx
   Shared: admin-ui/src/components/shared/*.tsx
   ```

3. **Load Existing Context**
   - Read `context/implementation/ui-mapping.md` (component registry)
   - Read `context/verification/ui-compliance-history.md` (if exists, for run counter and previous scores)

4. **Scope Filter** (if `$ARGUMENTS` provided)
   - Component name: Filter to matching wireframe and implementation files
   - `visual`/`accessibility`/`functional`/`design-system`: Run only that agent
   - Wireframe path: Verify only that wireframe's components

5. **Build Cross-Reference Matrix**
   Map each component to its design assets:
   ```
   | Component | Wireframe | Mockup | Implementation | Status |
   |-----------|-----------|--------|----------------|--------|
   | Dashboard | 01_dashboard.md | 01_dashboard.html | pages/Dashboard.tsx | Pending |
   | ClusterCard | 01_dashboard.md §3 | 01_dashboard.html | pages/Dashboard.tsx | Pending |
   | ScaleModal | 03_scale_modal.md | 03_scale_modal.html | components/ScaleModal.tsx | Pending |
   | ... | | | | |
   ```

6. **Output Discovery Summary**
   ```
   DISCOVERY: Wireframes: X/6 | Mockups: X/6 | Components: Y | History: [RUN #N / NEW]
   ```

7. **Prepare Agent Context**
   Compile context for parallel agents:
   - List of wireframe file paths to analyze
   - List of implementation file paths to verify
   - Design tokens and specifications from wireframes
   - Previous run score (if history exists) for delta calculation

---

### Phase 2: Parallel Analysis (Launch 4 Agents Simultaneously)

**Launch ALL 4 agents in a SINGLE message with multiple Task tool calls. Do NOT run sequentially.**

#### Agent 1: Visual Compliance Agent
```
Task: subagent_type: the project's UI or general-purpose agent (it must be able to run a browser)
Prompt: VISUAL PARITY IN A REAL BROWSER — follow ~/.claude/commands/_shared-ui-parity.md

MOCKUPS + STATES: [inject mockup paths and each mockup's state list from Phase 1]
APP ROUTES: [inject the route and the seed/fixture that reaches each state]
CROSS-REFERENCE: [inject matrix from Phase 1 step 5]

1. Run the app on your own port, seeded so each state is reachable.
2. For each screen and each key state, screenshot the mockup (?state=<s>) and the app in the
   same state, at 1440×900 unless the project sets another size. Save the pair under
   context/verification/parity/<screen>-<state>-{mockup,app}.png.
3. Compare each pair: structure, copy, state, missing or extra elements; check the wireframe's
   Information decisions table (nothing it omits is shown). Theme tokens, not colour literals.
4. Responsive: repeat the main state at each breakpoint the wireframe defines.

For each difference, output:
- VIS-XXX code
- Severity: a difference a user can see in structure, copy or state = HIGH;
  a few pixels of spacing or a shade = LOW; seeded-data differences are not findings
- Screenshot pair paths, and the file:line most likely responsible
- Required fix

No browser available → report VIS as NOT PROVEN (AUDIT-INCOMPLETE), never as a pass.
Output: Gap list as VIS-* codes with severity, the pair paths, plus total checkpoint count (pairs compared).
```

#### Agent 2: Functional Compliance Agent
```
Task: subagent_type: "code-reviewer"
Prompt: FUNCTIONAL COMPLIANCE VERIFICATION

WIREFRAMES: [inject list of wireframe paths from Phase 1]
IMPLEMENTATION: [inject list of component paths from Phase 1]
CROSS-REFERENCE: [inject matrix from Phase 1 step 5]

Verify all functional requirements from wireframes are implemented:

1. STATE IMPLEMENTATIONS: All wireframe states exist (Default, Loading, Error, Empty, etc.)
2. INTERACTIONS: Click handlers, navigation, modal triggers match interaction tables
3. DATA FLOW: API calls, hooks usage matches wireframe "Data Flow" sections
4. AUTO-REFRESH: 30s interval implemented for Dashboard
5. FORM VALIDATION: Real-time validation per wireframe specs
6. MODAL BEHAVIOR: Open/close, focus trap, escape key handling
7. NAVIGATION: Routes and navigation targets correct

For each gap, output:
- FUNC-XXX code
- Severity
- Wireframe requirement vs actual
- File:line location
- Required fix

Output: Gap list as FUNC-* codes, plus total checkpoint count.
```

#### Agent 3: Accessibility Compliance Agent
```
Task: subagent_type: "code-reviewer"
Prompt: ACCESSIBILITY COMPLIANCE VERIFICATION (WCAG AA)

WIREFRAMES: [inject list of wireframe paths from Phase 1]
IMPLEMENTATION: [inject list of component paths from Phase 1]
CROSS-REFERENCE: [inject matrix from Phase 1 step 5]

Audit WCAG AA compliance per wireframe accessibility sections:

1. ARIA ATTRIBUTES: role, aria-label, aria-describedby as specified
2. KEYBOARD NAVIGATION: Tab order, Enter/Space activation, Arrow keys
3. FOCUS INDICATORS: 2px outline on interactive elements
4. COLOR CONTRAST: 7:1 text, 4.5:1 UI components
5. TOUCH TARGETS: Minimum 44x44px
6. SCREEN READER SUPPORT: Announcements match wireframe specs
7. LIVE REGIONS: aria-live for dynamic content

For each gap, output:
- A11Y-XXX code
- Severity (CRITICAL for WCAG failures)
- Wireframe requirement vs actual
- File:line location
- Required fix

Output: Gap list as A11Y-* codes, plus total checkpoint count.
```

#### Agent 4: Design System Consistency Agent
```
Task: subagent_type: "code-reviewer"
Prompt: DESIGN SYSTEM CONSISTENCY VERIFICATION

IMPLEMENTATION: [inject list of ALL component paths from Phase 1]
THEME FILE: admin-ui/src/theme.ts (if exists)
DESIGN TOKENS: [inject design token values from wireframes]

Verify consistent use of design system across all components:

1. MUI COMPONENT USAGE: Correct MUI components per wireframe specs
2. THEME TOKENS: Using theme.palette/typography, not hardcoded values
3. DARK MODE SUPPORT: All components adapt to dark theme per wireframe section 8
4. CUSTOM STYLES: sx prop patterns consistent, no conflicting styles
5. COMPONENT PATTERNS: Shared components used consistently
6. ICON USAGE: Material icons as specified
7. LOADING/ERROR STATES: Consistent patterns (LoadingSpinner, ErrorBanner)

For each inconsistency, output:
- DS-XXX code
- Severity
- Expected pattern vs actual
- File:line location
- Required fix

Output: Gap list as DS-* codes, plus total checkpoint count.
```

**Wait for all 4 agents to complete before proceeding.**

---

### Phase 3: Score Calculation and Gap Consolidation

1. **Collect Agent Results**
   - Parse gap lists from all 4 agents
   - Extract checkpoint counts and gap counts per category

2. **Calculate Category Scores**
   ```
   For each category (VIS, FUNC, A11Y, DS):
     penalty = (CRITICAL*10 + HIGH*5 + MEDIUM*2 + LOW*0.5) / checkpoints * 100
     category_score = max(0, 100 - penalty)
   ```

3. **Calculate Overall Score**
   ```
   overall_score = (VIS*0.30) + (FUNC*0.30) + (A11Y*0.25) + (DS*0.15)
   ```

4. **Assign Grade**
   - A: 95-100 (COMPLIANT)
   - B: 85-94 (MINOR GAPS)
   - C: 70-84 (GAPS EXIST)
   - D: 50-69 (SIGNIFICANT GAPS)
   - F: 0-49 (NON-COMPLIANT)

5. **Calculate Delta** (if previous run exists)
   - Read previous score from history file
   - delta = current_score - previous_score

6. **Merge and Deduplicate Gaps**
   - Combine all gaps (VIS-*, FUNC-*, A11Y-*, DS-*)
   - Remove duplicates
   - Final severity: CRITICAL > HIGH > MEDIUM > LOW

7. **Calculate Per-Component Scores**
   - Group gaps by component
   - Calculate individual component scores

8. **Blocking set (triage, not score)**: blocking = CRITICAL + HIGH + anything that breaks normal use (`_shared-triage.md`). The score and grade are reported for trend only; they never decide whether the module passes.

9. **Output Score Summary**
   ```
   SCORE: [X.X]% [Grade] | VIS: [Y]% | FUNC: [Z]% | A11Y: [W]% | DS: [V]%
   GAPS: [N] total (CRITICAL: X, HIGH: Y, MEDIUM: Z, LOW: W)
   DELTA: [+/-X.X] from Run #[N-1]
   ```

---

### Phase 4: Remediation Planning

1. **Prioritize Fix Queue**
   - Sort: CRITICAL first, then HIGH, MEDIUM, LOW
   - Within same severity: A11Y > FUNC > VIS > DS

2. **Identify Dependencies**
   - Gaps in shared components affect multiple places
   - Theme changes affect all components

3. **Group Independent Fixes**
   - Identify gaps that can be fixed in parallel
   - Group by file for efficient editing

---

### Phase 5: Automated Remediation (Fix Blocking Gaps)

**Proceed through blocking fixes autonomously in priority order. Do NOT ask for permission.**

1. **Fix CRITICAL Gaps (Sequential)**
   For each CRITICAL gap:
   - Read the affected file(s)
   - Implement the fix per wireframe spec
   - Run the tests selected for the changed files (`_shared-test-selection.md`; never a pass-with-no-tests setting, which turns an empty selection into a false green)
   - Mark gap as FIXED

2. **Fix HIGH and normal-use Gaps**
   Fix directly. Launch parallel fix agents only for large, independent fixes (`_shared-effort-budget.md`):
   ```
   Task: subagent_type: the project's UI implementation agent (e.g. "react-specialist"), else "general-purpose"
   Prompt: FIX GAP [GAP-ID]: [description]
   File: [path] | Line: [line]
   Wireframe Ref: [file.md] section
   Required fix: [detailed fix steps]
   Return: Modified code and change summary.
   ```

3. **MEDIUM and LOW Gaps: log, don't fix**
   Record each as DEFERRED with a reason and a revisit trigger (spacing, shades, minor token swaps).
   Exception: a missing ARIA attribute or keyboard path that blocks a user is an accessibility break — HIGH.

4. **Post-Fix Validation**
   Tests selected for the files the fixes changed (`_shared-test-selection.md`), once; then the web
   package's typecheck, lint and build. Fix any failures (max 3 attempts per failure).

5. **Track Progress**
   ```
   REMEDIATION: CRITICAL X/X | HIGH X/Y | MEDIUM X/Y | LOW X/Y (Z deferred)
   ```

---

### Phase 6: Verification Phase

1. **Re-check Fixed Gaps (sweep 2 — the last)**
   For each gap marked FIXED:
   - Re-take its screenshot pair and confirm the difference is gone
   - Verify the fix matches the wireframe spec
   - Mark as VERIFIED
   A blocking gap still open after this is reported open; do not start a third sweep.

2. **Regression Check**
   The selection for all files changed in this run (`test-select --since <start sha>`), once, plus the
   web package's typecheck and build. No broad tier; no pass-with-no-tests setting.

3. **Recalculate Score**
   - Recount gaps (only PENDING and DEFERRED remain)
   - Calculate new score

---

### Phase 7: Report Generation

Generate the final compliance report to `context/verification/ui-gap-report.md`:

```markdown
# VERIFY-UI COMPLIANCE REPORT

**Date**: [YYYY-MM-DD HH:MM UTC]
**Branch**: [git branch]
**Run**: #[N]

---

## Design Compliance Score

```
┌─────────────────────────────────────────────────────────────┐
│  DESIGN COMPLIANCE SCORE: [XX.X]%  [Grade]                  │
│  [████████████████████░░░░░░░░░░]                           │
│                                                              │
│  Trend: [↑/↓/→] [+/-X.X] from Run #[N-1]                    │
│  Target: 95% (Grade A) — [X.X] points to go                 │
└─────────────────────────────────────────────────────────────┘
```

### Category Breakdown

| Category | Score | Progress | Gaps (C/H/M/L) |
|----------|-------|----------|----------------|
| Visual (30%) | [X]% | [████████░░] | [0/0/0/0] |
| Functional (30%) | [X]% | [██████████] | [0/0/0/0] |
| Accessibility (25%) | [X]% | [███████░░░] | [0/0/0/0] |
| Design System (15%) | [X]% | [██████████] | [0/0/0/0] |

### Component Scores

| Component | VIS | FUNC | A11Y | DS | Overall |
|-----------|-----|------|------|-----|---------|
| Dashboard | [X]% | [X]% | [X]% | [X]% | [X]% |
| ClusterCard | [X]% | [X]% | [X]% | [X]% | [X]% |
| ScaleModal | [X]% | [X]% | [X]% | [X]% | [X]% |
| ScheduleEditor | [X]% | [X]% | [X]% | [X]% | [X]% |
| ShowModePanel | [X]% | [X]% | [X]% | [X]% | [X]% |
| AuditLog | [X]% | [X]% | [X]% | [X]% | [X]% |
| **AVERAGE** | [X]% | [X]% | [X]% | [X]% | **[X]%** |

---

## Analysis Summary

**Design Assets Analyzed**:
- Wireframes: X/6
- Mockups: X/6
- Components: X tracked

**Parallel Agents Executed**:
- [x] Visual Compliance Agent — [X]% ([N] gaps)
- [x] Functional Compliance Agent — [X]% ([N] gaps)
- [x] Accessibility Compliance Agent — [X]% ([N] gaps)
- [x] Design System Agent — [X]% ([N] gaps)

**Gap Summary**:
- CRITICAL: X | HIGH: X | MEDIUM: X | LOW: X | **TOTAL: N**
- By type: VIS ([X]), FUNC ([X]), A11Y ([X]), DS ([X])

---

## Remediation Results

**Fixed**: X/N (X%) | **Deferred**: X | **Pending**: X

**Validation**:
- Tests: [PASS/FAIL] ([X]/[Y])
- TypeCheck: [PASS/FAIL]
- Build: [PASS/FAIL]
- Lint: [PASS/FAIL]

---

## Verdict

**[Grade Emoji] [STATUS] — Grade [X] ([XX.X]%)**

[Action statement based on grade:
- A: Ready for release
- B: Address HIGH gaps before release
- C: Remediation needed before release
- D: Significant work required
- F: Major implementation gaps]

---

## Progression History (Last 5 Runs)

```
Run 1 ([date]): [X]% [G] [██████████░░░░░░░░░░]
Run 2 ([date]): [X]% [G] [████████████████░░░░] (+X.X)
Run 3 ([date]): [X]% [G] [██████████████████░░] (+X.X) ← Current

Total improvement: +[X.X] points over [N] runs
```

---

## Detailed Gap List

### CRITICAL Gaps
[List with format below, or "None"]

### HIGH Gaps
```
[A11Y-001] HIGH: Missing ARIA live region for show-mode status
  Location: admin-ui/src/components/ShowModePanel.tsx:45
  Wireframe: 05_show_mode_panel.md §Accessibility
  Spec: aria-live="polite" on status text
  Actual: No live region
  Fix: Add aria-live="polite" to status container
  Status: [FIXED/PENDING/DEFERRED]
```

### MEDIUM Gaps
[List with status]

### LOW Gaps
[List with status]

### Deferred Gaps
[List with reasons for deferral]

---
*Generated by /verify-ui Run #[N]*
```

---

### Phase 8: Context Sync

1. **Update Compliance History**
   Create or append to `context/verification/ui-compliance-history.md`:
   ```markdown
   # UI Design Compliance History

   ## Summary
   | Metric | Value |
   |--------|-------|
   | Total Runs | N |
   | Current Score | XX.X% |
   | Current Grade | [A-F] |
   | Best Score | XX.X% (Run #N) |
   | Total Improvement | +XX.X points |

   ## Run History
   | Run | Date | Branch | Score | Grade | VIS | FUNC | A11Y | DS | Gaps (C/H/M/L) | Delta |
   |-----|------|--------|-------|-------|-----|------|------|----|----------------|-------|
   | N | date | branch | X% | G | X% | X% | X% | X% | 0/0/0/0 | +X.X |

   ## Category Trends
   [Progression per category]

   ## Milestones
   - [x] Run X: Reached Grade B
   - [x] Run Y: Reached Grade A
   ```

2. **Update ui-mapping.md**
   - Update Status column: "Verified [date] [score]%"
   - Note any deviations discovered

3. **Commit Changes** (if fixes were made)
   Group related fixes into logical commits. Use HEREDOC for proper formatting:
   ```bash
   git add -A
   git commit -m "$(cat <<'EOF'
   fix(ui): address verify-ui gaps [GAP-IDs]

   Design compliance: [prev]% -> [curr]% (+[delta])
   - [GAP-001]: [fix summary]
   - [GAP-002]: [fix summary]



   Generated with [Claude Code](https://claude.ai/claude-code)

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```
   Do NOT push to remote.

4. **Summary to User**
   ```
   VERIFY-UI COMPLETE
   Score: [XX.X]% [Grade] ([+/-X.X] from Run #[N-1])
   Gaps: [N] found, [X] fixed, [Y] deferred
   Report: context/verification/ui-gap-report.md
   History: context/verification/ui-compliance-history.md
   ```

---

## Usage Examples

```bash
# Full UI verification (all components, all aspects)
/verify-ui

# Verify specific component
/verify-ui Dashboard
/verify-ui ScaleModal

# Focus on specific aspect only
/verify-ui accessibility
/verify-ui visual
/verify-ui functional
/verify-ui design-system

# Verify against specific wireframe
/verify-ui design/wireframes/AdminUI/03_scale_modal.md

# After a UI module lands (the score is tracked across runs for trend; it never gates)
/verify-ui Dashboard
```

---

## Score Reference

### Severity Weights
| Severity | Weight | Impact |
|----------|--------|--------|
| CRITICAL | 10 | Major penalty |
| HIGH | 5 | Moderate penalty |
| MEDIUM | 2 | Minor penalty |
| LOW | 0.5 | Minimal penalty |

### Category Weights
| Category | Weight | Focus Area |
|----------|--------|------------|
| Visual (VIS) | 30% | Layout, colors, spacing, dimensions |
| Functional (FUNC) | 30% | States, interactions, data flow |
| Accessibility (A11Y) | 25% | WCAG AA, ARIA, keyboard |
| Design System (DS) | 15% | MUI consistency, theming |

### Grade Scale
| Grade | Score | Status |
|-------|-------|--------|
| A | 95-100% | COMPLIANT - Ready for release |
| B | 85-94% | MINOR GAPS - Address before release |
| C | 70-84% | GAPS EXIST - Remediation needed |
| D | 50-69% | SIGNIFICANT GAPS - Major work required |
| F | 0-49% | NON-COMPLIANT - Substantial gaps |

---

## Integration

After running `/verify-ui`:
- CRITICAL, HIGH and normal-use gaps are fixed automatically (2 sweeps at most); MEDIUM and LOW are logged with reasons
- Screenshot pairs for every screen state checked are saved and listed in the report
- Tests, type-checking, and build are validated
- Fixes are committed locally (not pushed)
- Unfixable gaps are documented with reasons
- **Gap report created** at `context/verification/ui-gap-report.md` with full scoring
- **History updated** at `context/verification/ui-compliance-history.md` with run progression
- **ui-mapping.md updated** with verification timestamp and compliance score
- Do not re-run to raise the score; re-run when the UI changes

## Context Sync Notes

This command participates in the unified context lifecycle:
- **ui-gap-report.md** is the detailed output — full gap inventory, scores, remediation status
- **ui-compliance-history.md** is the cross-session tracker — progression over time, grade milestones
- **ui-mapping.md** receives verification status updates — component-level compliance
- **CLAUDE.md is NEVER auto-edited** — use `/optimize-context` to manually sync status if desired

## Related Commands

- `/design-ui` - Create wireframes and mockups (what /verify-ui validates against)
- `/verify-implementation` - Verify code logic (complementary to /verify-ui)
- `/implement-plan` - Build features (use /verify-ui after to check UI fidelity)
- `/commit` - Commit and push changes after verification
- `/optimize-context` - Deep clean context files, archive old reports
