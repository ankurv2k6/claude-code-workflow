---
description: Lifecycle-aware audit + centralized tracking of pending/blocked items across completed modules. Maintains a persistent registry (context/pending-items-registry.md) that tracks every gap from discovery → resolution → verification. Re-openable stubs, orphaned follow-ups, missing consumer wiring, and plan-only modules all flow through one registry so nothing rots in scattered plan/remediation files.
---

# Audit Pending Items

**Command**: `/audit-pending-items [focus] [flags]`

**What this skill does**:
1. **Analyze** — grep shipping source + scan blueprints + plan/remediation files to identify every gap (blocked stubs, orphaned follow-ups, missing wiring, plan-only modules).
2. **Track** — persist every gap in `context/pending-items-registry.md` with a stable ID, lifecycle state, owner, and re-open criteria. Re-running the skill detects state transitions (e.g., `BLOCKED → READY_TO_REOPEN` when the blocker lands) without losing manual edits.
3. **Remediate** — optionally drive Tier-1 items through to completion via `--remediate`, `--close`, `--assign`.

The registry is the **single source of truth** for every pending item. Scattered follow-ups across plan/remediation files are consolidated into it on every run; the skill is safe to run dozens of times.

---

## Registry File — `context/pending-items-registry.md`

Created on first run, updated in-place on subsequent runs. Lives alongside `implementation-status.md`; tracked in git (team-shared).

**Schema** (every item is a table row with a stable ID):

| Column | Purpose |
|---|---|
| `ID` | Stable ID — `GAP-<KIND>-<8char-hash>`. Hash = sha256 of `file:line:blocker` (or `source:slug` for non-source items). Same gap → same ID across runs. |
| `Kind` | `STUB` (TODO-STUB-BLOCKED in source) · `FOLLOWUP` (deferred item in plan/remediation) · `WIRING` (module built but not consumed) · `PLAN_ONLY` (plan exists, code doesn't) · `CONTRACT` (C<N> still PENDING/DRAFT) · `CONSTANT_DUP` (shared constant duplicated across packages) |
| `State` | `OPEN` · `BLOCKED` · `READY_TO_REOPEN` · `IN_PROGRESS` · `RESOLVED` · `VERIFIED` · `DEFERRED` · `WONTFIX` |
| `Title` | One-line human description |
| `Location` | `file:line` or `plan:section` |
| `Blocker` | Blocking module ID(s) or `—` |
| `Blocker Status` | `COMPLETE` / `PENDING` / `N/A` / `DEFERRED` |
| `Tier` | `1` (quick win) · `2` (next-module) · `3` (consolidation) · `4` (deferred) |
| `Owner` | Name/agent/`unassigned` — preserved across runs |
| `Discovered` | ISO date first added to registry |
| `Last Transition` | ISO date + `<from> → <to>` (e.g., `2026-04-13 BLOCKED → READY_TO_REOPEN`) |
| `Re-open Criteria` | What must be true to flip to `READY_TO_REOPEN` |
| `Resolution` | When `RESOLVED`/`VERIFIED`: commit SHA or PR link |
| `Notes` | Free-text — preserved across runs |

**State machine**:

```
               ┌──────────────┐
               │  DISCOVERED  │
               └──────┬───────┘
                      ▼
          ┌───────── OPEN ─────────┐
          │            │           │
          ▼            ▼           ▼
      BLOCKED      DEFERRED     WONTFIX
          │            │           │
     (blocker          │           │
      lands)           │           │
          ▼            │           │
   READY_TO_REOPEN     │           │
          │            │           │
          ▼            │           │
     IN_PROGRESS       │           │
          │            │           │
          ▼            │           │
       RESOLVED ───────┘           │
          │                        │
          ▼                        │
       VERIFIED ◄──────────────────┘
           (terminal)
```

---

## Arguments

- `$ARGUMENTS` — focus keyword or empty for full audit:
  - `stubs` — only TODO-STUB analysis (Phase 2)
  - `follow-ups` — only Sprint/plan-file sweep (Phase 4)
  - `wiring` — only consumer-wiring verification (Phase 5)
  - `contracts` — only cross-module contract PENDING check
  - `diff` — show only the transitions vs last run, not the full report

- `--dry-run` — analyze + diff without writing the registry
- `--verbose` — include every grep hit and line number (default: representative samples)
- `--since <date>` — only analyze items discovered after this date
- `--remediate [N]` — after analysis, delegate top-N `READY_TO_REOPEN` Tier-1 items to `/implement-plan`-style execution. Default N=3. Registry items flip to `IN_PROGRESS` during work.
- `--close <ID>` — verify a single item is resolved (re-grep the stub location; if gone, flip to `VERIFIED` with the HEAD SHA as resolution)
- `--assign <ID> <owner>` — set owner on a registry item
- `--defer <ID> [until <date>]` — flip an item to `DEFERRED`
- `--wontfix <ID> <reason>` — flip to `WONTFIX`

**Precedence**: `--close` > `--assign`/`--defer`/`--wontfix` > `--remediate` > analysis-only. Targeted mutations skip the full scan.

---

## Phase 1: Load Existing Registry

If `context/pending-items-registry.md` exists:
1. Parse every row into an in-memory map keyed by `ID`.
2. Capture manually-set fields: `Owner`, `Notes`, `Resolution`.
3. Note the `Last updated` timestamp + `Skill run count`.

If it does NOT exist:
1. First run — create an empty registry structure. Every item found in Phase 2-5 will be `DISCOVERED → OPEN` with today's date.

**Output**: `REGISTRY: <N> items loaded | Last run: <date> | Skill runs: <count>` (or `REGISTRY: new — first run`)

---

## Phase 2: Determine Completed Module Set

Read **all three** sources and reconcile — `implementation-status.md` can lag reality:

1. `context/implementation-status.md` — Module Status table — extract every M-ID with `✅ COMPLETE`, completion date, stub counts (A/B/M).
2. `context/blueprints/blprnt-registry.md` — cross-reference §7D gate status; modules marked complete here but missing from the status table are **status-lag** discoveries — flag as `RED_FLAG-STATUS-LAG`.
3. `git log --oneline -n 200 --grep="^\(feat\|fix\|impl\)" -- packages/` — scan for commit messages naming an M-ID that isn't in either doc (e.g., `M13DB`, `M3b` landing commits).
4. Filesystem sanity — for every M-ID claimed complete, verify the corresponding `packages/*/src/<module>/` directory exists and is non-trivial. Plan files with **no corresponding source directory** become `PLAN_ONLY` items (Phase 5).

**Reconciliation rule**: if any two of (status table, registry, git, filesystem) agree a module shipped, treat it as `COMPLETE` for blocker-status purposes and emit a `RED_FLAG-STATUS-LAG` item naming the doc that disagrees.

**Output**: `COMPLETED: <N> modules | Latest: <M-ID> (<date>) | Still pending: <list> | Status-lag disagreements: <list>`

---

## Phase 2.5: Enumerate Cross-Module Contracts

**Read `context/implementation/impl-contracts.md` in full** (often 4000+ lines — don't skim). This file is the authoritative contract registry.

For every `C<N>` found:
1. Extract: contract ID, symbol/shape, producing module, consuming module(s), current status (`LOCKED` / `PENDING` / `DEFERRED` / `DRAFT`), owning-plan section.
2. Tally by status: `LOCKED: N / PENDING: M / DEFERRED: K / DRAFT: L`.
3. Every `PENDING` or `DRAFT` contract whose producer is in the Phase 2 completed-modules set becomes a `GAP-CONTRACT-<hash>` item — shipped module, unshipped contract is a first-class gap.
4. Every `LOCKED` contract flows into Phase 6b (cross-check: is it actually exported in code and consumed?).

Capture the full contract table in memory for the registry's Contract Inventory section; it's too valuable to regenerate each run.

**Parallel read**: delegate the impl-contracts.md read to a dedicated Explore agent if >500 lines. Return: contract table + tallies only (not full prose).

---

## Phase 2.6: Extract Deviation Log

From `context/implementation-status.md` (section `## Deviations`), extract every per-module deviation. Deviations are decisions that weren't in the original plan — they are **hidden design debt** that future modules may contradict.

For each deviation:
- If the deviation mentions a specific module/file/threshold that was **lowered**, **deferred**, or **reconciled**, create a `GAP-FOLLOWUP-<hash>` with `Kind = FOLLOWUP`, `State = DEFERRED`, and `Notes = "deviation: <verbatim rationale>"`.
- Do NOT let deviations rot — they're the class of thing that looks fine until a new module relies on the original spec and breaks.

---

## Phase 3: Scan Shipping Source for TODO-STUB Markers

**Project-wide** — not just `src/`. Test files, scripts, and docs can carry blocked markers that block entire sprints (e.g., `tenant-isolation.test.ts:220` Redis stub).

```bash
# 3a — primary stub-marker scan (src + test + scripts, excludes dist/node_modules)
grep -rn "TODO-STUB-BLOCKED\|TODO-STUB-ACTIONABLE\|TODO-STUB-MVP" \
  packages/ \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --exclude-dir=dist --exclude-dir=node_modules

# 3b — canonical unblocker claim: if Phase 5 finds "TODO-STUB-BLOCKED(<M>)" in a plan/remediation/blueprint file, grep the actual source tree for that marker. Source is truth; docs lag.
grep -rn "TODO-STUB-BLOCKED(<M>)" packages/

# 3c — 501-route / NotImplementedError stubs (MVP-as-designed items still need tracking)
grep -rn "NotImplementedError\|throw.*not.*implemented\|statusCode:\s*501" \
  packages/*/src/ --include="*.ts" --exclude-dir=dist

# 3d — inline z.unknown() / any / as unknown shims that indicate contract-pending
grep -rn "z\.unknown()\|// @ts-expect-error.*stub\|TODO.*contract.*pending" \
  packages/*/src/ --include="*.ts" --exclude-dir=dist
```

For each match:
- Parse **blocker M-ID** from the marker (e.g., `TODO-STUB-BLOCKED(M07/M04)` → `[M07, M04]`).
  - Special non-module blockers: `OUT-<NAME>` (MVP), `<NAME>-contracts` (awaits contract freeze), `<NAME>-writeback` (awaits producer-side pipeline).
- Compute `ID = GAP-STUB-<sha256(file:line:blocker)[0:8]>`.
- Categorize by scope: `src` (shipping code) vs `test` (validation-only) vs `script` (dev-only). State-machine treats all three the same; Tier assignment de-prioritizes `test` / `script`.
- 501-route stubs get `Kind = STUB` / `State = DEFERRED` with blocker = owning feature-module; they're not bugs but must appear in the registry so nobody ships a client against them without a wiring decision.
- Cross-reference blocker(s) against Phase 2 completed-modules set:

| Blocker Status | Candidate State |
|---|---|
| All blockers ✅ COMPLETE | `READY_TO_REOPEN` |
| Some COMPLETE, some PENDING | `BLOCKED` (with partial-unblock note) |
| All PENDING | `BLOCKED` |
| Blocker is future module not yet planned | `BLOCKED` |
| `TODO-STUB-MVP` (never blocked) | `DEFERRED` (unless already `WONTFIX`) |

**Parallel delegation**: if repo has > 20 source files with stub markers, split by package (client vs server vs shared) across 2-3 Explore agents.

---

## Phase 4: Scan Per-Module Blueprints for Deferred Items

**Read EVERY** `context/blueprints/blprnt-*.md` (not just the completed ones — pending modules may contain blocker notes that matter). Also read `impl-master.md`, `impl-*.md` per module.

Extract:
- Stub counts from §7D gate row (cross-check against Phase 2 status table counts; mismatches → `RED_FLAG-STUB-COUNT-DRIFT`).
- `BLOCKED-BY:` / `waiting on` / `resolves when` annotations in deviation log.
- `DEFERRED` markers in acceptance criteria.
- `TODO-STUB-*` markers referenced in prose — these are doc-level claims, cross-check against Phase 3 source-tree truth.
- Per-module `D-<MID>-NN` deviation codes and `FEAS-*` feasibility notes.
- `OQ-<N>` open-questions tables.

Also run a **project-wide doc-level grep** for stub markers in blueprints/plans/remediation — `grep -rn "TODO-STUB" context/` — to catch items where the doc claims blocked but the source no longer carries the marker (or vice-versa).

Each unique item becomes `ID = GAP-FOLLOWUP-<sha256(module:slug)[0:8]>` with `Kind = FOLLOWUP`.

---

## Phase 5: Sweep Plan & Remediation Files + Reconcile Against Sprint N Table

```bash
ls context/plans/*.md context/remediation/*.md context/blueprints/blprnt-*.md
```

Grep each for:

| Pattern | Kind | Default State |
|---|---|---|
| `DEFERRED` / `DEFER TO SPRINT` | FOLLOWUP | `DEFERRED` |
| `TODO:` / `FIXME:` | FOLLOWUP | `OPEN` |
| `FOLLOW-UP:` | FOLLOWUP | `OPEN` |
| `POST-V1` / `V2+` | FOLLOWUP | `DEFERRED` |
| `RISK-NEW-\d+` / `RISK-\d+` | FOLLOWUP | `OPEN` |
| `OUT-OF-SCOPE` | FOLLOWUP | `WONTFIX` |
| `STUB-BLOCKED\((\w+)\)` | STUB | compute from blocker |
| `SPRINT\d+-[A-Z0-9-]+` (table IDs) | FOLLOWUP | map from cell text |

For any plan file whose corresponding module directory is missing (e.g., `plan-manifest-authoring-*.md` but no `packages/client/src/authoring/`), emit a `PLAN_ONLY` item. `ID = GAP-PLAN_ONLY-<sha256(plan-filename)[0:8]>`.

### Phase 5b — Sprint N Follow-up Reconciliation

The project's `implementation-status.md` carries a canonical "Sprint N Follow-ups" table. Items in plan/remediation/blueprint files that **should** be in that table but aren't are the highest-rot-risk class of gaps (they're one grep away from disappearing forever).

Process:
1. Parse the Sprint N Follow-ups table from `implementation-status.md` — collect every `SPRINT<N>-<ID>` row. Mark as `TRACKED`.
2. For every FOLLOWUP candidate discovered in Phase 4 or this phase, compute a slug and check whether a corresponding row exists in the tracked set (fuzzy-match on module + keyword).
3. Every **untracked** follow-up becomes a registry item with `Kind = FOLLOWUP`, extra field `Tracking = UNTRACKED_IN_STATUS_TABLE`. Tier = 3 (consolidation).
4. Emit a summary section in the report listing every untracked follow-up with a proposed `SPRINT<N>-<MODULE>-<SHORT-ID>` name so the user can copy-paste them into `implementation-status.md`.

This phase is the fix for "12 of 17 Sprint 2 follow-ups were rotting in plan files and nobody noticed" — the single highest-leverage pattern this skill catches.

---

## Phase 6: Consumer-Wiring Verification

For each completed module, grep expected consumers for **actual symbol imports** — don't trust status tables or blueprint claims. Each missing/partial wiring becomes a `WIRING` item. The check must be a positive grep hit for the symbol name AND the producing-package import, not just a comment or a test.

Per-row verification protocol:
- **Locate the produced symbol**: `grep -rn "export.*<symbol>" <producer-package>/src/`. If the symbol is absent, the producer itself has a hole — emit `GAP-CONTRACT-<hash>` instead of `GAP-WIRING-*`.
- **Locate the import**: `grep -rn "from.*<producer-package>" <consumer-path>` AND `grep -rn "<symbol>" <consumer-path>` — both must hit and be in the same file for ✅.
- **Partial**: symbol appears in a test but not in shipping src → ⚠️ (test-only consumer).
- **Not consumed**: neither hits, OR consumer still has a local reimplementation of the symbol → ❌ + emit `GAP-CONSTANT_DUP-<hash>` if a local copy exists.

| Produced By | Expected Consumer Grep | Item If Missing |
|---|---|---|
| `@<workspace>/contracts` shared constants (e.g., ID patterns, scoring tables) | `packages/<consumer>/src/**` imports from `@<workspace>/contracts` | `GAP-CONSTANT_DUP-<hash>` |
| `@<workspace>/contracts` endpoint schemas (per `impl-contracts.md` registry) | every route handler + shim client | `GAP-CONTRACT-<hash>` if schema missing in `packages/contracts/src/` |
| `@<workspace>/<utility-pkg>` exported helpers (HMAC, crypto, etc.) | callers in client/server | `GAP-WIRING-<hash>` |
| Module M<X> exported helpers / fixtures | downstream consumer module M<Y> | `GAP-WIRING-<hash>` |
| Module M<X> trace channels / event names | reporter / sink modules | `GAP-WIRING-<hash>` |
| Module M<X> context-object fields (e.g., 11-field provider context) | wrapping/adapter modules | `GAP-WIRING-<hash>` |
| Cross-cutting infra (TenantRepository, KMS key manager, etc.) | every consumer expected by spec | `GAP-WIRING-<hash>` per un-extended consumer |
| 501-route stubs awaiting future modules | future modules — track as `DEFERRED` | `GAP-STUB-<hash>` (from Phase 3) |

> The rows above are **examples**. Generate the actual table from the project's `impl-contracts.md` registry + per-module `Produced` and `Consumed` sections. Every locked contract / exported symbol / trace channel that the design says should cross a module boundary becomes one row.

**Mark status per expected consumer**: ✅ wired / ⚠️ partial (test-only or stub-wrapped) / ❌ not consumed / 🔁 local-duplicate (consumer reimplements).

### Phase 6b — Contract LOCKED Registry Cross-Check

Contracts are claimed as "LOCKED" in `context/implementation/impl-contracts.md` but the code may lag. For each `C<N>` marked LOCKED in the impl-contracts registry:

1. Extract the claimed schema export name(s).
2. `grep -rn "export.*<SchemaName>" packages/contracts/src/` — must hit.
3. `grep -rn "from.*@<workspace>/contracts.*<SchemaName>\|import.*<SchemaName>.*from.*@<workspace>/contracts" packages/` — at least one consumer must import it (otherwise it's LOCKED-but-unused dead contract).
4. Mismatches → `GAP-CONTRACT-<hash>` with `State = OPEN` and note `claimed-LOCKED-but-missing-<in-code|in-consumer>`.

This catches the "C4 audit endpoint schemas claimed locked but `AuditLogsRequestSchema` doesn't exist in packages/contracts/" class of rot.

---

## Phase 7: Diff Against Loaded Registry + Compute Transitions

For each candidate item from Phases 3-6:

1. **Already in registry** — merge:
   - Preserve manually-set `Owner`, `Notes`, `Resolution`.
   - Recompute `Blocker Status` from Phase 2 completion data.
   - If blocker newly complete AND current state is `BLOCKED` → flip to `READY_TO_REOPEN`. Log transition.
   - If current state is `IN_PROGRESS` but stub no longer exists in source → flip to `RESOLVED` (pending `--close` verification).
   - If `Kind = STUB` but the file:line is gone entirely → flip to `VERIFIED` with note "auto-verified: marker no longer in source at HEAD <SHA>".

2. **New item** — insert:
   - Set `Discovered = today`.
   - Set initial state per Phase 3-6 mapping.
   - `Owner = unassigned`.

3. **Registry item no longer found** (e.g., stub was removed but item was in registry at `OPEN` / `BLOCKED`):
   - Flip to `RESOLVED` with note "source marker removed between runs".
   - Do NOT delete — history is preserved.

**Output diff summary**:
```
DIFF: +<N_new> new | ~<N_transitions> state changes | ✓<N_resolved> auto-resolved | -<N_gone> marker-gone
  New: GAP-STUB-abc12345 (M10 scrubDom), GAP-PLAN_ONLY-def67890 (M09 authoring)
  Transitions:
    GAP-STUB-a1b2c3d4: BLOCKED → READY_TO_REOPEN (blocker M07 complete 2026-04-12)
    GAP-STUB-e5f6g7h8: BLOCKED → READY_TO_REOPEN (blocker MSHIMS complete 2026-04-12)
  Auto-resolved: GAP-STUB-99zzaaaa (C22 purgeTraces — marker removed in source)
```

---

## Phase 8: Assign Tier + Compile Report

Tier assignment (automatic unless manually overridden in registry):

- **Tier 1**: `READY_TO_REOPEN` stubs in shipping source (low-effort unblocks)
- **Tier 2**: `PLAN_ONLY` items + `FOLLOWUP` items whose blocker is complete
- **Tier 3**: New `OPEN` items just added to registry (need triage/assignment)
- **Tier 4**: `DEFERRED` / `BLOCKED` by future modules

Report sections:

1. **Executive Summary** — registry counts by state; new discoveries; transitions; resolutions this run
2. **Transitions This Run** — diff block from Phase 7 (the "what changed" view)
3. **Tier 1 — Ready to Re-open** — every `READY_TO_REOPEN` with exact file:line, the import to swap, acceptance criteria
4. **Tier 2 — Plan-Only Modules + Unblocked Follow-ups** — each with "next skill to run" (`/blueprint <plan>`, `/implement-plan <blueprint>`)
5. **Tier 3 — Newly Discovered** — items added this run, awaiting triage
6. **Tier 4 — Deferred / Still Blocked** — tracked but not actionable
7. **Wiring Status Table** — per-consumer ✅/⚠️/❌
8. **Red Flags** — modules marked complete with 0 consumers; LOCKED contracts with no tests; duplicate constants; circular blocks
9. **Registry Path** — always `context/pending-items-registry.md` — link for easy access

Every claim cites `[file](file#Lnn)`. Tier 1 items are **actionable in one session** with specific file/line/import to change.

---

## Phase 9: Persist Registry

Unless `--dry-run`:

1. Rewrite `context/pending-items-registry.md`:
   - Header with `Last updated`, `Skill run count` (incremented).
   - Summary table (counts per state).
   - **Transitions section** — append this run's diff block as a collapsible `<details>` block dated today.
   - Item table (every row from the merged set, sorted by Tier then State then ID).
2. Emit a stable, re-runnable document. Git diff should show only actual changes (state transitions, new rows, timestamp).
3. Never delete historical items. `VERIFIED` and `WONTFIX` remain as audit trail.

**Cross-doc sync**:
- Append a single summary line to `context/implementation-status.md` under "Pending Items Registry Sync":
  `<date> — <N> open, <N> ready-to-reopen, <N> resolved this run. See context/pending-items-registry.md.`
- Do NOT duplicate item detail into `implementation-status.md` — registry is the source of truth.

---

## Phase 10: Optional Actions

### `--remediate [N]`
Pick top-N Tier-1 `READY_TO_REOPEN` items (default N=3).

For each:
1. Flip registry state: `READY_TO_REOPEN → IN_PROGRESS` (persist immediately).
2. Delegate to a general-purpose agent with a self-contained prompt:
   - Exact file:line to modify
   - Exact import to add / swap
   - Acceptance test to add or update
   - "After change, re-run relevant tests"
3. On agent success + tests green → flip to `RESOLVED` + add commit SHA.
4. On agent failure or test regression → flip back to `READY_TO_REOPEN` + add failure note.

**Never batches incompatible items** — each remediation runs in its own agent session for isolation.

### `--close <ID>`
Verify a specific item is resolved:
1. Re-run the Phase 3 grep scoped to the item's file.
2. If marker is gone → flip to `VERIFIED` with HEAD SHA.
3. If marker still present → emit error `ID <foo> not actually resolved at <file:line>`, leave state unchanged.

### `--assign <ID> <owner>`
Set `Owner` field. Triggers no other state change. Persist registry.

### `--defer <ID> [until <date>]`
Flip state to `DEFERRED`. Add note with deferral target date if supplied.

### `--wontfix <ID> <reason>`
Flip state to `WONTFIX`. Reason mandatory — added to `Notes` with today's date.

---

## Parallel Agent Delegation — MANDATORY for projects with ≥10 modules

This is not an optional speedup. The default-run topology delegates Phases 2, 2.5, 2.6, 4, 5 to **three concurrent agents in a single tool-use block**, then reconciles on the main thread. Anything less is shallow.

### Agent A — "Module status + registry + Sprint follow-ups"
Reads (in full, not summarized):
- `context/implementation-status.md` — Module Status table (all rows/columns) + Sprint N Follow-ups table + Deviations section
- `context/blueprints/blprnt-registry.md` — Stage gates + deviation log + frozen-schema watch
- `context/blueprints/blprnt-master.md`
- `context/implementation/impl-master.md`
- `context/implementation/impl-contracts.md` (often 4000+ lines — enumerate every C<N>)

Returns a structured report with §1 Module Status Snapshot, §2 Completed Modules enumeration, §3 Pending/Not-started, §4 BLOCKED items needing re-open, §5 Sprint Follow-ups with "action needed?", §6 Contracts LOCKED vs PENDING, §7 Red flags.

### Agent B — "Per-module blueprint + impl tracking files for BLOCKED stubs"
Reads every `context/blueprints/blprnt-<M-ID>.md` AND `context/implementation/impl-<M-ID>.md` for each known module (completed or not).

Extracts per module: §7D gate status, stub counts (A/B/M), deferred items, contracts owned/consumed, dependency-waiting notes ("awaiting M<X>", "resolves when <foo> lands", "currently blocked by …").

Returns: per-module table + enumerated BLOCKED-STUB tickets with "is blocker now complete? → should re-open?" flag.

### Agent C — "Plan + remediation sweep for outstanding items"
Reads every file in `context/plans/` and `context/remediation/`. For each: parse §Status/§Completion, grep for TODO/FIXME/DEFERRED/PENDING/BLOCKED/FOLLOW-UP/OUT-OF-SCOPE/POST-V1.

Returns: plan file summary table, remediation summary, per plan-only module a deep-dive on what it specs, list of orphaned follow-ups NOT tracked in `implementation-status.md`.

### Main-thread work (never delegate)
- **Phase 3 grep** — project-wide `TODO-STUB-*` scan on source + tests. Ground truth. Agents read docs; only grep reads code.
- **Phase 4 doc-grep** — `grep -rn "TODO-STUB" context/` across blueprints/plans/remediation to cross-check agent reports.
- **Phase 6 wiring grep** — symbol-level consumer verification.
- **Phase 6b contract cross-check** — every LOCKED `C<N>` grepped against `packages/contracts/src/` and at least one consumer.
- **Phase 7 diff + persistence** — deterministic merge of agent outputs into registry.

### Reconciliation rule
If Agent A's status claim disagrees with Agent B's per-module reading, or either disagrees with Phase 3 grep → **grep wins**, then Agent B, then Agent A. Emit `RED_FLAG-AGENT-DISAGREEMENT-<n>` for every discrepancy.

**Bash/grep commands main-thread MUST run verbatim**:
```bash
# Module count + deviation extraction
grep -A 50 "## Deviations" context/implementation-status.md
grep "Stubs (A/B/M)" context/implementation-status.md -A 30
ls -la context/plans/ context/remediation/          # size + mtime inventory

# Source-tree truth
grep -rn "TODO-STUB-BLOCKED\|TODO-STUB-ACTIONABLE\|TODO-STUB-MVP" packages/ --exclude-dir=dist --exclude-dir=node_modules
grep -rn "TODO-STUB" context/blueprints/ --include="*.md"
grep -rn "DEFERRED-TO-SPRINT-\|awaiting M\|blocked by\|resolves when" context/blueprints/ --include="*.md"

# Contract consumer cross-check (per LOCKED C<N>)
grep -rn "export.*<SchemaOrSymbol>" packages/contracts/src/
grep -rn "from.*@<workspace>/contracts.*<SchemaOrSymbol>" packages/
```

**CRITICAL**: If an agent claims "all modules complete" but the ground-truth grep finds live `TODO-STUB-BLOCKED(<M>)` markers, trust the grep. Agents can and do produce false-positive "complete" reports by reading registry summaries instead of source.

### Exhaustiveness checklist — every run MUST hit all of these before reporting

A run is **incomplete** (not just thin) if any of these were skipped. Mark each ✅ in the report footer.

- [ ] Phase 2 reconciliation used all 4 sources (status table + registry + git log + filesystem).
- [ ] Phase 3 grep ran project-wide (`packages/` root) — not scoped to `src/`. Test-file stubs count.
- [ ] Phase 3 also ran 501/NotImplementedError + `z.unknown()` shim scans.
- [ ] Phase 5b reconciled every plan/remediation/blueprint follow-up against the Sprint N Follow-ups table. An untracked follow-up is a first-class registry item, not a footnote.
- [ ] Phase 6 verified every wiring row with a **positive symbol-level grep in shipping src**, not just presence of the producer package.
- [ ] Phase 6b cross-checked every LOCKED `C<N>` in impl-contracts against actual `packages/contracts/src/` exports **and** at least one consumer import.
- [ ] Plan-only modules verified by filesystem (`ls <expected src dir>`) — not by the plan file's self-claim.
- [ ] Final report separates **tracked** vs **untracked** items. Every untracked follow-up carries a proposed `SPRINT<N>-<MODULE>-<ID>` name.
- [ ] Report's wiring table names ✅ / ⚠️ / ❌ / 🔁 for every row — no "unverified" cells.

If fewer than all 9 boxes are checked, the skill must re-run the missing phases before emitting the registry write. "Shallow audits are worse than no audits" — they create false confidence that rot has been caught.

---

## Invocation Examples

```
/audit-pending-items
# Full analysis + registry update. Emits report + transitions. Writes registry.

/audit-pending-items --dry-run
# Same analysis, no registry write. Shows what would change.

/audit-pending-items diff
# Minimal output — only the transitions since last run.

/audit-pending-items stubs
# Only Phase 3 (stub grep). Fast — skips blueprint/plan/wiring scans.

/audit-pending-items --remediate 3
# Full audit + pick top 3 Tier-1 items + delegate each to an agent.

/audit-pending-items --close GAP-STUB-a1b2c3d4
# Verify a specific item is resolved; flip to VERIFIED if marker gone.

/audit-pending-items --assign GAP-WIRING-ef12ab34 backend-team
# Mark owner on one item.

/audit-pending-items --defer GAP-FOLLOWUP-deadbeef until 2026-05-01
# Defer one item.
```

---

## Registry Hygiene Rules

1. **Never hand-edit the generated item rows** (except `Owner` and `Notes` — skill preserves these). Always invoke the skill to mutate states.
2. **Never delete rows**. Historical `VERIFIED` / `WONTFIX` items are the audit trail.
3. **`Notes` column is preserved verbatim**. Use it for cross-links to PRs, Slack threads, design decisions.
4. **`Resolution` column accepts**: commit SHA (`abc1234`), PR URL, or `—`. Set when flipping to `RESOLVED`.
5. **`Owner` may be**: a person name, an agent name (e.g., `refactoring-specialist`), `auto` (skill will remediate), `unassigned`.
6. **Run this skill at least once per major module landing** — catches re-openable stubs within hours instead of sprints.

---

## Success Criteria

A good run satisfies:
1. **Zero hidden debt** — every follow-up in `plans/` and `remediation/` is represented in the registry.
2. **Zero stale BLOCKED states** — every stub whose blocker has landed is `READY_TO_REOPEN`.
3. **Zero orphaned completions** — every completed module's expected consumers are verified (wired or tracked as `GAP-WIRING`).
4. **Idempotent re-runs** — running twice in a row with no changes in-between produces ≤ 1 registry diff (only the timestamp bump).
5. **One source of truth** — `implementation-status.md` has a summary pointer; detail lives in the registry.

If a run adds a `GAP-STUB-*` item with state `READY_TO_REOPEN` that wasn't previously tracked anywhere, the skill paid for itself.
