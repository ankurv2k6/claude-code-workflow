# Claude Code Configuration

## Directory Structure

| Location | Purpose |
|----------|---------|
| `~/.claude/commands/` | Shared skill commands (symlinked from `claudeworkflow`) |
| `~/.claude/_repo/` | Agent repository catalog (read-only source) |
| `~/.claude/templates/` | Task list, lane briefs, hard-guardrails snippet, test-map guide (symlinked from `claudeworkflow`) |
| `<project>/.claude/agents/` | Installed project-specific agents |
| `<project>/.claude/sessions/` | Session ID files for Slack integration (gitignored) |
| `<project>/context/implementation-status.md` | Cross-session module tracking |
| `<project>/context/plans/` | Generated plan files from `/plan` |
| `<project>/context/blueprints/` | Architecture layer (what/why) |
| `<project>/context/implementation/` | Code layer (how) |
| `<project>/context/remediation/` | Temporary remediation plans from `/analyze-plan` |
| `<project>/design/wireframes/` | UI design specs (Markdown + ASCII) |
| `<project>/design/mockups/` | Interactive HTML prototypes |
| `~/.claude/plans/` | Standalone/cross-project plan files |

---

## Command Reference

### Development Lifecycle (Primary Flow)

```
/plan → /recommend-agents → /blueprint → /design-ui (if UI) → /implement-plan → /verify-implementation → /commit
```

For multi-module batch execution:
```
/plan → /recommend-agents → /blueprint → /design-ui (if UI) → /implement-batch → /commit
```

**Notes**:
- `/analyze-plan` runs automatically at the end of `/plan`
- `/blueprint --verify` runs automatically after `/blueprint` unless `--no-verify` is specified

---

### Planning & Analysis

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| **`/plan`** | Transform idea into implementation-ready plan via interactive Q&A. Auto-invokes `/analyze-plan` at end. | `--quick` (skip discovery)<br>`--research` (enable web research)<br>`--no-research` (skip research)<br>`--tech "<stack>"` (pre-specify tech)<br>`--no-analyze` (skip auto analysis) | `context/plans/plan-*.md` |
| **`/analyze-plan`** | Deeply analyze plan quality: completeness, security, logging, testing, feasibility. Prompts to select gap tiers to fix, then applies the fixes to the plan document (never starts code). | `[plan-path]` or focus keyword<br>`--no-fix` (analysis only)<br>`--deep` (5 agents instead of 2) | Plan quality score, gap report, updated plan |
| **`/blueprint`** | Create three-layer architecture system (blueprints + impl specs + registry) from plan. Auto-verifies unless `--no-verify`. | `[plan-path]`<br>`--verify` (audit artifacts)<br>`--no-verify` (skip auto-verify) | `blprnt-master.md`, module plans, impl specs, registry, verify report |

---

### Implementation & Execution

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| **`/implement-plan`** | Execute plan phases automatically, one commit per task, targeted tests and real-browser UI parity, then **capped verification** (CRITICAL/HIGH block, ≤ 2 sweeps) and the stub gate. Updates plan file in real time. | `[plan-path or phase]`<br>`--lane` (inside `/implement-batch`)<br>`--skip-verification`<br>`--skip-stub-gate` | Updated plan, committed code, verification status |
| **`/implement-batch`** | Execute a blueprint set as parallel **lanes in git worktrees**, each followed by an independent verifier that preps its merge; the orchestrator merges and keeps a living task list that can resume every agent. One full test run at the end. | `--resume`<br>`--dry-run` (lane map, task list, briefs only)<br>`--from M<N>` / `--to M<N>`<br>`--max-lanes=<n>` (default 5)<br>`--sequential`<br>`--stall=<minutes>` (default 45)<br>`--skip-verification`<br>`--skip-stub-gate` | `context/batch-progress.md`, `context/batch-briefs/`, merged integration branch |

**Verification (MANDATORY for /implement-plan)** — rules in `_shared-triage.md`:
- **Sweep 1** runs `/verify-implementation [PLAN_PATH] --force` (2 agents that run the code as well as reading it).
- **Sweep 2** re-checks only the fixes, then stops.
- **PASS**: no open CRITICAL or HIGH (including normal-use breaks). Medium and Low go to a deferred log with reasons.
- **FAIL**: a CRITICAL or HIGH still open after sweep 2 → "Verification Failed".
- In `--lane` mode the lane self-reviews, and `/implement-batch`'s independent verifier follows.

---

### Verification & Quality

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| **`/verify-implementation`** | Verification that runs the code: 2 agents split by file ownership (7 with `--deep`). Fixes CRITICAL, HIGH and normal-use findings in ≤ 2 sweeps; logs the rest. Supports blueprint mode. | `[plan-path]` or focus keyword<br>`--force`<br>`--all`<br>`--stubs`<br>`--status [module]`<br>`--deep` | Gap report, fixes, deferred log, stub tracking |
| **`/verify-ui`** | Verify UI with real-browser screenshot pairs (mockup vs app, per state) plus functional, accessibility and design-system checks. Fixes visible gaps; the score informs, never gates. | `[component or focus]`<br>`visual`, `accessibility`, `functional`, `design-system` | Compliance report, screenshot pairs, history |
| **`/codebase-audit`** | Comprehensive read-only code quality analysis (maintainability, security, performance, production-readiness). | `[section]` or `all`<br>`security`, `performance`, etc. | Audit report with scores and priorities |

---

###Design & UI

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| **`/design-ui`** | Generate wireframes (Markdown + ASCII) from plan under a binding declutter brief (Show / On demand / Omit). Foundation agent first, then one agent per area of 3–6 screens, then consolidation. | `[plan-path]`<br>`--with-mockups` (add HTML mockups)<br>`--mockups-only` (mockups from wireframes)<br>`--module <name>` (single module)<br>`--update` (update from revised plan)<br>`--verify` (audit + auto-fix)<br>`--sync-blueprints` (sync UI specs to blueprints)<br>`--guide` (show input guide)<br>`--areas=<n>` (screens per area agent) | `design/wireframes/{Feature}/*.md`<br>`design/mockups/{Feature}/*.html` (if --with-mockups) |

---

### Context & Optimization

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| **`/sync-context`** | Incrementally update context files (CLAUDE.md, status, registry) based on git history. Delta-based syncing. | `status` (show state only)<br>`--full` (ignore last sync)<br>`--dry-run` (preview)<br>`--verbose` | Updated context files, sync state |
| **`/optimize-context`** | Audit and compress auto-loaded files (CLAUDE.md, rules, MEMORY.md). Extract sections to skills, path-scope rules, archive old plans. | `audit` (read-only report)<br>`--dry-run` (preview)<br>`--plans-age=<N>` (default 30 days)<br>`--docs-age=<N>` (default 60 days) | Audit report, compressed files, archived content |

---

### Git & Commits

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| **`/commit`** | Stage all changes, run security scans (gitleaks, secret patterns), TypeScript/ESLint/Prettier and test-map checks, generate conventional commit message, commit, push a feature branch. The default or a deploying branch is pushed only with `--push`. | `[message]`<br>`--no-push`<br>`--push` (approve pushing a default/deploying branch)<br>`--amend` | Git commit with conventional message |

**Pre-commit checks (BLOCKING)**:
- Gitleaks secret scan
- Manual secret pattern scan
- Sensitive file check
- TypeScript type check (`npx tsc --noEmit`)
- ESLint (`--max-warnings=0`)
- Prettier check
- **Does NOT run**: Tests (belong in CI/CD)

---

### Agent Management

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| **`/recommend-agents`** | Analyze project/plan, recommend agents from `~/.claude/_repo/` catalog, install selected to `.claude/agents/`, optimize for context window, configure routing rules. | None | Installed agents, routing rules, optimization report |

**Agent catalog source**: `~/.claude/_repo/` (from [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents))

---

### Project-Specific Commands

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| **`/start-debug-server`** | Start development server(s) with debug logging. Auto-detects tech stack on first run, caches config in CLAUDE.md. Kills existing processes on detected ports. | `backend`, `frontend`, `all`, `detect` | Running dev servers, config in CLAUDE.md |
| **`/slack enable`** | Register project for Slack integration | `[channel-id]` (required on first use) | Project registered to channel |
| **`/slack connect`** | Connect current session to Slack thread | None | Thread created in project's channel |
| **`/slack disconnect`** | Disconnect session from Slack | None | Thread archived |
| **`/slack status`** | Show Slack integration status | None | Project and session status |
| **`/slack disable`** | Temporarily disable Slack for project | None | Slack disabled (still registered) |

**Prerequisites**: Slack integration daemon running (`~/.claude/slack_integration/`).

---

### Internal/Advanced Commands

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| **`/audit-commands`** | Audit and optimize command files for context efficiency, token usage, verbosity compliance. **≥98% preservation verification** when applying changes. | `[command or "all"]`<br>`--dry-run` (analysis only, default)<br>`--apply` (apply + verify)<br>`--verify-only` (re-run verification)<br>`--rollback` (restore baseline)<br>`--quiet`<br>`--verbose` | Command audit report, optimized files (if --apply) |

**Located in**: `.claude/_commands/audit-commands.md` (not auto-loaded)

---

## Command Interactions

### Three-Layer Blueprint System

When `/blueprint` runs, it creates:
- **Layer 1 (Blueprints)**: Architecture, module boundaries, verification playbooks
- **Layer 2 (Impl Specs)**: Code-level details, TypeScript interfaces, file maps
- **Layer 3 (Registry)**: Progress tracking, stage gates, deviation log, stub tracking

`/implement-plan` and `/verify-implementation` automatically detect blueprint mode when the plan is `blprnt-*.md` and enable:
- Pre-flight checks before implementation (Section 12)
- Verification playbooks from module's S7
- Registry updates after each phase
- Frozen schema violation detection
- Stub/placeholder tracking across modules

### Verification Workflow (MANDATORY)

```
/implement-plan
  ├──> Implement all phases
  ├──> Commit each phase
  └──> VERIFICATION (MANDATORY, ≤ 2 sweeps):
         ├── Sweep 1: /verify-implementation [PLAN_PATH] --force → fix CRITICAL/HIGH/normal-use, log the rest
         ├── Sweep 2: re-check the fixes only → STOP
         └── STUB GATE (after a verification PASS):
              ├── Scan for actionable/blocked/MVP stubs
              ├── Auto-fix actionable stubs (2 rounds)
              └── PASS: 0 actionable | FAIL: actionable remain
```

**Tri-State Status**:
- `✅ COMPLETE`: Verification PASS + Stub gate PASS
- `❌ VERIFICATION_FAILED`: open CRITICAL/HIGH after 2 sweeps
- `⚠️ STUB_GATE_FAILED`: Verification PASS but stub gate FAIL

**Batch Execution**:
- Phase 0 (contracts + stubs, UI foundation) first; then lanes in worktrees, each built by one agent (`/implement-plan --lane`)
- An independent verifier per lane (same PASS/FAIL criteria) also preps the merge; the orchestrator merges
- **BATCH PASS**: ALL modules `✅ COMPLETE` (verify + stub gates pass)
- **BATCH FAIL**: ANY module with `❌ VERIFICATION_FAILED`, `⚠️ STUB_GATE_FAILED`, `FAILED`, or `BLOCKED`
- Complete-implementation stub gate runs after all modules for cross-module stub resolution

### Context Lifecycle

```
/implement-plan  ──┬──> context/implementation-status.md (auto-updated with stub status)
/verify-implementation ─┘    ├──> Stub Gate column: PASSED | FAILED | PENDING
                             └──> Stubs column: N actionable, M blocked, K MVP

/sync-context ────────> CLAUDE.md proposals (requires confirmation)
                       └──> registry sync if status/registry disagree

/optimize-context ────> CLAUDE.md compression (requires confirmation)
```

**Never auto-edited**: CLAUDE.md always requires user confirmation before changes.

### Plan Flow Options

**From idea to implementation** (full flow):
```
/plan → /recommend-agents → /blueprint → /design-ui → /implement-plan → /commit
```
Note: `/analyze-plan` runs automatically at end of `/plan`. Verification runs inside `/implement-plan`.

**Quick feature** (skip blueprint for simple features):
```
/plan --quick → /implement-plan → /commit
```
Verification still runs inside `/implement-plan`.

**UI feature** (with wireframes/mockups):
```
/plan → /design-ui --with-mockups → /implement-plan → /commit
```
UI parity proven with real-browser screenshot pairs during implementation and verification.

**Complex system** (full blueprint with verification):
```
/plan → /recommend-agents → /blueprint → /blueprint --verify → /design-ui → /implement-plan M1 → ...
```
Each module has its own verification + stub gate.

**Batch execution** (all modules autonomously):
```
/plan → /recommend-agents → /blueprint → /design-ui → /implement-batch → /commit
```
Lanes run `/implement-plan --lane`, each followed by an independent verifier; one full test run plus e2e on the final head. **BATCH PASS** requires every module merged with no open CRITICAL/HIGH. Supports `--resume` (resume every agent from the task list), `--from M<N>`, `--to M<N>`, `--dry-run`, `--max-lanes`.

**Existing plan** (skip interactive planning):
```
/blueprint <plan-file> → /design-ui → /implement-plan → /commit
```

**Post-implementation analysis** (manual verification):
```
/verify-implementation → /analyze-plan
```
Use when `/implement-plan` wasn't used or for post-completion quality check.

**Stub status query** (check stub gate status without running verification):
```
/verify-implementation --status [module]
```
Displays per-module stub gate status from `context/implementation-status.md` and registry.

---

## Best Practices

### Context Window Management

1. **Target ~3000-4000 tokens** for auto-loaded content (CLAUDE.md + rules + MEMORY.md)
2. **CLAUDE.md under 500 lines** — extract large sections to on-demand skills
3. **Path-scope rules** — use `paths:` frontmatter so rules load only when relevant
4. **Run `/optimize-context audit`** periodically to check context size
5. **Keep state on disk** — plans, task lists and lane notes, so an automatic context summary or a lost session costs nothing
6. **Start fresh sessions** — plan in one session, implement in another

### Implementation Workflow

1. **Always use TodoWrite** — track phases and mark items complete immediately
2. **Verification is MANDATORY, and capped** — `/implement-plan` verifies after all phases complete (`_shared-triage.md`):
   - Sweep 1: `/verify-implementation [PLAN_PATH] --force`; fix CRITICAL, HIGH and normal-use breaks
   - Sweep 2: re-check the fixes only, then stop
   - **PASS**: no open CRITICAL/HIGH. **FAIL** → "❌ VERIFICATION_FAILED"
   - Medium and Low are logged with reasons, not chased
3. **Stub gate follows verification** — After a verification PASS:
   - Scans for actionable/blocked/MVP stubs via `/verify-implementation --stubs`
   - Auto-fixes actionable stubs (max 2 rounds)
   - **PASS**: 0 actionable stubs → `✅ COMPLETE`
   - **FAIL**: Actionable stubs remain → `⚠️ STUB_GATE_FAILED`
   - Blocked/MVP stubs are tracked but don't fail gate
4. **Batch execution runs lanes** — `/implement-batch` runs lanes of 1–3 modules in git worktrees:
   - Each lane runs `/implement-plan --lane`, then an independent verifier (≤ 2 sweeps), then the orchestrator merges
   - Targeted tests in lanes; one full run + e2e on the final head
   - Every agent has a brief on disk and an id in the task list, so an interrupted session resumes it
   - **BATCH PASS**: every module merged with no open CRITICAL/HIGH and no actionable stub
   - **BATCH FAIL**: ANY module with `❌ VERIFICATION_FAILED`, `⚠️ STUB_GATE_FAILED`, `FAILED`, or `BLOCKED`
   - Autonomous decision protocol: analyze options → select best → proceed without pausing
   - Complete-implementation stub gate runs after all modules for cross-module cleanup
5. **Context sync on completion** — plan file, status file, registry, MEMORY.md are all updated
6. **Blueprint mode discipline** — follow context manifests (Section 12 context allowlist), don't load extra files
7. **Tri-state completion tracking** — Implementation status uses:
   - `✅ COMPLETE`: Verification PASS + Stub gate PASS
   - `❌ VERIFICATION_FAILED`: open CRITICAL/HIGH after 2 sweeps
   - `⚠️ STUB_GATE_FAILED`: Verification PASS but stub gate FAIL

### Commit Safety

1. **Gitleaks + secret scanning** before every commit (blocking)
2. **TypeScript + ESLint + Prettier checks** (blocking)
3. **Tests belong in CI/CD** — NOT in commit hooks
4. **Never `--no-verify`** or `--force` without explicit request
5. **Atomic commits** — one commit per completed phase
6. **No force push to main/master** without explicit confirmation

### Agent Usage

1. **Agents in `<project>/.claude/agents/`** are auto-loaded (context cost)
2. **Optimize agents to 80-150 lines** — strip VoltAgent boilerplate via `/recommend-agents`
3. **Use routing rules** in CLAUDE.md to control when agents invoke
4. **Catalog source**: `~/.claude/_repo/` from [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)

### Stub & Placeholder Management

1. **Track stubs in registry** — Blueprint registry (blprnt-registry.md) tracks per-module stub status
2. **Categorize stubs** — Use `TODO-STUB-ACTIONABLE`, `TODO-STUB-BLOCKED`, `TODO-STUB-MVP` markers
3. **Actionable stubs must be resolved** — Stub gate fails if actionable stubs remain
4. **Blocked/MVP stubs are tracked** — Logged in registry but don't fail gate
5. **Query stub status** — Use `/verify-implementation --status [module]` to check stub gate without running full verification
6. **Cross-module stub resolution** — `/implement-batch` runs complete-implementation stub gate after all modules

---

## File Reference

### Auto-Created by Commands

| File | Created By | Purpose |
|------|------------|---------|
| `context/plans/plan-*.md` | `/plan` | Implementation-ready plan from idea |
| `context/implementation-status.md` | `/implement-plan` | Module status tracking |
| `context/batch-progress.md` | `/implement-batch` | Living task list: lanes, agents (ids, worktrees, DBs), decisions, deferred findings, owner items, resume procedure |
| `context/batch-briefs/` | `/implement-batch` | One brief per lane agent + shared `_common.md` / `_verify.md` (what a relaunch uses) |
| `context/.sync-state.json` | `/sync-context` | Incremental sync state (gitignored) |
| `context/blueprints/blprnt-*.md` | `/blueprint` | Architecture specs |
| `context/implementation/impl-*.md` | `/blueprint` | Code-level specs |
| `context/remediation/plan-remediation-*.md` | `/analyze-plan` | Temporary remediation plans |
| `context/scratch/*-scratch-*.json` | `/analyze-plan`, `/verify-implementation` | Mid-phase findings checkpoints (deleted after phase) |
| `context/sessions/context-audit-*.md` | `/optimize-context` | Context audit reports |
| `context/TODOS.md` | `/todo` | Project TODO registry |
| `context/audit-commands/` | `/audit-commands` | Command audit baselines + reports |
| `design/wireframes/**/*.md` | `/design-ui` | UI wireframes |
| `design/mockups/**/*.html` | `/design-ui --with-mockups` | Interactive prototypes |

### Key Configuration

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Project instructions (this file) |
| `.claude/settings.json` | Tool permissions |
| `~/.claude/_repo/AGENT-INDEX.md` | Agent catalog index |
