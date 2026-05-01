---
description: Audit, optimize, and archive context files to maximize context window headroom. Works with any codebase.
---
# Optimize Context

Audit auto-loaded files, compress CLAUDE.md, path-scope rules, archive stale plans. Goal: maximize context window headroom.

## Arguments
- `$ARGUMENTS` - Flags: `--plans-age=N` (default: 30), `--docs-age=N` (default: 60), `--dry-run`, `audit` (Phase 1 only)

Use TodoWrite. **Never auto-edit CLAUDE.md or MEMORY.md** — show diffs, wait for confirmation.

Token heuristic: ~2.5 tokens/line (markdown), ~3.5 tokens/line (code).

---

## Phase 1: Measure Auto-Loaded Context (read-only)

These files consume tokens on EVERY session start.

### 1. CLAUDE.md Audit
- Find all CLAUDE.md + CLAUDE.local.md in hierarchy
- Count lines per file, identify sections by `##` headings
- **Flags**: sections >50 lines, duplicated in rules/, infrastructure docs, inline code examples, self-evident rules, linter-enforced rules
- **Target: <500 lines**

### 2. Rules Audit (`.claude/rules/*.md`)
- Count total lines, check for `paths:` YAML frontmatter
- Files WITHOUT path-scoping load unconditionally
- **Flags**: task-specific rules lacking scope, cross-file duplication

### 3. MEMORY.md Audit
- Path: `~/.claude/projects/*/memory/MEMORY.md` (first 200 lines auto-loaded)
- **Flags**: completed work references, outdated patterns
- Suggest topic files if dense

### 4. MCP Overhead
- Count configured servers (~500-2000 tokens each)

### 5. Output Summary
```
AUTO-LOADED CONTEXT AUDIT
Component              | Lines | Tokens | Status
CLAUDE.md              | XXX   | ~XXXX  | [OK/OVER]
Rules (N files)        | XXX   | ~XXXX  | [N unconditional]
MEMORY.md              | XXX   | ~XXXX  | [OK/OVER 200]
MCP (N servers)        | -     | ~XXXX  |
TOTAL                  |       | ~XXXX  | TARGET: 3000-4000
```

If `audit` argument → stop here.

---

## Phase 1.5: Implementation Context Health

Skip if `context/implementation-status.md` doesn't exist.

| Check | Action |
|-------|--------|
| Status freshness | Verify "Complete" modules exist, "In Progress" branches exist |
| Plan freshness | Check Session Resume Context dates (>14 days = stale) |
| MEMORY.md relevance | Verify `[module]:` prefix paths still exist |

**Output**: Stale entries to prune (require confirmation).

---

## Phase 2: Propose CLAUDE.md Compression

Do NOT edit — show proposals.

### Extractable Sections → Skills
```
EXTRACT: "## Section" (XX lines) → .claude/skills/<name>/SKILL.md
SAVINGS: ~XXX tokens/session
```

### Removable Duplication
```
DUPLICATE: "## Section" (XX lines) ALREADY IN .claude/rules/<file>.md
REPLACE WITH: "See .claude/rules/<file>.md" (1 line)
```

### Replaceable Code Examples
```
REPLACE: Code block (XX lines) WITH: "See @path/to/file.ts:NN"
```

### Compact Instructions (suggest if missing)
```markdown
## Compact Instructions
When using /compact, preserve: current task, modified files list, decisions made, test commands, errors being debugged, schema changes, env config discovered
```

**Output**: Before/after summary → wait for confirmation.

---

## Phase 3: Optimize Rules Files

1. **Path-scoping proposals**:
   ```
   File: .claude/rules/<name>.md (currently: UNCONDITIONAL)
   Proposed: paths: ["src/**/*.ts"]
   ```

2. **Cross-file duplication**: Keep in one, remove from others

3. **Suggest merges**: Small related files (<30 lines each)

Show proposals, apply after confirmation.

---

## Phase 4: Find Wayward Files

Scan for stray .md files outside expected locations (docs/, .claude/, README.md, etc.).

For each: `File: path (XX lines) | Content: [brief] | Action: Move to docs/ | docs/archive/ | context/sessions/ | Delete`

Show table, confirm before moving.

---

## Phase 5: Archive Old Content

Lower priority (not auto-loaded), but keeps workspace clean.

| Location | Criteria | Destination |
|----------|----------|-------------|
| ~/.claude/plans/ | >plans-age days | ~/.claude/plans/archive/ |
| docs/ | >docs-age + completion keywords | docs/archive/ |
| docs/archive/ | >180 days | Flag for manual deletion |
| context/sessions/ | >60 days | Propose archive/deletion |

**Output**: Archival summary → wait for confirmation.

---

## Phase 6: Generate Audit Report

Write to `context/sessions/context-audit-{YYYY-MM-DD}.md` (mkdir -p `context/sessions/` if needed):

```markdown
# Context Optimization Audit - {date}

## Auto-Loaded Context (Before / After)
| Component | Before | After | Saved |
|-----------|--------|-------|-------|

## Actions Taken
- Extracted N sections to skills
- Path-scoped N rules
- Archived N plans
- Moved N wayward files
- Pruned N stale MEMORY.md entries

## Session Tips
- /compact at ~70% (don't wait for 95%)
- /clear between unrelated tasks (most effective)
- Plan in one session, implement in another
- Use subagents for verbose operations
```

---

## Usage Examples

```bash
/optimize-context              # Full optimization
/optimize-context audit        # Read-only report
/optimize-context --dry-run    # Preview all changes
/optimize-context --plans-age=14 --docs-age=30
```

## Key Principles

- **Priority**: Auto-loaded first (CLAUDE.md > rules > MEMORY.md)
- **Safety**: Preview everything, confirm before acting
- **Skills over CLAUDE.md**: Extract infrastructure docs to on-demand skills
- **Path-scoped rules**: Non-universal rules get `paths:` frontmatter
- **Archive not delete**: Old files → archive/; >180 days → flag for manual review

## Related Commands

- `/implement-plan` - Auto-updates `context/implementation-status.md`
- `/verify-implementation` - Auto-updates plan file + status
- `/sync-context` - Keeps context accurate (complementary)
- `/compact` - Compress conversation mid-session
