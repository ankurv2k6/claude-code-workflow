# Claude Code Workflow System

A structured workflow system for AI-assisted software development using [Claude Code](https://claude.com/claude-code). It provides an opinionated set of slash commands, sub-agents, and conventions that turn an idea into shipped, verified, regression-tested code — while keeping the context window lean.

The system is **session-resilient**, **verification-first**, and **team-friendly**: every artifact (plans, blueprints, registries, status files) lives on disk so multiple engineers (or multiple sessions) can pick up where someone else left off.

---

## Table of Contents

- [Philosophy](#philosophy)
- [Architecture Overview](#architecture-overview)
- [Directory Structure](#directory-structure)
- [The Three-Layer Blueprint System](#the-three-layer-blueprint-system)
- [The Planning System (`/plan`)](#the-planning-system-plan)
- [The Verification Model (Verify-Loop + Stub Gate)](#the-verification-model-verify-loop--stub-gate)
- [Command Reference](#command-reference)
  - [Planning & Architecture](#planning--architecture)
  - [Implementation](#implementation)
  - [Verification & Quality](#verification--quality)
  - [Pending Items & TODOs](#pending-items--todos)
  - [E2E Validation](#e2e-validation)
  - [Design & UI](#design--ui)
  - [Context Management](#context-management)
  - [Plan Optimization](#plan-optimization)
  - [Git & Commits](#git--commits)
  - [Agent Management](#agent-management)
  - [Project Operations](#project-operations)
- [Command Relationships](#command-relationships)
- [Context Window Optimization](#context-window-optimization)
- [Recommended Workflows](#recommended-workflows)
- [Sample Application Buildout — End-to-End Walkthrough](#sample-application-buildout--end-to-end-walkthrough)
- [Best Practices](#best-practices)
- [Quick Start](#quick-start)
- [Files Created by Commands](#files-created-by-commands)
- [Acknowledgments](#acknowledgments)

---

## Philosophy

The system is built on five core principles:

1. **Structured Context** — information is organized in layers and loaded only when relevant.
2. **Verification-First** — every implementation step is gated by a verify-loop that auto-fixes gaps.
3. **Session Independence** — work persists across sessions via plans, registries, and status files.
4. **Single Source of Truth** — every pending item, stub, contract, and module status has exactly one canonical location.
5. **Lifecycle Discipline** — items move through explicit states (`OPEN → BLOCKED → READY_TO_REOPEN → IN_PROGRESS → RESOLVED → VERIFIED`) so nothing rots.

The goal: **maximize Claude Code's effectiveness on real, multi-week projects** by keeping the context window focused while the on-disk artifacts carry the long-term memory.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     GLOBAL (User Home)                          │
│  ~/.claude/                                                     │
│  ├── commands/        ← Shared skill commands (all projects)    │
│  ├── _repo/           ← Agent catalog (read-only source)        │
│  └── plans/           ← Standalone/cross-project plan files     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PROJECT (Per Repository)                    │
│  <project>/                                                     │
│  ├── CLAUDE.md              ← Project instructions (always loaded) │
│  ├── .claude/                                                   │
│  │   ├── agents/            ← Installed project agents          │
│  │   ├── commands/          ← Project-specific commands         │
│  │   ├── settings.json      ← Tool permissions                  │
│  │   └── sessions/          ← Slack session IDs (gitignored)    │
│  ├── context/                                                   │
│  │   ├── plans/             ← Generated plans from /plan        │
│  │   ├── blueprints/        ← Architecture layer (what/why)     │
│  │   ├── implementation/    ← Code layer (how)                  │
│  │   ├── remediation/       ← Temp remediation plans            │
│  │   ├── implementation-status.md  ← Module status tracking     │
│  │   ├── pending-items-registry.md ← Cross-module gap registry  │
│  │   ├── batch-progress.md  ← /implement-batch checkpoints      │
│  │   └── TODOS.md           ← Project TODO list                 │
│  ├── design/                                                    │
│  │   ├── wireframes/        ← UI design specs (Markdown + ASCII)│
│  │   └── mockups/           ← Interactive HTML prototypes       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

### Global Directories (`~/.claude/`)

| Location | Purpose | Context Cost |
|----------|---------|--------------|
| `~/.claude/commands/` | Shared slash commands symlinked from this repo | None (on-demand) |
| `~/.claude/_repo/` | Agent repository catalog (`AGENT-INDEX.md`), sourced from [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | None (read-only source) |
| `~/.claude/plans/` | Standalone plan files for any project | None (on-demand) |

### Project Directories (`<project>/`)

| Location | Purpose | Context Cost |
|----------|---------|--------------|
| `CLAUDE.md` | Project instructions, command routing, conventions | **Always loaded** |
| `.claude/agents/` | Installed project-specific agents | **Auto-loaded** |
| `.claude/commands/` | Project-specific slash commands | None (on-demand) |
| `.claude/sessions/` | Slack thread session IDs | None (gitignored) |
| `context/plans/` | Generated plan files from `/plan` | On-demand |
| `context/blueprints/` | Architecture specs (Layer 1) + registry | On-demand |
| `context/implementation/` | Code-level specs (Layer 2) | On-demand |
| `context/remediation/` | Temporary remediation plans from `/analyze-plan` | On-demand |
| `context/implementation-status.md` | Module progress tracking across sessions | On-demand |
| `context/pending-items-registry.md` | Persistent gap registry from `/audit-pending-items` | On-demand |
| `context/batch-progress.md` | `/implement-batch` checkpoint state | On-demand |
| `context/TODOS.md` | Project TODO registry from `/todo` | On-demand |
| `design/wireframes/` | UI wireframes in Markdown + ASCII | On-demand |
| `design/mockups/` | Interactive HTML/CSS/JS prototypes | On-demand |

### Why this structure matters

- **Global commands** are shared across all projects — no duplication, single update path.
- **Project agents** are auto-loaded, so they stay minimal (80–150 lines each).
- **`context/` directories** use on-demand loading so the long memory of a project doesn't eat the working window.
- **Registries on disk** (`implementation-status`, `pending-items-registry`, `batch-progress`) survive session resets, machine restarts, and team handoffs.

---

## The Three-Layer Blueprint System

For non-trivial systems, `/blueprint` creates a structured three-layer architecture:

```
┌────────────────────────────────────────────────────────────────┐
│  LAYER 1: BLUEPRINTS (Architecture)                            │
│  context/blueprints/blprnt-*.md                                │
│  ──────────────────────────────────────────────────────────── │
│  • Module boundaries and responsibilities                      │
│  • Interface contracts (S7 shared contracts registry)          │
│  • Dependency graph + parallel work plan (S6/S8/S9)           │
│  • Verification playbooks (S7 per-module)                      │
│  • What to build and why                                       │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  LAYER 2: IMPLEMENTATION SPECS (Code)                          │
│  context/implementation/impl-*.md                              │
│  ──────────────────────────────────────────────────────────── │
│  • TypeScript interfaces and types                             │
│  • File maps and directory structure                           │
│  • Function signatures and parameters                          │
│  • Algorithms, error tables, config schemas                    │
│  • How to build it                                             │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  LAYER 3: REGISTRY (Progress)                                  │
│  context/blueprints/blprnt-registry.md                         │
│  ──────────────────────────────────────────────────────────── │
│  • Stage gates and completion status                           │
│  • Deviation log (decisions diverging from the plan)           │
│  • Cross-module dependency tracking                            │
│  • Per-module stub status (actionable / blocked / MVP)         │
│  • Contract status (LOCKED / PENDING / DRAFT / DEFERRED)       │
└────────────────────────────────────────────────────────────────┘
```

### Blueprint mode detection

When `/implement-plan` or `/verify-implementation` detects a `blprnt-*.md` plan file, it automatically enables:

- Pre-flight checks before implementation (Section 12 context manifest enforcement)
- Verification playbooks from the module's S7 section
- Registry updates after each phase
- Frozen-schema and frozen-contract violation detection
- Cross-module stub tracking

---

## The Planning System (`/plan`)

`/plan` is the **entry point** for all new work. It transforms a raw idea into an implementation-ready plan through structured discovery.

### Planning workflow

```
USER IDEA
    ↓
Phase 1: Input Analysis
    ├─ Parse input (idea, file, or URL)
    ├─ Detect domain, scope, complexity
    └─ Gather existing project context
    ↓
Phase 1.5: Research (optional, user-confirmed)
    ├─ Ask: "Do research?"
    ├─ WebSearch for best practices, tech comparisons
    └─ Synthesize findings into requirements
    ↓
Phase 2: Clarifying Questions
    ├─ Multi-round Q&A (2–4 questions per round)
    ├─ Users, scope, tech stack, auth, data, UI, constraints
    └─ Max 3 rounds, then use defaults
    ↓
Phase 3: Requirements Synthesis
    ├─ Validate completeness
    ├─ Identify implicit requirements
    └─ Resolve conflicts
    ↓
Phase 4: Plan Generation
    └─ Write context/plans/plan-[name]-[date].md
    ↓
Phase 5: User Review
    └─ Present summary, offer refinement
    ↓
Phase 6: Auto-Invoke /analyze-plan
    ├─ 5 parallel agents analyze plan quality
    ├─ Gap detection (CRITICAL / HIGH / MEDIUM / LOW)
    └─ Auto-fix workflow for selected gaps
    ↓
Phase 7: Handoff
    └─ Ready for /recommend-agents → /blueprint OR direct /implement-plan
```

### Key flags

| Flag | Purpose |
|------|---------|
| `--quick` | Skip deep discovery, generate plan directly |
| `--research` | Enable web research without confirmation |
| `--no-research` | Skip web research entirely |
| `--tech "stack"` | Pre-specify technology stack |
| `--no-analyze` | Skip automatic `/analyze-plan` |

### When to use each mode

| Scenario | Command |
|----------|---------|
| New feature, needs clarification | `/plan "feature idea"` |
| Greenfield project, needs research | `/plan --research "build X"` |
| Well-defined feature, quick plan | `/plan --quick "add Y"` |
| Tech stack already decided | `/plan --tech "React, Node" "feature"` |

---

## The Verification Model (Verify-Loop + Stub Gate)

Every `/implement-plan` invocation runs a **mandatory two-stage verification** after all phases complete. This is what separates "code was written" from "module is done."

### Stage 1 — Verify-Loop (max 5 iterations)

```
┌────────────────────────────────────────────────────────────────┐
│  /verify-implementation [PLAN_PATH] --force                    │
│  6 PARALLEL AGENTS analyze the implementation:                 │
│    1. Implementation — code completeness, logic, error paths   │
│    2. Logging — coverage, levels, structured fields            │
│    3. Testing — coverage, edge cases, assertion quality        │
│    4. Security — injection, auth/authz, secrets, validation    │
│    5. UI (/verify-ui) — wireframe/mockup compliance, a11y      │
│    6. Stubs — actionable / blocked / MVP placeholders          │
└────────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴──────────────┐
                │                            │
            (clean)                       (gaps)
                │                            │
                ▼                            ▼
            count++                       auto-fix
                │                            │
        2 consecutive clean? ◄───────────────┘
                │
        ┌───────┴─────────┐
        │                 │
      PASS            FAIL (5 iters)
        │                 │
        ▼                 ▼
   Stage 2 →     ❌ VERIFICATION_FAILED
                    DO NOT MERGE
```

**PASS criteria**: 2 consecutive runs with **zero Critical/High/Medium gaps**.
**FAIL criteria**: 5 iterations exhausted without 2 consecutive clean runs.

### Stage 2 — Stub Gate (after verify-loop PASS)

```
┌────────────────────────────────────────────────────────────────┐
│  /verify-implementation --stubs [PLAN_PATH]                    │
│  Scans for TODO-STUB-* markers and categorizes:                │
│    • TODO-STUB-ACTIONABLE — must be resolved (gate-failing)    │
│    • TODO-STUB-BLOCKED   — waiting on another module           │
│    • TODO-STUB-MVP       — intentional MVP scope deferral      │
│  Auto-fixes ACTIONABLE stubs (max 2 rounds)                    │
└────────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴──────────────┐
                │                            │
        (0 actionable)              (actionable remain)
                │                            │
                ▼                            ▼
        ✅ COMPLETE              ⚠️ STUB_GATE_FAILED
```

### Tri-state completion status

Every module ends in exactly one of three states, recorded in `context/implementation-status.md`:

| Status | Meaning |
|--------|---------|
| `✅ COMPLETE` | Verify-loop PASS **and** stub gate PASS |
| `❌ VERIFICATION_FAILED` | Verify-loop FAIL (5 iterations exhausted) |
| `⚠️ STUB_GATE_FAILED` | Verify-loop PASS but actionable stubs remain after 2 fix rounds |

**Only `✅ COMPLETE` modules ship.** The other two states are visible blockers, not silent failures.

---

## Command Reference

### Primary development flow

```
/plan → /recommend-agents → /blueprint → /design-ui (if UI) → /implement-plan → /commit
```

For multi-module batch execution:

```
/plan → /recommend-agents → /blueprint → /design-ui (if UI) → /implement-batch → /commit
```

**Automated steps**:
- `/analyze-plan` runs automatically at the end of `/plan`
- `/blueprint --verify` runs automatically after `/blueprint` unless `--no-verify` is specified
- Verify-loop runs automatically inside `/implement-plan` after all phases complete
- Stub gate runs automatically after verify-loop PASS

---

### Planning & Architecture

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| `/plan` | Transform idea into implementation-ready plan via interactive Q&A. Auto-invokes `/analyze-plan` at end. | `--quick`, `--research`, `--no-research`, `--tech "<stack>"`, `--no-analyze` | `context/plans/plan-*.md` |
| `/analyze-plan` | Deeply analyze plan quality (completeness, security, logging, testing). Prompts to select gap tiers, then auto-runs remediation via `/implement-plan`. | `[plan-path]` or focus keyword<br>`--no-fix` (analysis only)<br>`--timeout=<seconds>` (default 120) | Plan quality score, gap report, auto-remediation |
| `/blueprint` | Create three-layer architecture system (blueprints + impl specs + registry) from a plan. Auto-verifies unless `--no-verify`. | `[plan-path]`<br>`--verify`, `--no-verify` | `blprnt-master.md`, module plans, impl specs, `blprnt-registry.md`, verify report |

---

### Implementation

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| `/implement-plan` | Execute plan phases automatically with **mandatory verify-loop** (max 5 iterations, 2 consecutive clean runs to PASS) + **stub gate** after PASS. Updates plan in real-time. | `[plan-path or phase]`<br>`--skip-verification`<br>`--skip-stub-gate` | Updated plan, committed code, verification status |
| `/implement-batch` | Execute multiple modules autonomously via `/implement-plan`. Each module runs the full verify-loop + stub gate. **BATCH PASS** requires ALL modules `✅ COMPLETE`. | `--resume`, `--dry-run`, `--from M<N>`, `--to M<N>`, `--sequential`, `--skip-verification`, `--skip-stub-gate`, `--timeout=<minutes>` | `context/batch-progress.md`, per-module status, decision log |

**Batch execution highlights**:
- Each module invokes `/implement-plan` via the Skill tool, so every module runs the full verify-loop + stub gate.
- Module dependencies are read from blueprint S6B/S6C; independent modules run in parallel (max 2 per layer to respect context budget).
- Auto-compacts context at >70% usage.
- Module-level checkpoints with tri-state status tracking; resumable via `--resume`.
- Auto-retries (3×) for impl failures; no retry for verify failures.
- Cross-module integration verified by a final complete-implementation stub gate.
- **Autonomous decision protocol**: when a decision is needed, exhaustively analyze 2–3 options, pick the best, and proceed without pausing — every decision is logged to the batch decision log.

**Subset execution**:
```
/implement-batch --from M5 --to M8    # Range
/implement-batch --from M7            # Resume from a module
/implement-batch --dry-run            # Preview dependency layers
/implement-batch --sequential         # Disable parallelism
```

---

### Verification & Quality

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| `/verify-implementation` | Deep verification with 6 parallel agents (implementation, logging, testing, security, UI, stubs). Auto-fixes all gaps. Supports blueprint mode. | `[plan-path]` or focus keyword<br>`--force` (re-verify completed)<br>`--all` (verify all modules)<br>`--stubs` (stub detection only)<br>`--status [module]`<br>`--timeout=<seconds>` | Gap report, auto-remediated code, stub tracking |
| `/verify-ui` | Verify UI implementation against wireframes/mockups. 4 parallel agents (visual, functional, accessibility, design system). Auto-fixes gaps; generates compliance score. | `[component or focus]`<br>`visual`, `accessibility`, `functional`, `design-system` | Compliance report with score, gap fixes, history |
| `/codebase-audit` | Comprehensive read-only code quality analysis (10 sections: code quality, architecture, performance, security, resilience, testing, accessibility, observability, DX, production-readiness). Generates a report — does not modify code. | `[section]` or `all`<br>e.g., `security`, `performance` | Audit report with scores and priorities |

---

### Pending Items & TODOs

These commands give the project a **single source of truth** for everything that's discovered, deferred, or in-flight — across modules and across sessions.

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| `/audit-pending-items` | Lifecycle-aware audit + centralized tracking of pending/blocked items across completed modules. Maintains `context/pending-items-registry.md` with stable IDs, state machine, owner, re-open criteria. Detects state transitions across runs (`BLOCKED → READY_TO_REOPEN` when a blocker lands). | `[focus]` (`stubs`, `follow-ups`, `wiring`, `contracts`, `diff`)<br>`--dry-run`, `--verbose`, `--since <date>`<br>`--remediate [N]` (top-N Tier-1 items)<br>`--close <ID>`, `--assign <ID> <owner>`<br>`--defer <ID>`, `--wontfix <ID> <reason>` | `context/pending-items-registry.md` |
| `/todo` | Manage project TODOs — create, edit, update status, close, reopen. Auto-captures git context (branch, recent files, status) on creation. | `list` (default) `add <description>`, `update <ID> <field> <value>`, `close <ID> [resolution]`, `show <ID>`, `reopen <ID>` | `context/TODOS.md` |

**What gets tracked in the pending-items registry**:

- `STUB` — `TODO-STUB-BLOCKED` markers in shipping source
- `FOLLOWUP` — deferred items mentioned in plan or remediation files
- `WIRING` — module built but not consumed by intended downstream consumers
- `PLAN_ONLY` — plan exists, code doesn't
- `CONTRACT` — `C<N>` contract still `PENDING` / `DRAFT`
- `CONSTANT_DUP` — shared constants duplicated across packages

State machine: `OPEN → BLOCKED → READY_TO_REOPEN → IN_PROGRESS → RESOLVED → VERIFIED` (terminal). `DEFERRED` and `WONTFIX` are explicit off-ramps. The registry is git-tracked (team-shared) and stable across runs — every gap has a deterministic ID.

---

### E2E Validation

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| `/e2e-validate` | Build and run an exhaustive E2E validation suite for a module — analyzes real-world usage, designs 10–15 high-coverage tests, implements them, executes them, and **root-causes & fixes any gaps discovered in any module**. | `[module-or-plan-path]` (e.g., `M3b`, `blprnt-M01-*.md`)<br>`--analysis-only`, `--skip-execution`, `--rerun`<br>`--focus "<area>"`, `--include-cross-module`<br>`--timeout=<seconds>` (default 30 per test) | E2E test suite, validation report, cross-module fixes |

**Why this exists**: unit tests verify code; E2E validation verifies *real-world usage*. The command picks 10–15 tests with the best coverage-to-effort ratio (core feature paths, data flow integrity, cross-module integration, error/edge cases, safety/security invariants), implements them, runs them, and **fixes any defect at its origin** — even if the fix lives in a different module than the one being validated. Cross-module fixes are documented in the validation report.

---

### Design & UI

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| `/design-ui` | Generate wireframes (Markdown + ASCII) from a plan. Discovers and follows the project's existing design system. Parallel agents per screen. | `[plan-path]`<br>`--with-mockups` (HTML/CSS/JS prototypes)<br>`--mockups-only`, `--module <name>`<br>`--update`, `--verify`, `--sync-blueprints`, `--guide`<br>`--timeout=<seconds>` (default 90) | `design/wireframes/{Feature}/*.md`<br>`design/mockups/{Feature}/*.html` (if `--with-mockups`) |

`/verify-ui` is invoked automatically as one of the 6 parallel agents in `/implement-plan`'s verify-loop, so wireframe/mockup compliance is gated, not optional.

---

### Context Management

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| `/sync-context` | Incrementally update context files (CLAUDE.md, status, registry) based on git history. Delta-based syncing with registry reconciliation. | `status` (show state only)<br>`--full` (ignore last sync)<br>`--exhaustive` (deep codebase scan → CLAUDE.md enrichment)<br>`--dry-run`, `--verbose` | Updated context files, sync state |
| `/optimize-context` | Audit and compress auto-loaded files (CLAUDE.md, rules, MEMORY.md). Extracts sections to skills, path-scopes rules, archives old plans. | `audit` (read-only report)<br>`--dry-run`<br>`--plans-age=<N>` (default 30 days)<br>`--docs-age=<N>` (default 60 days) | Audit report, compressed files, archived content |

---

### Plan Optimization

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| `/optimize-plan` | Compress a plan document — eliminate duplication, cross-reference instead of restate, collapse verbose prose into tables — while preserving every unique data point. | `[plan-path]` (or prompt user to pick from `context/plans/`) | Optimized plan, `.bak` backup, compression report |

Useful when a plan file has grown to 3,000+ lines from iterative `/analyze-plan` and remediation passes — `/optimize-plan` shrinks it 40–60% with **zero knowledge loss**.

---

### Git & Commits

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| `/commit` | Stage all changes, run security scans (gitleaks, secret patterns), TypeScript/ESLint/Prettier checks, generate a conventional commit message, commit locally. | `[message]`<br>`--no-push`<br>`--amend` | Git commit with conventional message |

**Pre-commit checks (BLOCKING)**:
- Gitleaks secret scan
- Manual secret pattern scan
- Sensitive file check (`.env`, `.pem`, credentials, etc.)
- TypeScript type check (`npx tsc --noEmit`)
- ESLint with `--max-warnings=0`
- Prettier format check
- **Does NOT run**: tests (those belong in CI/CD)

---

### Agent Management

| Command | Purpose | Output |
|---------|---------|--------|
| `/recommend-agents` | Analyze project/plan, recommend agents from `~/.claude/_repo/` catalog, install selected to `.claude/agents/`, optimize for context window (80–150 lines each), configure routing rules. | Installed agents, routing rules, optimization report |

> The agent catalog in `~/.claude/_repo/` is sourced from [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents). Definitions are adapted and stripped of boilerplate for context efficiency.

---

### Project Operations

| Command | Purpose | Key Flags | Output |
|---------|---------|-----------|--------|
| `/start-debug-server` | Start development server(s) with debug logging. Auto-detects tech stack on first run, caches config in CLAUDE.md. Kills existing processes on detected ports. | `backend`, `frontend`, `all`, `detect` | Running dev servers, config in CLAUDE.md |
| `/slack enable [channel-id]` | Register project for Slack integration | — | Project registered to channel |
| `/slack connect` | Connect current Claude Code session to a Slack thread | — | Thread created in project's channel |
| `/slack disconnect` | Disconnect session from Slack | — | Thread archived |
| `/slack status` | Show Slack integration status | — | Project + session status |
| `/slack disable` | Temporarily disable Slack for this project | — | Slack disabled (still registered) |

**Slack prerequisites**: integration daemon running (`~/.claude/slack_integration/`).

---

## Command Relationships

```
              ┌────────────┐
              │   /plan    │  ← Entry point: idea → structured plan
              └──────┬─────┘
                     │ generates (+ auto /analyze-plan)
                     ▼
              ┌────────────────┐
              │ plan-*.md file │
              └───────┬────────┘
                      │
                      ▼
            ┌──────────────────┐
            │ /recommend-agents│  ← Install agents for this project
            │   (optional)     │
            └────────┬─────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
  ┌──────────────┐        ┌──────────────┐
  │/implement-plan│       │  /blueprint  │  ← For complex systems
  │ (simple)      │       │  (3-layer)   │
  └──────┬────────┘       └──────┬───────┘
         │                         │ creates
         │                         ▼
         │            ┌────────────────────────┐
         │            │  blprnt-*.md files     │
         │            │  impl-*.md files       │
         │            │  registry              │
         │            └────────────┬───────────┘
         │                         │
         └────────────┬────────────┘
                      │
                      ▼
               ┌─────────────┐
               │ /design-ui  │  ← For UI features (wireframes + mockups)
               │ (optional)  │
               └──────┬──────┘
                      │
         ┌────────────┴────────────┐
         │                         │
         ▼                         ▼
  ┌───────────────┐        ┌────────────────┐
  │/implement-plan│◄──┐    │/implement-batch│  ← Autonomous multi-module
  └───────┬───────┘   │    └───────┬────────┘
          │           │            │ (each module runs /implement-plan)
          ▼           │            ▼
  ┌────────────────────────────────┐
  │  VERIFY-LOOP (max 5×)          │
  │  6 parallel agents:            │
  │  • Implementation   • Security │
  │  • Logging          • UI       │
  │  • Testing          • Stubs    │
  │  Auto-fix between iterations.  │
  │  PASS = 2 consecutive clean.   │
  └──────────────┬─────────────────┘
                 │
       ┌─────────┴─────────┐
     PASS              FAIL (5 iter)
       │                   │
       ▼                   ▼
  ┌────────────┐    ┌────────────────┐
  │ STUB GATE  │    │ ❌ VERIFICATION│
  │ (2 rounds) │    │   _FAILED      │
  └─────┬──────┘    │ DO NOT MERGE   │
        │           └────────────────┘
   ┌────┴─────┐
 (0 act.)  (act. left)
   │           │
   ▼           ▼
✅ COMPLETE   ⚠️ STUB_GATE_FAILED
   │
   ▼
┌────────────────────────────────────────────────┐
│ Optional post-implementation hardening:        │
│  • /e2e-validate M<N> — exhaustive E2E suite   │
│  • /audit-pending-items — registry sweep       │
│  • /codebase-audit — full quality review       │
│  • /verify-ui — design compliance              │
└──────────────────┬─────────────────────────────┘
                   │
                   ▼
              ┌─────────┐
              │ /commit │  ← Atomic commit per phase, all gates pass
              └─────────┘
```

---

## Context Window Optimization

### 1. Layered loading

```
┌─────────────────────────────────────────────────────────────┐
│  ALWAYS LOADED (~3,000–4,000 tokens target)                 │
│  • CLAUDE.md (project instructions)                         │
│  • .claude/agents/* (installed agents)                      │
│  • Active rules files                                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  ON-DEMAND (loaded when relevant)                           │
│  • context/blueprints/* (architecture specs)                │
│  • context/implementation/* (code specs)                    │
│  • design/wireframes/*, design/mockups/*                    │
│  • context/implementation-status.md                         │
│  • context/pending-items-registry.md                        │
│  • context/TODOS.md                                         │
└─────────────────────────────────────────────────────────────┘
```

### 2. Token budget guidelines

| Component | Target Size | Strategy |
|-----------|-------------|----------|
| `CLAUDE.md` | < 500 lines | Extract large sections to on-demand skills |
| Agents | 80–150 lines each | Strip boilerplate, keep essential logic |
| Auto-loaded total | 3,000–4,000 tokens | Use `/optimize-context audit` to check |

### 3. Path-scoped rules

Use `paths:` frontmatter so rules load only when working in the relevant directories:

```yaml
---
paths:
  - src/api/**
  - src/services/**
---
# API Development Rules
…
```

### 4. Session boundaries

- **Plan in one session, implement in another** — prevents context bloat.
- **Use `/compact` at ~70% capacity** — don't wait for auto-compact at 95%.
- **Fresh sessions for new features** — start clean with relevant context.

### 5. Context commands cheat sheet

| Command | Use Case |
|---------|----------|
| `/optimize-context audit` | Check current context size and get recommendations |
| `/optimize-context` | Compress auto-loaded files (requires confirmation) |
| `/sync-context` | Update context files incrementally from git changes |
| `/sync-context --exhaustive` | Deep codebase scan → enrich CLAUDE.md |
| `/optimize-plan <plan>` | Compress a bloated plan document |

---

## Recommended Workflows

### Workflow A — Quick feature (no blueprint)

Best for: small features, bug fixes, minor enhancements.

```
1. /plan --quick            # Simple plan (skips deep discovery)
2. /implement-plan          # Verify-loop + stub gate
3. /commit                  # Commit changes
```

**When to use**: feature is well-understood, affects few files, no architectural decisions needed.

---

### Workflow B — Full planning flow (standard)

Best for: new features with some complexity that need clarification.

```
1. /plan "feature idea"     # Interactive Q&A (+ auto /analyze-plan)
2. /recommend-agents        # Install relevant agents
3. /implement-plan          # Verify-loop + stub gate
4. /commit
```

**When to use**: requirements need clarification, technology choices need validation, or scope needs definition.

---

### Workflow C — Complex system (full blueprint)

Best for: new modules, large features, multi-component systems.

```
1. /plan --research         # Planning with web research (+ auto /analyze-plan)
2. /recommend-agents        # Install agents for architecture/implementation
3. /blueprint               # Three-layer architecture (auto-verifies)
4. /design-ui --with-mockups # (If UI) Wireframes + interactive mockups
5. /implement-plan M1       # Implement module 1 (verify-loop + stub gate)
6. /implement-plan M2       # Implement module 2
7. …                        # Continue per module
8. /commit                  # Final commit (only if all modules ✅ COMPLETE)
```

**When to use**: work spans multiple modules, requires interface contracts, or benefits from architectural documentation.

---

### Workflow D — Batch execution (autonomous multi-module)

Best for: large blueprints with many modules, overnight execution, maximum automation.

```
1. /plan --research
2. /recommend-agents
3. /blueprint
4. /design-ui --with-mockups (if UI)
5. /implement-batch         # Executes ALL modules autonomously
6. /audit-pending-items     # Registry sweep
7. /e2e-validate <module>   # Exhaustive E2E for the highest-risk module(s)
8. /commit                  # Final commit (only if BATCH PASS)
```

**Resume after interruption**:
```
/implement-batch --resume
```

**When to use**: validated blueprint with many modules, you want Claude to execute autonomously while handling dependencies and context management. **Only ship when BATCH PASS** (all modules `✅ COMPLETE`).

---

### Workflow E — Design-first development

Best for: UI-heavy features, user-facing components.

```
1. /plan "UI feature"
2. /design-ui --with-mockups   # Wireframes + interactive mockups
3. [Manual review in browser]
4. /design-ui --verify         # Audit and auto-fix design specs
5. /implement-plan             # Verify-loop includes /verify-ui
6. /commit
```

**When to use**: feature has significant UI that benefits from visual prototyping before coding.

---

### Workflow F — Verification & analysis loop (manual)

Best for: post-implementation review, quality gates, external code audits.

```
1. /verify-implementation [plan-path] --force   # 6 parallel agents
2. /analyze-plan                                 # Check if plan needs revision
3. /codebase-audit                               # (Optional) Full quality audit
4. /audit-pending-items                          # Registry sweep
5. /commit                                       # Commit when all checks pass
```

**When to use**: manual verification outside `/implement-plan`, before major releases, when quality is critical and you want explicit verification control, auditing code by other developers.

---

### Workflow G — Context maintenance

Best for: long-running projects, session hygiene.

```
1. /sync-context status     # Check what needs updating
2. /sync-context            # Update context from git changes
3. /optimize-context audit  # Check context size
4. /optimize-context        # Compress if needed
5. /optimize-plan <plan>    # (Optional) Compress a bloated plan
```

---

### Workflow H — E2E hardening + pending-items hygiene

Best for: post-feature stabilization, cross-module integration validation, monthly hygiene sweeps.

```
1. /audit-pending-items                # Sweep registry for state changes
2. /audit-pending-items --remediate 5  # Drive top-5 ready Tier-1 items to done
3. /e2e-validate <module>              # Exhaustive E2E + cross-module fix
4. /verify-implementation --all        # Re-verify everything
5. /commit
```

**When to use**: between sprints, after a batch run, or as a recurring hygiene cycle. Especially valuable in team environments.

---

### Testing integration across the workflow

| Stage | Testing activity |
|-------|------------------|
| `/blueprint` | Test strategy defined in module specs |
| `/implement-plan` | Tests written alongside implementation |
| `/verify-implementation` | **6 parallel agents** verify completeness:<br>• Implementation gaps<br>• Logging coverage<br>• Testing coverage (test agent)<br>• Security vulnerabilities<br>• UI compliance (`/verify-ui`)<br>• Stubs (`--stubs`) |
| `/e2e-validate` | Exhaustive real-world E2E suite, root-cause cross-module fixes |
| `/commit` | TypeScript + ESLint + Prettier checks (CI runs full tests) |

> Full test suites belong in CI, not in commit hooks. The workflow commands focus on implementation correctness and code quality.

---

## Sample Application Buildout — End-to-End Walkthrough

This section walks through building a **medium-complexity SaaS application** end-to-end with the workflow, in two scenarios: an individual developer and an enterprise team.

### Use case: "PulseCheck" — a customer-feedback hub

**What it does**:
- Customers submit feedback through a public widget (text + optional screenshot).
- An admin dashboard triages feedback: assign severity, route to a team, mark resolved.
- ML-lite categorization (LLM-based) tags incoming feedback by sentiment + theme.
- Slack and email notifications for new high-severity items.
- Analytics: trending themes over time, response-time SLAs, team load distribution.
- Multi-tenant: each customer org has its own data, users, and settings.

**Why it's a good example**:
- Has UI (widget + dashboard), API, async jobs (LLM categorization, notifications), auth, tenancy, and observability.
- Spans ~6–8 modules, 4–8 weeks of work.
- Has real cross-module contracts (feedback schema, tenant isolation, notification payloads).
- Stress-tests every command in the workflow.

**Tech stack** (as a representative example — the workflow is stack-agnostic):
- Next.js (App Router) + React + Tailwind for the dashboard
- Embeddable JS widget (vanilla TS, < 20 KB)
- Node + Express API in a packages/server workspace
- PostgreSQL + Prisma for storage
- BullMQ + Redis for the async job queue
- Anthropic API (Claude Haiku) for LLM categorization

---

### Scenario 1 — Individual developer (solo founder / indie hacker)

You are a solo developer building PulseCheck as a side project. You want speed without skipping quality gates.

#### Day 1 — Plan and architect (2–3 hours of Claude Code time)

```
$ claude
> /plan --research "Build PulseCheck — a multi-tenant customer feedback SaaS
  with embeddable widget, admin dashboard, LLM categorization, and Slack/email
  notifications. Target stack: Next.js, Postgres, BullMQ."
```

What happens:
1. `/plan` runs Q&A over 2–3 rounds (auth provider? tenant model? widget bundle target?).
2. Auto-invokes `/analyze-plan`. 5 parallel agents flag CRITICAL/HIGH gaps (e.g., "no rate-limiting strategy for the public widget endpoint", "no DLQ for the categorization queue", "no tenant-isolation tests planned").
3. You select all CRITICAL + HIGH gaps; `/analyze-plan` auto-runs `/implement-plan` to patch the plan file.

```
> /recommend-agents
```

It scans the plan and recommends installing: `backend-developer`, `react-specialist`, `ui-designer`, `prompt-engineer`, `llm-architect`, `test-automator`, `code-reviewer`. Installs them to `.claude/agents/` (each ~120 lines after optimization).

```
> /blueprint
```

`/blueprint` produces:
- `context/blueprints/blprnt-master.md` — 13 sections covering tech stack, module index, dependency graph, parallel implementation plan, contracts, milestones, risks.
- 8 module plans: `blprnt-M01-tenancy.md`, `blprnt-M02-feedback-api.md`, `blprnt-M03-widget.md`, `blprnt-M04-categorization.md`, `blprnt-M05-notifications.md`, `blprnt-M06-dashboard.md`, `blprnt-M07-analytics.md`, `blprnt-M08-billing.md`.
- 8 implementation specs in `context/implementation/` (TypeScript interfaces, file maps, error tables).
- `blprnt-registry.md` — progress tracker with stage gates.
- Auto-runs `/blueprint --verify` → prints a ready-score (e.g., 92/100).

```
> /design-ui --with-mockups
```

Generates wireframes for the dashboard (feedback inbox, triage view, analytics tab, settings) and the embedded widget. Each screen gets a Markdown spec + an interactive HTML mockup. You open the mockups in your browser and tweak.

#### Day 2 — Foundational module by hand

```
> /implement-plan M01
```

Implements the tenancy module (M01). After all phases:
- Verify-loop runs (6 parallel agents). Iteration 1 finds 3 medium gaps; auto-fixes. Iteration 2 clean. Iteration 3 clean. **PASS.**
- Stub gate runs. 0 actionable stubs. **`✅ COMPLETE`**.

```
> /commit
```

Pre-commit checks pass; conventional commit message generated. Pushed.

#### Days 3–6 — Batch the rest

```
> /implement-batch --from M02 --to M07
```

Claude executes M02–M07 autonomously across multiple sessions. Each module:
- Runs `/implement-plan` with full verify-loop + stub gate.
- Logs decisions to `context/batch-progress.md`.
- Auto-compacts at >70% context.

When you return after a meeting:

```
> /implement-batch --resume
```

It picks up exactly where it left off. Three modules pass on first verify-loop run; one (M04 — categorization) takes 4 iterations because the LLM prompt has flaky behavior at temperature 0.7. Auto-fix lowers temp to 0.3 and adds a retry-with-backoff. Passes.

After batch completion: 6/6 modules `✅ COMPLETE`. **BATCH PASS.**

#### Day 7 — Hardening before launch

```
> /audit-pending-items
```

Registry shows 4 `BLOCKED` stubs that just transitioned to `READY_TO_REOPEN` (M07 analytics waited on M04 categorization output schema, which now exists).

```
> /audit-pending-items --remediate 4
```

Drives those 4 items through `/implement-plan`-style execution. All `VERIFIED`.

```
> /e2e-validate M02
> /e2e-validate M04
> /e2e-validate M05
```

For the three highest-risk modules, runs the exhaustive E2E suite. M04 validation finds that the categorization queue silently drops messages over 8 KB. Cross-module fix: `/e2e-validate` traces the bug to M02's serialization, fixes M02, re-runs M04 tests. Documented in the validation report.

```
> /codebase-audit
```

Full read-only audit. Score: 87/100. Top issues: missing rate-limiter on `/api/v1/feedback`, two N+1 queries in the analytics tab. You patch them in a normal Claude Code session.

```
> /commit
```

Ship it.

#### Ongoing — weekly hygiene

```
> /sync-context        # Update context from this week's commits
> /audit-pending-items # See if any blocked stubs are ready
> /optimize-context audit
```

When the plan file gets unwieldy after months of iteration:

```
> /optimize-plan context/plans/plan-pulsecheck-2026-04-01.md
```

Compresses 4,200 lines to 2,100 with zero knowledge loss.

---

### Scenario 2 — Enterprise team (4–8 engineers + designer + tech lead + QA)

A startup's platform team is building PulseCheck as a new product line. Engineers want autonomy but the org needs traceability, code review, and shared standards.

#### Roles and command ownership

| Role | Primary commands | Secondary |
|------|------------------|-----------|
| **Product / Eng lead** | `/plan --research`, `/blueprint`, `/analyze-plan`, `/optimize-plan` | `/codebase-audit` (pre-release) |
| **Designer** | `/design-ui --with-mockups`, `/verify-ui`, `/design-ui --verify` | `/design-ui --update` |
| **Module owner (eng)** | `/implement-plan M<N>`, `/verify-implementation`, `/commit` | `/e2e-validate M<N>` |
| **Tech lead** | `/blueprint --verify`, `/audit-pending-items`, `/codebase-audit` | `/sync-context --exhaustive` |
| **QA / Test eng** | `/e2e-validate`, `/verify-implementation --all` | `/verify-ui` |
| **Anyone** | `/todo`, `/slack connect` | — |

#### Phase 1 — Architecture review (week 1)

The eng lead drives planning solo, then the team reviews the artifacts in a regular PR — not over Slack chat.

```
$ claude
> /plan --research "PulseCheck — multi-tenant feedback SaaS …"
> /blueprint
```

The lead opens a PR titled `chore: PulseCheck blueprint` containing:
- `context/plans/plan-pulsecheck-*.md`
- `context/blueprints/blprnt-*.md` (master + 8 modules)
- `context/implementation/impl-*.md`
- `context/blueprints/blprnt-registry.md`
- `design/wireframes/**`, `design/mockups/**`

Reviewers:
- **Tech lead** runs `/blueprint --verify` locally; comments on contract gaps and dependency-graph issues.
- **Designer** opens the mockups in a browser, comments on flow issues; uses `/design-ui --update` to push fixes.
- **Senior engineers** review the implementation specs of modules they'll own.

PR merged → blueprint locked → module ownership assigned in `blprnt-registry.md` (S5 Module Index has an `Owner` column).

#### Phase 2 — Parallel module implementation (weeks 2–6)

Each module owner works on their assigned modules:

```
$ claude
> /implement-plan M02   # Owner: alice@acme.com
```

The verify-loop catches issues per module — **the engineer cannot merge a module that is `❌ VERIFICATION_FAILED` or `⚠️ STUB_GATE_FAILED`**. This is the contract with reviewers: only `✅ COMPLETE` modules get merged.

Cross-module contracts are frozen by S7 of the master blueprint. If M02's owner needs to change the feedback schema, they:
1. Comment in the PR: "Need to add `priority_hint` to `FeedbackPayload`."
2. Tech lead amends the contract registry.
3. M03/M04/M06 owners pull the change.
4. Each consumer module re-runs `/verify-implementation` to confirm consumers still pass.

The team uses `/slack enable C0123ABC` and `/slack connect` to surface session activity in a `#pulsecheck-build` channel — no chat-app context-switching to share progress.

`/todo` is used for cross-module coordination items that don't belong in the registry:

```
> /todo add "Decide if widget bundle goes through CDN or self-hosted before M03 ships"
```

#### Phase 3 — Integration & hardening (week 7)

The tech lead runs an org-wide sweep:

```
> /audit-pending-items
```

The registry shows **17 items**: 9 `VERIFIED` (already shipped), 5 `BLOCKED → READY_TO_REOPEN` (transitions detected this run), 2 `IN_PROGRESS`, 1 `DEFERRED`. The tech lead assigns the 5 ready items:

```
> /audit-pending-items --assign GAP-STUB-a1b2c3d4 alice
> /audit-pending-items --assign GAP-WIRING-e5f6g7h8 bob
…
```

QA runs E2E validation for the highest-risk modules:

```
> /e2e-validate M02 --include-cross-module
> /e2e-validate M04
> /e2e-validate M05 --focus "slack notification"
```

E2E validation finds a tenant-isolation leak in M02 (the search endpoint returned other tenants' feedback if the search query included a UUID matching a foreign tenant's row). `/e2e-validate` traces, fixes M02, adds a permanent regression test, documents the cross-module fix in the validation report. **The registry auto-updates** — `GAP-WIRING-e5f6g7h8` moves to `RESOLVED`.

#### Phase 4 — Pre-release audit (week 8)

```
> /codebase-audit
```

Tech lead runs the full audit. Score 91/100. Three SECURITY items flagged (missing CSRF on widget admin endpoints). Tickets opened in `/todo` and `/audit-pending-items`. Patched within a day.

```
> /verify-implementation --all
```

All 8 modules re-verified. All `✅ COMPLETE`.

```
> /commit
```

Release branch cut. PulseCheck v1.0 ships.

#### Ongoing — recurring team hygiene

| Cadence | Command | Owner |
|---------|---------|-------|
| Per PR | `/verify-implementation`, `/commit` | PR author |
| Daily | `/sync-context` | Each engineer (or hook in `.claude/settings.json`) |
| Weekly | `/audit-pending-items`, `/audit-pending-items --remediate 3` | Tech lead |
| Bi-weekly | `/e2e-validate <highest-risk-module>` | QA |
| Monthly | `/codebase-audit`, `/optimize-context audit` | Tech lead |
| Per release | `/verify-implementation --all`, `/audit-pending-items` | Tech lead |

#### Key team practices that fall out of the workflow

1. **The blueprint is the source of truth, not the chat log.** Architecture decisions live in `blprnt-master.md` S2 + S7. Deviations are logged in the registry, not lost in Slack threads.
2. **The pending-items registry is the team backlog.** Every `BLOCKED` stub has a stable ID, an owner, and re-open criteria. When a blocker module ships, every dependent item flips to `READY_TO_REOPEN` automatically — no Jira hygiene required.
3. **Verification is not optional.** Engineers cannot merge `❌ VERIFICATION_FAILED` or `⚠️ STUB_GATE_FAILED` modules. The CI surface for the verify-loop's status report is the team's quality bar.
4. **E2E validation finds cross-module bugs.** `/e2e-validate` is the only command that fixes defects in modules other than the one being validated — invaluable for catching tenant-isolation bugs, schema drift, queue-message corruption.

---

## Best Practices

### Planning

1. **Start with `/plan`** — it's the entry point for all new work.
2. **Use `--research` for greenfield projects** — web research informs better decisions.
3. **Use `/blueprint` for complex systems** — the overhead pays off in clarity.
4. **Get blueprint ready-score to 90%+** before implementing.
5. **Review verification playbooks (S7)** — they define what "done" means.
6. **Plan in a dedicated session** — don't mix planning and implementation.
7. **Run `/optimize-plan`** when a plan file grows past ~3,000 lines.

### Implementation

1. **One module at a time** — complete and verify before moving on.
2. **Follow the implementation spec** — don't deviate without updating the registry.
3. **Use TodoWrite** — track phases and mark complete immediately.
4. **Never skip verification** — `/implement-plan` includes mandatory verify-loop + stub gate.
5. **Understand tri-state completion** — `✅ COMPLETE`, `❌ VERIFICATION_FAILED`, `⚠️ STUB_GATE_FAILED`.
6. **Don't claim success on verification failure** — incomplete implementations must be reported accurately.
7. **Batch execution enforces the same workflow** — every `/implement-batch` module runs its full verify-loop + stub gate.

### Design

1. **Generate wireframes early** — clarifies requirements before coding.
2. **Use `--with-mockups`** — interactive prototypes catch issues faster.
3. **Run `--verify` before implementation** — ensures specs are complete.
4. **UI verification is automatic** — `/verify-ui` runs as one of the 6 parallel agents in the verify-loop.

### Verification

1. **Automatic within `/implement-plan`** — verify-loop + stub gate run automatically.
2. **Manual verification available** — `/verify-implementation [plan-path] --force` for standalone runs.
3. **Query stub status** — `/verify-implementation --status [module]` checks the stub gate without re-running everything.
4. **Fix gaps before continuing** — don't accumulate tech debt.
5. **Use `/analyze-plan` for systemic issues** — gaps might indicate plan problems.

### Pending items & TODOs

1. **Run `/audit-pending-items` weekly** — registry transitions catch unblocked work.
2. **Use the registry, not chat** — every gap has a stable ID, owner, re-open criteria.
3. **Categorize stubs deliberately** — `TODO-STUB-ACTIONABLE` for must-fix, `TODO-STUB-BLOCKED(M07)` for cross-module dependencies, `TODO-STUB-MVP` for intentional scope deferral.
4. **`/todo` is for project-level intentions** — the registry is for code-level gaps.

### E2E validation

1. **Run `/e2e-validate` per module after stabilization** — not before; it depends on having implementation to test.
2. **Trust cross-module fixes** — `/e2e-validate` will fix the actual root cause module, not the symptom module.
3. **Use `--focus`** to narrow scope on follow-up runs.
4. **Document DEFERRED findings** — when a fix requires architectural change, log it in the report and the registry.

### Commits

1. **Atomic commits** — one commit per completed phase.
2. **Security scanning is automatic** — gitleaks runs before commit.
3. **Never `--no-verify`** — if hooks fail, fix the issue.
4. **No force push to main** — always use branches.

### Context management

1. **Keep CLAUDE.md under 500 lines** — extract to skills.
2. **Optimize agents to 80–150 lines** — minimal but effective.
3. **Use `/compact` proactively** — at 70%, not 95%.
4. **Start fresh sessions** — for new features or when context is heavy.
5. **Run `/sync-context --exhaustive`** when CLAUDE.md gets stale.

### Team workflows

1. **Lock the blueprint before parallel work** — S7 contracts must be frozen.
2. **Module ownership in `blprnt-registry.md` S5** — every M-ID has a single owner.
3. **PR the blueprint** before any code is written.
4. **Tech lead drives `/audit-pending-items`** weekly.
5. **QA owns `/e2e-validate`** for high-risk modules.
6. **Wire `/slack` for visibility** — every session can post status to a project channel.

---

## Quick Start

### 1. Bootstrap a new project

```bash
# Copy CLAUDE.md template to your project
cp /path/to/claudeworkflow/CLAUDE.md ./CLAUDE.md

# Create required directories
mkdir -p \
  .claude/agents \
  context/plans context/blueprints context/implementation context/remediation \
  design/wireframes design/mockups

# (In Claude Code) install project-specific agents
/recommend-agents
```

### 2. First feature (simple)

```
$ claude
> /plan "Add user authentication"     # Interactive planning + auto /analyze-plan
> /implement-plan                     # Verify-loop + stub gate
> /commit                             # Only if ✅ COMPLETE
```

### 3. First feature (complex)

```
$ claude
> /plan --research "Build notification system"  # Planning + auto /analyze-plan
> /recommend-agents                              # Install relevant agents
> /blueprint                                     # Three-layer architecture (auto-verifies)
> /design-ui --with-mockups                      # (If UI)
> /implement-batch                               # All modules autonomously
> /audit-pending-items                           # Registry sweep
> /e2e-validate <module>                         # E2E for highest-risk modules
> /commit                                        # Only if BATCH PASS
```

### 4. Ongoing maintenance

```
> /sync-context           # Update context files from git
> /audit-pending-items    # See state transitions
> /optimize-context audit # Check context size
> /codebase-audit         # Periodic quality review
```

---

## Files Created by Commands

| File | Created By | Purpose |
|------|------------|---------|
| `context/plans/plan-*.md` | `/plan` | Implementation-ready plan from idea |
| `context/implementation-status.md` | `/implement-plan` | Module status tracking |
| `context/batch-progress.md` | `/implement-batch` | Batch execution progress and checkpoints |
| `context/.sync-state.json` | `/sync-context` | Incremental sync state (gitignored) |
| `context/blueprints/blprnt-*.md` | `/blueprint` | Architecture specs |
| `context/blueprints/blprnt-registry.md` | `/blueprint` | Cross-module progress + deviations |
| `context/implementation/impl-*.md` | `/blueprint` | Code-level specs |
| `context/implementation/impl-contracts.md` | `/blueprint` | Cross-module contract registry |
| `context/remediation/plan-remediation-*.md` | `/analyze-plan` | Temporary remediation plans |
| `context/pending-items-registry.md` | `/audit-pending-items` | Persistent gap registry |
| `context/TODOS.md` | `/todo` | Project TODO list |
| `context/scratch/*-scratch-*.json` | `/analyze-plan`, `/verify-implementation` | Mid-phase findings (auto-deleted) |
| `context/sessions/context-audit-*.md` | `/optimize-context` | Context audit reports |
| `design/wireframes/**/*.md` | `/design-ui` | UI wireframes |
| `design/mockups/**/*.html` | `/design-ui --with-mockups` | Interactive prototypes |

---

## Acknowledgments

- **Agent definitions** in `~/.claude/_repo/` are sourced from [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents). They have been adapted and optimized for context-window efficiency in this workflow system.

---

## License

See `LICENSE` for license information.
