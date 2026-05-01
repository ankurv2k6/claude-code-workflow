---
description: Optimize a plan document to remove duplication and improve information density without losing any knowledge.
---
# Optimize Plan

Compress a plan document by eliminating duplication, cross-referencing instead of restating, and collapsing verbose prose into tables — while preserving every unique data point.

## Arguments

| Flag | Effect |
|------|--------|
| `$ARGUMENTS` | Path to plan file. If omitted, search `context/plans/` and prompt user to select. |

## Phases Overview

```
Phase 1: Backup & Analysis
Phase 2: Systematic Compression
Phase 3: Validation
Phase 4: Report
```

Use `TodoWrite` to track progress through each phase.

---

## Phase 1: Backup & Analysis

1. **Resolve input**: If `$ARGUMENTS` is provided, use that file. Otherwise, glob `context/plans/plan-*.md` and `~/.claude/plans/plan-*.md`, then prompt the user to select one.
2. **Create backup**: `cp <file> <file>.bak`
3. **Read the entire file** and build a duplication map. Identify:

| Category | What to look for |
|----------|-----------------|
| **Duplicated content** | Sections restating the same facts, file lists, component descriptions, or architectural details in multiple places |
| **Verbose restatements** | Deliverable descriptions, phase summaries, or step details that re-explain things already covered in dedicated spec sections |
| **Mergeable sections** | Separate sections serving the same purpose (e.g., two action checklists, a priorities list and a quick wins list with overlapping items) |
| **Redundant tables** | Tables whose rows restate information from an adjacent ASCII diagram, code listing, or another table |

Record findings as a structured list: `[section number] → [duplication type] → [target section for merge/xref]`.

---

## Phase 2: Systematic Compression

Apply these techniques **in order**, one section at a time:

### 2.1: Cross-reference, don't restate
When a section restates details from a dedicated spec section, replace verbose prose with a compact summary + `See Section X` cross-reference. Keep only unique information (key design decisions, specific thresholds, constraints).

### 2.2: Compress prose to tables
When multiple subsections follow the same structure (component name → description → design decision), collapse them into a single table with columns for each dimension.

### 2.3: Deduplicate inventory lists
When file lists, module inventories, or component catalogs appear in multiple sections, keep the most detailed version and replace others with `Full inventory: Section X (N items)` cross-references.

### 2.4: Merge overlapping sections
When two sections serve the same purpose (e.g., priority checklist + quick wins), merge into one. Fold sub-items from the eliminated section into their parent items in the surviving section.

### 2.5: Remove redundant companion tables
When a table restates what an adjacent ASCII diagram or code block already shows, remove the table.

### Compression Rules (apply throughout Phase 2)

**NEVER delete**:
- Unique information — specific values, thresholds, formulas, design constraints, rationale, technical decisions
- ASCII diagrams, code blocks, or TypeScript interfaces
- Detailed spec sections (these are "sources of truth" that cross-references point to)

**NEVER renumber sections** — cross-references depend on stable section numbers.

**Compress ONLY**: summary/overview sections, deliverable lists, phase descriptions, inventory duplicates.

**When shortening a description, preserve**: component name, key design constraint (e.g., "no AST manipulation", "deterministic pure function"), and any specific numeric values.

---

## Phase 3: Validation (mandatory)

Compare the optimized file against the `.bak` backup:

1. For EACH compressed area, verify every specific data point from the original exists in the optimized file — either inline or reachable via cross-reference.
2. Flag any information that is truly LOST (not just reformulated or moved).
3. **Restore any lost items** to the optimized file immediately.
4. Collect metrics:
   - Original line count → optimized line count (reduction %)
   - Number of compression edits applied
   - Number of items restored after validation
   - Confirmation that zero knowledge was lost

---

## Phase 4: Report

Present to the user:

### Compressions Applied

| # | Area (Section) | Technique | What Changed |
|---|---------------|-----------|-------------|
| 1 | ... | Cross-ref / Table / Merge / Dedup / Remove | ... |

### Validation Report

| Metric | Value |
|--------|-------|
| Original lines | N |
| Optimized lines | N |
| Reduction | N% |
| Compression edits | N |
| Items restored | N |
| Knowledge loss | None confirmed |

### Cleanup

After the user confirms the result, delete the `.bak` file. If the user wants to revert, restore from `.bak` and delete the optimized version.
