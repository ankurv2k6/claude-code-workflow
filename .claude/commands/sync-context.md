---
description: Analyze codebase status and incrementally update context files. Uses git history for efficient delta-based syncing.
---
# Sync Context

Incrementally update context files (CLAUDE.md, context/implementation-status.md, blprnt-registry.md) based on git history. Uses delta-based syncing to minimize context usage.

## Arguments
- `$ARGUMENTS` - Flags: `--full` (ignore last sync), `--exhaustive` (deep codebase scan → CLAUDE.md enrichment), `--dry-run` (preview only), `--verbose`, `status` (show state only)
- **Precedence**: `status` > `--dry-run` > `--exhaustive` > `--full`

## State Tracking

File: `context/.sync-state.json` (gitignored, per-machine — add to `.gitignore` if not already)
```json
{"schemaVersion":1,"lastSyncCommit":"abc123","lastSyncBranch":"main","lastSyncTimestamp":"...","filesAnalyzed":42,"contextFilesUpdated":["CLAUDE.md"]}
```

**Branch validation**: If `lastSyncCommit` not in current branch ancestry → fall back to full mode.

---

## Phase 1: Determine Sync Scope

1. **Mode selection**: State file exists + no `--full` → incremental; otherwise → full rescan
2. **Get changed files** (incremental):
   ```bash
   git diff --name-only <lastSyncCommit>..HEAD  # Committed
   git diff --name-only                          # Unstaged
   git diff --name-only --cached                 # Staged
   ```
3. **Categorize changes**:
   | Category | Patterns | Impact |
   |----------|----------|--------|
   | Config | package.json, tsconfig.json, turbo.json | High |
   | Source | src/**, packages/**/src/** | Medium |
   | Tests | **/*.test.ts, **/*.spec.ts | Medium |
   | Docs | docs/**, *.md | Low |
   | Context | .claude/**, CLAUDE.md | Direct |

4. **Output**: `SYNC SCOPE: Mode [Incremental/Full] | Changed: N files (Config: X, Source: Y, Tests: Z)`

If `status` argument → stop here.

---

## Phase 2: Analyze Codebase State

Focus on changed areas:

| Check | Trigger | Action |
|-------|---------|--------|
| Project structure | Config changed OR full | Read package.json, count packages, detect stack |
| Implementation | Source changed | Count .ts files per package, check exports |
| Test coverage | Tests changed | Count test files, check vitest config |
| Recent activity | Always | `git log --oneline -10`, current branch |
| Build status | Config changed | Check dist/ existence |
| Blueprint registry | Source changed OR full | If `context/blueprints/blprnt-registry.md` exists, compare Module Status Table against `context/implementation-status.md`; flag modules where status disagrees |

**Output**: `PROJECT: <name> v<version> | Branch: <branch> | Packages: N | Source: NNN files | Tests: NN files`

---

## Phase 3: Identify Context Drift

Compare analysis with current context files.

| Check | Source of Truth | Context File | Drift Type |
|-------|-----------------|--------------|------------|
| Package list | packages/*/ | CLAUDE.md | STRUCTURE |
| Build commands | package.json scripts | CLAUDE.md | COMMANDS |
| Dependencies | package.json | CLAUDE.md | TECH_STACK |
| Module status | src/**/*.ts | context/implementation-status.md | STATUS |
| Module completion vs registry | context/implementation-status.md | blprnt-registry.md Module Status Table | REGISTRY |
| Architecture doc vs source | src/loop/**, src/codegen/**, src/config.ts | docs/architecture/*.md | ARCHITECTURE |

**Architecture document drift detection** (HIGH severity):
- If files in `src/loop/`, `src/codegen/`, `src/config.ts`, `src/backend/api/`, `src/logging/error-codes.ts` changed since last sync BUT `docs/architecture/` was NOT modified → flag as `ARCHITECTURE` drift
- Specific checks: new config parameters not in Appendix A, new error codes not in error taxonomy, new event types not in event catalog, new pipeline stages not documented
- Output: `ARCHITECTURE DRIFT: {N} source files changed, architecture doc not updated. Affected areas: [list]`

**Severity**: CRITICAL (structure mismatch) > HIGH (commands, registry mismatch, **architecture drift**) > MEDIUM (status) > LOW (deps)

**Output**: Drift report with items per severity level.

If `--dry-run` → show proposed changes and stop.

---

## Phase 4: Generate Update Proposals

1. **CLAUDE.md** (show diff, require confirmation):
   ```
   PROPOSED CLAUDE.md CHANGES
   @@ -15,6 +15,7 @@
   +└── ui/        # Vite + React 19 SPA (NEW)
   Apply? (y/n)
   ```

2. **context/implementation-status.md** (auto-update if exists): timestamps, branch, stale markers

3. **blprnt-registry.md** (if blueprint system exists and REGISTRY drift detected):
   - Cross-reference `context/implementation-status.md` module rows against registry Module Status Table
   - For each module where status disagrees (e.g., status file says COMPLETE but registry says PENDING): propose updating registry row with Status, Tests, Coverage, Last Updated
   - Also update YAML frontmatter `modules_complete` count if stale
   - Show diff, require confirmation (same as CLAUDE.md — never auto-edit)

4. **New entries**: Propose adding rows for packages with no status

---

## Phase 5: Apply Updates

1. **CLAUDE.md**: ALWAYS require user confirmation
2. **context/implementation-status.md**: Auto-update timestamps, branches
3. **blprnt-registry.md**: Apply confirmed registry updates (Module Status Table rows, YAML frontmatter counts)
4. **Update sync state**: Write new `lastSyncCommit`, timestamp, files analyzed
5. **Output**:
   ```
   SYNC COMPLETE: N files analyzed | CLAUDE.md (X lines) | status.md (Y rows) | registry.md (Z rows synced)
   Next sync from: <commit-sha>
   ```

---

## Phase 5b: Exhaustive CLAUDE.md Enrichment (`--exhaustive`)

**Only runs when `--exhaustive` flag is present.** Performs a deep scan of the entire codebase (ignoring `_archive/`, `_reference/`, `generated/`, `node_modules/`) and proposes additions to CLAUDE.md for information that is high-value for AI agents but currently missing.

### Extraction Categories

| # | Category | Source | What to Extract |
|---|----------|--------|-----------------|
| 1 | **Environment Variables** | `grep process.env.* src/**/*.ts` | All env vars with purpose. Group: Required (prod), Optional, Legacy/OpenClaw. Skip `VITEST`, platform vars. |
| 2 | **API Endpoint Map** | `src/backend/api/**/*.router.ts` | Method, path, auth requirement, brief purpose. Include both `/api/v1/*` and `/internal/*` routes. |
| 3 | **Middleware Chain** | `src/backend/server.ts` header comment + `app.use()` calls | Numbered order. Only update if chain changed since last exhaustive sync. |
| 4 | **Prisma Models** | `prisma/schema.prisma` (`^model `) | Compact grouped listing (Core, Infra, Auth). Fix stale counts in existing text. |
| 5 | **Error Code Categories** | `src/logging/error-codes.ts` | Category prefixes (AUTH_, DB_, LLM_, etc.) with count per category. Not individual codes. |
| 6 | **Design System Tokens** | `design/mockups/shared/css/design-system.css` `:root` block | Key color tokens (bg, text, accent), font vars, contrast note. Compact — not full CSS dump. |
| 7 | **Test Scripts** | `package.json` scripts matching `test` | All test-related scripts with target scope. Expand existing partial listing. |
| 8 | **Wireframe/Mockup Inventory** | `design/wireframes/*/`, `design/mockups/*/` | Module → file count mapping. Update "N specs across M modules" if stale. |
| 9 | **Doc Spec Index** | `docs/ui-ux/`, other new doc dirs | New directories not yet in Reference Documents section. Add as subsection. |
| 10 | **New Subsystem Details** | `src/agent/`, other new top-level src dirs | For completed phases not yet documented in CLAUDE.md. Brief architectural summary (like Browser Subsystem Key Details). |

### Extraction Rules

1. **Idempotent**: Skip categories already present and accurate in CLAUDE.md. Only propose additions/corrections.
2. **Compact**: Each category targets 5-15 lines. Total budget: ~100 lines / ~250 tokens.
3. **Placement**: Insert into existing sections where logical (e.g., env vars near Database section, API map near Dual-Plane Architecture). Create new subsections only for categories 9-10.
4. **Confirmation**: Show unified diff for all proposed CLAUDE.md changes. Require single y/n confirmation (not per-category).
5. **Ignore**: `_archive/`, `_reference/`, `generated/`, `node_modules/`, `design_1/`, test fixtures, `.env` files (never read secrets).

### Output
```
EXHAUSTIVE SCAN: 10 categories checked | N additions proposed | +M lines to CLAUDE.md
[Show diff]
Apply all? (y/n)
```

---

## Phase 6: Quick Size Check

Only if CLAUDE.md updated:
- Count lines, estimate tokens (~2.5/line)
- If >500 lines: `OVER LIMIT — run /optimize-context`

---

## Usage Examples

```bash
/sync-context                 # Incremental (default)
/sync-context status          # Show state only
/sync-context --dry-run       # Preview changes
/sync-context --full          # Force full rescan
/sync-context --exhaustive    # Deep scan → enrich CLAUDE.md with extracted codebase info
```

## Integration

| Command | Purpose | When |
|---------|---------|------|
| `/sync-context` | Keep context accurate | After features, before new work |
| `/optimize-context` | Reduce context size | When context feels heavy |

## Key Principles

- **Incremental by default**: Only analyze what changed
- **Git-aware**: Uses commit history for delta detection
- **Minimal updates**: Update only drifted items
- **Safe for CLAUDE.md**: Always show diffs, never auto-edit

## Error Handling

| Error | Recovery |
|-------|----------|
| No git repository | Abort |
| lastSyncCommit not found | Full mode fallback |
| CLAUDE.md missing | Create minimal template |
| No changes | Report "already synced" |
| Merge conflict | Abort — resolve first |
