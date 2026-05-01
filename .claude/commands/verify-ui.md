---
description: Verify UI implementation against approved wireframes and mockups, identify gaps, auto-fix issues, and generate a design compliance report with scoring.
---
# Verify UI Command

Comprehensive verification of UI implementation against approved wireframes and mockups. Identifies visual, functional, accessibility, and design system gaps with automated remediation and compliance scoring.

## Arguments
- `$ARGUMENTS` - Optional: specific component name, wireframe path, or keyword (`visual`, `accessibility`, `functional`, `design-system`, `all`)

## Workflow

Use TodoWrite to track progress. **Launch parallel agents for independent analysis phases.** After analysis, **automatically fix all discovered gaps** without asking for permission.

---

### Phase 1: Discovery and Asset Location

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
Task: subagent_type: "code-reviewer"
Prompt: VISUAL COMPLIANCE VERIFICATION

WIREFRAMES: [inject list of wireframe paths from Phase 1]
IMPLEMENTATION: [inject list of component paths from Phase 1]
CROSS-REFERENCE: [inject matrix from Phase 1 step 5]

Compare each implemented component against its wireframe specifications:

1. LAYOUT STRUCTURE: Grid systems, spacing, dimensions match wireframe ASCII diagrams
2. TYPOGRAPHY: Font sizes, weights, colors per wireframe specs (h6=20px, body1=16px, etc.)
3. COLORS: Design tokens match (--color-primary: #1976d2, --color-success: #2e7d32, etc.)
4. SPACING: Material 8px baseline grid followed (spacing-xs=8px, spacing-sm=16px, etc.)
5. COMPONENT DIMENSIONS: Cards, modals, inputs match specified sizes
6. SHADOWS/ELEVATION: Material elevation values (elevation={2}, hover={4})
7. RESPONSIVE BREAKPOINTS: Desktop (>=1024), Tablet (768-1023), Mobile (<=767)

For each mismatch, output:
- VIS-XXX code
- Severity (CRITICAL/HIGH/MEDIUM/LOW)
- Wireframe spec vs actual implementation
- File:line location
- Required fix

Output: Gap list as VIS-* codes with severity, plus total checkpoint count.
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

8. **Output Score Summary**
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

### Phase 5: Automated Remediation (Fix All Gaps)

**Proceed through all fixes autonomously in priority order. Do NOT ask for permission.**

1. **Fix CRITICAL Gaps (Sequential)**
   For each CRITICAL gap:
   - Read the affected file(s)
   - Implement the fix per wireframe spec
   - Run tests: `cd admin-ui && npm test -- --passWithNoTests 2>/dev/null`
   - Mark gap as FIXED

2. **Fix HIGH Gaps (Parallel Where Possible)**
   Launch parallel Task agents for independent fixes:
   ```
   Task: subagent_type: "frontend-engineer"
   Prompt: FIX GAP [GAP-ID]: [description]
   File: [path] | Line: [line]
   Wireframe Ref: [file.md] section
   Required fix: [detailed fix steps]
   Return: Modified code and change summary.
   ```

3. **Fix MEDIUM Gaps**
   Implement directly:
   - Spacing/sizing adjustments
   - Missing ARIA attributes
   - Design system token replacements

4. **Fix LOW Gaps**
   Quick fixes only:
   - Skip anything requiring significant refactoring
   - Note as DEFERRED with reason

5. **Post-Fix Validation**
   ```bash
   cd admin-ui
   npm test -- --passWithNoTests 2>/dev/null
   npx tsc --noEmit 2>/dev/null
   npm run build 2>/dev/null
   npm run lint 2>/dev/null
   ```
   Fix any failures (max 3 attempts per failure).

6. **Track Progress**
   ```
   REMEDIATION: CRITICAL X/X | HIGH X/Y | MEDIUM X/Y | LOW X/Y (Z deferred)
   ```

---

### Phase 6: Verification Phase

1. **Re-check Fixed Gaps**
   For each gap marked FIXED:
   - Read the file, confirm the change exists
   - Verify the fix matches wireframe spec
   - Mark as VERIFIED

2. **Regression Check**
   ```bash
   cd admin-ui
   npm test -- --passWithNoTests
   npx tsc --noEmit
   npm run build
   ```

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

# Multiple runs for iterative improvement
/verify-ui  # Run 1: Score 72%
# ... fix some gaps manually ...
/verify-ui  # Run 2: Score 85% (+13)
# ... more fixes ...
/verify-ui  # Run 3: Score 95% (+10) - Grade A!
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
- All CRITICAL, HIGH, MEDIUM, and LOW gaps are fixed automatically
- Tests, type-checking, and build are validated
- Fixes are committed locally (not pushed)
- Unfixable gaps are documented with reasons
- **Gap report created** at `context/verification/ui-gap-report.md` with full scoring
- **History updated** at `context/verification/ui-compliance-history.md` with run progression
- **ui-mapping.md updated** with verification timestamp and compliance score
- Re-run `/verify-ui` for another pass if deferred gaps remain or to track score improvement

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
