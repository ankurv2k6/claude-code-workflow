---
description: Verify an implementation against its plan or module blueprint by running the code as well as reading it, focused on the delta, its callers and the project profile's risk routes. Fixes CRITICAL, HIGH and normal-use findings and logs the rest, within 2 sweeps. 2 agents by default, 7 with --deep. Supports the three-layer blueprint system.
---
# Verify Implementation Command

Verify the **current session's module** against its plan: gap analysis, a logging and testing audit, and
**automated remediation**. The module comes from session context first (TodoWrite, recent commands), then the
status file. `--all` verifies every implemented module. Supports standalone plans and the three-layer
blueprint system.

## Arguments
- `$ARGUMENTS`: path to a plan file, or a keyword: `logging`, `testing`, `gaps`, `stubs`.
- `--force`: verify even if the module or plan is marked complete in the tracking documents.
- `--all`: verify every implemented module (from `context/implementation-status.md`). Without it, only the
  current module.
- `--stubs`: focus mode: only the stub and contract checklists (Agents 6 and 7). Phases 3–7 still run.
- `--status [module]`: query only (Phase 1.5); runs no agents and ignores every other flag. Default `ALL`.
  The module must match `/^M\d{1,3}[a-z]?$/` and the registry, or be `ALL`; otherwise reject with
  `Invalid module ID: {input}. Use a module ID from the registry or ALL.`
- `--skip-stub-gate`: consumed by `/implement-plan` and `/implement-batch`: stub gate results are reported
  but do not block. **Not recommended.**
- `--deep`: the 7 specialist agents (one checklist each) instead of the default 2. For a final audit, not
  inside a batch.

Use TodoWrite. **Launch the Phase 2 agents in one message. Fix CRITICAL, HIGH and normal-use findings
without asking; log the rest with a reason** (`_shared-triage.md`). **At most 2 sweeps:** this run is
sweep 1; sweep 2 re-checks only the fixes (Phase 6).

**Shared protocols** (`~/.claude/commands/`): `_shared-triage.md` (what blocks, how a verifier focuses),
`_shared-project-profile.md`, `_shared-ui-parity.md`, `_shared-test-selection.md`, `_shared-effort-budget.md`,
`_shared-agent-timeout.md`, `_shared-commit-protocol.md`.

**The profile.** If `.claude/workflow-profile.json` exists, its `commands.*`, `risk_routing` and
`agents.verifier_model` apply below. **No profile (v1):** the steps marked so replace them.

---

## Phase 1: Plan Discovery

1. **Flags:** `FORCE_MODE` (`--force`: ignore completion markers in the status file, registry gates and
   plan progress), `ALL_MODE` (`--all`), `STUBS_FOCUS` (`--stubs` or `stubs`), `STATUS_QUERY` (`--status`:
   validate the module, then go straight to Phase 1.5), `DEEP_MODE` (`--deep`).
   - **On a lane branch** (a batch worktree, or any branch behind its integration branch): merge the
     integration branch in first and verify the result (`_shared-triage.md`).

2. **Find the plan(s).**
   - **One module (default):** an explicit path in `$ARGUMENTS`; else, in order: the module named in
     TodoWrite (in progress or just completed); a recent `/implement-plan` or `/blueprint` call in this
     conversation; the one `🔨 IN PROGRESS` module in `context/implementation-status.md` (several: ask
     which, or `--all`); else the most recently modified plan, with the warning "⚠️ Using most recently
     modified plan [name]. If working on a different module, specify it explicitly." Nothing found: ask
     for a plan or `--all`. Session context wins over modification time, since modules run in parallel.
   - **`--all`:** every module `✅ COMPLETE` or `🔨 IN PROGRESS` in the status file, each with its plan
     (`context/blueprints/blprnt-M*.md` or `context/plans/*.md`), verified in turn. Print
     `VERIFYING ALL: X modules found`.

3. **Blueprint system** (`blprnt-*.md`): `BLUEPRINT_MODE=true`. Load §7 Verification Playbook, the registry,
   the `impl-contracts` sections the module produces or consumes, and the impl spec §2 File Map, by anchor.

4. **Completion check** (skip with `FORCE_MODE`): a module marked `✅ COMPLETE`, a registry gate at
   `PRODUCTION`, or a plan with every phase `[x]` → "Module marked complete. Use `--force` to verify anyway."

5. **Parse the plan:** phases, features, expected files, endpoints, components, integration points; in
   blueprint mode also §7A checks, §7C integration checks and §12 pre-flight. `FORCE_MODE` re-verifies
   every item whatever its markers.

6. **The risk focus** (`_shared-triage.md`):
   - **the delta:** `git diff --name-only <base>...HEAD` (base: the lane's base, or the plan's start
     commit; for a hotfix the release branch; never the moving tip of the default branch: with no release
     branch, the merge-base), plus **its callers**: the files that import or call what changed;
   - **the focus list:** each `risk_routing` route whose `paths` match a changed file adds its `reason`,
     and its `verifier` as the agent type for the checklist it covers. No profile (v1): the module's
     invariants, its screens with the most states, new routes and new cross-package dependencies.

7. **Output:** `PLAN: [name] | MODE: [standard/blueprint] | FORCE | ALL | PHASES: X | REQUIREMENTS: Y |
   FILES: Z | DELTA: N files, M callers | FOCUS: [reasons]`

---

## Phase 1.5: Status Query (`STATUS_QUERY` only; then exit)

Read `context/implementation-status.md` and, in blueprint mode, the registry's `## Stub/Placeholder
Tracking`. No status file, or unparseable: `No modules tracked yet. Run /implement-plan to start.` A row
without a `Stub Gate` column shows `UNKNOWN`, never PASSED.

One module (`--status M3`):
```
MODULE STATUS: M3 ({module name})
Implementation: {status} | Stub Gate: {PASSED/FAILED/PENDING/UNKNOWN} | Last Scanned: {timestamp}
Stubs: Actionable {n} (fixable now) | Blocked {n} (awaiting upstream) | MVP {n} (OUT-*, never remediated)
  [STUB-ID] [category] [file:line] — [description | Blocked by M[N] ({upstream status})]
```

All modules (`--status` or `--status ALL`):
```
| M-ID | Module | Impl Status | Stub Gate | Actionable | Blocked | MVP |
COMPLETE-IMPLEMENTATION STUB GATE: {PASSED / FAILED / NOT RUN}
⚠️ N blocked stubs have actionable upstreams — run --stubs --all --force to resolve   (when any)
| STUB ID | Module | Blocked By | Upstream Status | Reclassifiable |
```

Log `{ event: 'STATUS_QUERY', module, source: 'implementation-status.md', timestamp }` and exit.

---

## Phase 2: Analysis agents

**Default: 2 agents, split by file ownership** (`_shared-effort-budget.md`: never several agents over the
same files). Each runs the checklists below that fall in its half:

| Agent | Owns | Runs the checklists of |
|---|---|---|
| **A — code** | source files, contracts, stubs | 1 (implementation), 6 (stubs), 7 (contracts), and 4 (security) for code paths |
| **B — behaviour** | tests, runtime, UI | 3 (testing), 2 (logging), 5 (UI parity), and 4 (security) for one real request per route access class |

`DEEP_MODE`: the 7 specialist agents, one checklist each. `STUBS_FOCUS`: Agent A only, checklists 6 and 7.
Checklist 5 applies only if `design/wireframes/` or `design/mockups/` exist.

**Configuration:**
- Launch in one message, in the background, at effort `high` and model `agents.verifier_model` (default
  `opus`; role "Independent verifier"). A focus-list route with its own `verifier` type replaces the default
  agent type for the half its paths fall in. No turn caps.
- **Each brief starts with the risk focus** (Phase 1 step 6): the delta and its callers first, then the
  focus list, then the module's remaining requirements. Spend effort on what the implementer's tests did
  not cover.
- Each agent writes its full findings to `context/scratch/verify-<agent>-[timestamp].md` and returns at
  most `limits.handback_lines` (default 30) lines under the headings in `_shared-triage.md`.
- **Run the code as well as reading it:** B drives the UI in a real browser on the real stack
  (`_shared-ui-parity.md`, the one parity pass), calls each external network path once against a real local
  socket, and sends one real request per route access class. **Check a claim by running it before
  reporting it.**
- **Tests: review beside the quick tier** (`_shared-test-selection.md`). A reads the diff and never waits
  for test results; B runs the quick tier on the delta (`commands.test_task`) at the same time, then only
  what a finding needs. The wide run (the lane-end selection, `commands.test_lane_end`; no profile (v1):
  `test-select --since <base>`) runs **once, in Phase 6, after the fixes are in**, never before. Known reds
  are subtracted: only an unknown red is a finding.
- **Gates:** a gate this run executes (a tier the brief names, `tiers.merge` at a batch verifier's merge
  prep, a gate the plan's §7A names) goes through `run-tier.mjs` or is run as the registry gives it. **An
  agent gate (`kind: agent`) is launched, not run:** its `verifier` agent type, with `asks` as the task and
  the output of its read-only helper `cmd` (when it has one) in the prompt, at effort high on
  `agents.verifier_model`. It passes only when that agent returns PASS; record the verdict and the agent id
  in the report. A FAIL is a HIGH finding (CRITICAL when the gate guards an invariant).

### Checklist 1: Implementation (`code-reviewer`)
FILE EXISTENCE (all planned files) · CODE STRUCTURE (signatures) · PLACEHOLDERS (TODO, FIXME,
NotImplemented) · INTEGRATIONS (data flow between components) · COMPLETENESS (core logic, error handling,
validation, return types). Blueprint mode adds CONTRACT VERIFICATION (shapes match `impl-contracts`) and
FROZEN SCHEMA (a LOCKED contract changed: CRITICAL). Output: per feature COMPLETE / PARTIAL / MISSING; gaps
`IMP-*`.

### Checklist 2: Logging (`code-reviewer`, architectural fit)
ENTRY POINTS (request and response on every API route) · ERROR PATHS (every catch logs context and stack; flag
silent swallowing) · CRITICAL OPS (DB, external APIs, auth, file system, background jobs) · QUALITY
(structured, consistent levels, correlation ids, no sensitive data). Output: gaps `LOG-*`, `SEC-LOG-*`.

### Checklist 3: Testing (`test-automator`)
Blueprint mode: run §7A and §7C checks, record pass or fail. Standard: REQUIREMENT-TO-TEST (unit,
integration, E2E per requirement) · QUALITY (meaningful assertions, error and edge cases, mocking) ·
INFRASTRUCTURE (runner, test map, utilities). Coverage only when the project measures it. Output: playbook
results, gaps `TEST-*`.

### Checklist 4: Security (`code-reviewer`, or the focus list's specialist)
INPUT VALIDATION (schemas; injection and XSS) · AUTH/AUTHZ (protected routes, sessions and tokens, rate
limits) · SECRETS (none hardcoded or logged; env files ignored) · DATA PROTECTION (encryption, PII). Output:
PASS / CONCERNS, gaps `SEC-*` with severity.

### Checklist 5: UI parity (`ui-designer`; only with design assets)
Per `_shared-ui-parity.md`, for each screen the module owns and each key state in its mockup's state list:
screenshot the mockup (`design/mockups/{area}/{screen}.html?state={state}`) and the running app in the same
state; compare structure, copy, states, missing or extra elements; check that nothing the wireframe's
Information decisions table omits is shown. Also: theme tokens, not colour literals; the mockup's
accessibility attributes kept. No browser → `NOT PROVEN` (an `AUDIT-INCOMPLETE` gap), never a pass.
Gaps: `UI-STRUCT-*`, `UI-STATE-*`, `UI-COPY-*`, `UI-PLACEHOLDER-*` ("Coming soon", "TODO", "Lorem ipsum",
empty render paths where the wireframe defines a state), `UI-A11Y-*`; `UI-STYLE-*` for a few pixels or a
shade.

### Checklist 6: Stubs (`code-reviewer`)
Scan only the module's files (impl spec §2 File Map, or the plan); `--all` scans every module's.

Patterns, by confidence:
1. **Explicit markers:** TODO, FIXME, HACK, STUB, NotImplemented; "placeholder" or "not (yet) implemented" in
   comments (not the DOM `placeholder` attribute).
2. **Structural:** `export {};` as the whole file; functions with empty bodies or that return `{}`, `[]` or
   `null` without logic; `unknown` with a "when M* is implemented" comment; `_`-prefixed parameters the body
   ignores; `{ stub: true }` returns.
3. **Dependency placeholders:** types commented "placeholder until M* delivers"; stub stage registrations
   or `unknown` shared types whose producer module is COMPLETE.
4. **UI content placeholders:** Lorem ipsum, "Coming soon", "TODO" in rendered text; empty render returns;
   placeholder styling.

Exclude: test files using stub factories for mocks; DOM `placeholder` accesses; intentional no-op
utilities; comments describing a past stub; `node_modules/`.

**Truth table** (the single source for severity and actionability; module and upstream status from the
status file):

| Stub type | Module status | Upstream status | Severity | Actionable |
|---|---|---|---|---|
| STUB-EMPTY | COMPLETE | n/a | CRITICAL | yes |
| STUB-EMPTY | PENDING / IN_PROGRESS | n/a | LOW | no |
| STUB-DEP | any | COMPLETE | HIGH | yes |
| STUB-DEP | any | PENDING, VERIFICATION_FAILED, STUB_GATE_FAILED, FAILED or BLOCKED | LOW | no |
| STUB-STAGE | COMPLETE | n/a | HIGH | yes |
| STUB-STAGE | IN_PROGRESS | n/a | MEDIUM | no |
| STUB-STAGE | PENDING | n/a | LOW | no |
| STUB-TEST | any | any | MEDIUM | yes |
| STUB-MVP (`OUT-*`) | any | any | INFO | no, never remediated |

`actionable` is true only if the stub can be resolved with code available now. Each gap carries
`actionable`, `blockedBy` (module id or null) and `dependencyStatus`. Summary: `STUB GATE ELIGIBLE: YES` when
actionable is 0, else `NO`.

### Checklist 7: Contracts (`code-reviewer`)
Finds documented components that were never built, by checking `impl-contracts` and the architecture
overview against the code. Only contracts the current module produces; `--all` checks all.
1. **CONTRACT-MISSING** (CRITICAL): a `Producer: M<n> (<path>)` file that does not exist.
2. **CONTRACT-MISMATCH** (HIGH): the file exists but its exports differ from the contract (missing exports,
   wrong signatures, missing properties).
3. **CONTRACT-UNWIRED** (HIGH): a documented utility exists but its documented consumer never imports or
   calls it at the documented point.
4. **DOC-FLOW** (MEDIUM): the architecture overview describes a step in a flow that the code lacks.

Actionability: a CONTRACT-MISSING for a COMPLETE module is CRITICAL and actionable; for a PENDING module,
MEDIUM and not actionable. Each gap carries `contractRef`, `expectedPath`, `actionable` and `expectedExports`.

### Completion and fallbacks
Wait for completion notifications (`_shared-agent-timeout.md`). An agent that fails or returns incomplete
leaves an `AUDIT-INCOMPLETE-*` gap, and its part falls back to: Implementation → list existing files ·
Logging → "audit incomplete" · Testing → select per `_shared-test-selection.md` · Security → "requires manual
security review" · UI → "requires manual review" · Stubs → `grep -rn "TODO\|FIXME\|STUB\|NotImplemented"
<module-files>` · Contracts → `grep -n "Producer:" impl-contracts*.md` and check each file exists.

---

## Phase 2b: Persist findings

Write the agents' raw findings to `context/scratch/verify-scratch-[timestamp].json` (`{ plan, agents: {
implementation, logging, testing, security, ui, stubs, contracts }, ts }`). If your context is summarized,
re-read it and the agents' findings files, then continue. Delete it after Phase 4.

---

## Phase 3: Consolidate

1. **Agent status:** each failed or incomplete agent adds `AUDIT-INCOMPLETE-<area>` (HIGH: needs manual
   follow-up); keep its partial results.
2. **Merge and dedupe** `IMP-*`, `LOG-*`, `TEST-*`, `SEC-*`, `UI-*`, `STUB-*`, `CONTRACT-*`. Flag compound
   issues (an untested insecure path), but not across an incomplete agent's data.
3. **Severity:** each checklist's own severity (the stub truth table, the contract classes), then
   `_shared-triage.md`:
   - a breach of the project's CRITICAL list is CRITICAL;
   - `UI-STRUCT`, `UI-STATE`, `UI-COPY`, `UI-PLACEHOLDER` and `UI-A11Y` are HIGH; `UI-STYLE` of 1–3
     properties is LOW;
   - anything that breaks normal use is HIGH, whatever its category;
   - logging and quality gaps, `STUB-TEST` and `DOC-FLOW` are MEDIUM unless they break normal use;
   - `STUB-MVP` is INFO: tracked, never counted.

   **SIGNIFICANT_GAPS = CRITICAL + HIGH**: these block. MEDIUM, LOW and edge cases go to Deferred findings
   with a reason and a revisit trigger.
4. **Inventory**, one entry per gap, with a fix order (CRITICAL first; a fix another depends on first):
   ```
   [GAP-ID] SEVERITY: [description]
     Location: file:line | Plan Ref: Phase X, Item Y | Impact: [what breaks] | Fix: [concrete change]
     (stubs) Dependency: M[N] — Status: [COMPLETE/PENDING] | Blocked: [yes/no]
   ```
5. `GAPS: X CRITICAL, Y HIGH, Z MEDIUM, W LOW, I INFO (N total)`, plus `⚠️ X agent(s) incomplete` when any.

---

## Phase 4: Verification report

```
VERIFY-IMPLEMENTATION REPORT
PLAN: [name] | DATE: [timestamp] | BRANCH: [branch] | DELTA: N files, M callers | FOCUS: [reasons]
Agents: ✓ A (code) ✓ B (behaviour)   (or the 7 with --deep; INCOMPLETE where an agent failed)
PLAN COMPLIANCE: Phases X/Y | Requirements X/Y | Files X/Y
IMPLEMENTATION · LOGGING · TESTING · SECURITY · UI · STUBS · CONTRACT: [PASS / NEEDS WORK / INCOMPLETE] each
STUB GATE: [PASS (0 actionable) / FAIL (n actionable) / NOT RUN] | CONTRACT GATE: [PASS / FAIL / NOT RUN]
GAPS: CRITICAL X | HIGH Y | MEDIUM Z | LOW W | INFO I
VERDICT: [READY FOR PR / NOT READY / INCOMPLETE - MANUAL REVIEW REQUIRED]
```

---

## Phase 5: Remediation

**Proceed autonomously** (`_shared-autonomous.md`). Report when remediation is done.

### Fix order
1. **CRITICAL**, one at a time: read, fix, test the fix, resolve regressions.
2. **HIGH and normal-use breaks:** fix directly. A fix agent only for a large, independent fix
   (`_shared-effort-budget.md`).
3. **MEDIUM and LOW:** not fixed; logged in Deferred findings with a reason and a revisit trigger.
4. **INFO** (`STUB-MVP`): tracked only.

### How to fix, by category (once triage says it blocks)
- **STUB-EMPTY:** implement the exports the impl spec §2 File Map expects.
- **STUB-DEP:** confirm the upstream is COMPLETE; replace `unknown` and placeholder types with imports of
  the real ones; typecheck.
- **STUB-STAGE:** register the real handler instead of the stub; remove it from any stub list; test.
- **CONTRACT-MISSING:** create the file at the documented path with the contract's exports; wire it into
  its consumers; typecheck.
- **CONTRACT-MISMATCH:** make the exports match the contract exactly; update consumers of the old shape.
- **CONTRACT-UNWIRED:** import and call the utility at the documented point; test.
- **DOC-FLOW:** decide whether the doc or the code is right, fix the other, and log
  `DOC-FLOW-NNN: [doc-updated|code-updated] — [reason]`.
- **Blocked stubs** (upstream not COMPLETE): never fixed; recorded as `Blocked by M[N] (status: PENDING)`.

### Regression guard and validation
- **A fix to shared code** (a file other modules import) runs its callers' tests too.
- Tests: `commands.test_task` with the files the fixes changed, in one call. No profile (v1): the selection
  for those files (`_shared-test-selection.md`); an escalated tier is reported and deferred, never run.
- Typecheck (`commands.typecheck`; no profile (v1): `tsc --noEmit -p <pkg>` per changed package, or `tsc
  --build` for a solution-style tsconfig, where a root `--noEmit` checks nothing) and build. At most 3 attempts per failure.

`REMEDIATION: CRITICAL X/X | HIGH X/Y (Z deferred) | MEDIUM logged | LOW logged | INFO X | BLOCKED Z`

---

## Phase 6: Sweep 2 and commit

1. **Sweep 2 re-checks the fixes only:** each fix in place and the code it touched; then the one wide run
   on the final code (the lane-end selection; a file edited during it: stop it, finish, run once). No
   re-audit. A CRITICAL or HIGH still open is reported open (the module's verification FAILS); a finding
   seen in both sweeps is logged as architectural. **There is no sweep 3.**
2. **Blueprint mode:** stage gate status, regression history, deviation log, contract compliance, frozen
   schema timestamps.
3. **Commit** (`_shared-commit-protocol.md`), grouping related fixes and citing gap ids:
   `fix: close verify-implementation gaps [GAP-001, GAP-003]`, one line per gap in the body. Blueprint mode
   includes the registry. Never push.
4. **Final report:**
   ```
   REMEDIATION REPORT
   DISCOVERED: N | FIXED: X | DEFERRED: Z | BLOCKED: B | TRACKED: T (INFO/MVP)
   CRITICAL X/X | HIGH X/Y | STUBS: total X, fixed Y, blocked Z, MVP W
   VALIDATION: Tests [PASS/FAIL] | Types [PASS/FAIL] | Build [PASS/FAIL] | COMMITS: [hashes]
   BLUEPRINT: Playbook X/Y | Contracts X/Y | Registry [YES/NO]
   VERDICT: [ALL CLOSED / GAPS REMAIN]
   ```
   As a batch verifier or combined final, the hand-back is this, cut to `limits.handback_lines`, under the
   headings in `_shared-triage.md`.

---

## Phase 7: Context sync

**Inside a batch** (lane verifier or combined final): update only the plan file and the module blueprint's
§11 Deviations; everything else (status, registry, memory, deferred findings, owner items) goes in the
hand-back, and the orchestrator writes shared state (`_shared-agent-tracking.md`). Standalone runs do all of:

1. **Plan file:** a verification record under `## Implementation Progress`:
   `**Verification**: /verify-implementation [date] — Gaps X (Y fixed, Z deferred) | Stubs A (B actionable,
   C blocked, D MVP) | Tests [pass/fail] | Build [pass/fail]`; fixed items annotated
   `- [x] Item ✅ (commit: SHA) — gap [GAP-ID] fixed`.
2. **Status file** (if it exists): upsert the module row, with a `Stubs` column (`{N} actionable, {M}
   blocked, {K} MVP`, zero categories omitted) and a `Stub Gate` column (`PASSED` / `FAILED` / `PENDING` /
   `UNKNOWN`).
3. **Registry** (blueprint mode, `context/blueprints/blprnt-registry.md`): frontmatter counts and
   `last_updated`; the Module Status row (status, gate, tests, files created vs expected, deviations, date);
   aggregate counts; stage gates passed (command and date); contracts this module produces marked
   `COMPLETE`, integration verified; a Regression History row; the per-module stub summary
   (`| M-ID | Module | Total | Actionable | Blocked | MVP | Gate | Last Scanned |`); the Blocked Stub
   Dependencies table (`| STUB ID | Module | Blocked By | Description | Auto-Resolve When |`), removing
   stubs whose upstream is now COMPLETE.
4. **Architecture document** (`docs/architecture/` or the project's equivalent), when a fix or finding
   changes documented pipeline behaviour, configuration, events, errors or data structures; flag stale
   sections. No architecture document: note the gap in the report.
5. **Memory:** at most 5 lines of new patterns, de-duplicated by `[module]:` prefix; skip past 180 lines.
6. **Commit** the plan file, status file, registry and architecture document (not memory). CLAUDE.md is
   never edited here.

**Non-batch workflows:** blocked stubs accumulate without a complete-implementation gate. Run
`/verify-implementation --stubs --all --force` once every module is implemented, to catch stubs that are
now actionable.

---

## Usage

```bash
/verify-implementation                                    # current module
/verify-implementation context/blueprints/blprnt-M2.md   # a module blueprint
/verify-implementation --force                            # even if marked complete
/verify-implementation --stubs --all                      # stub and contract scan, every module
/verify-implementation --deep                             # 7 specialist agents, for a final audit
/verify-implementation --status                           # stub gate status, every module (no agents)
/verify-implementation --status M3                        # one module
```
