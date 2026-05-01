---
description: Build and run an exhaustive E2E validation suite for a module — analyzes real-world usage, designs 10-15 high-coverage tests, implements them, executes them, and root-causes any gaps found across all modules.
---

# E2E Validate

**Command**: `/e2e-validate [module-or-plan-path]`
**Usage**: `/e2e-validate M3b` | `/e2e-validate context/blueprints/blprnt-M01-element-intelligence.md` | `/e2e-validate` (auto-detect)

Build an exhaustive E2E validation suite that tests a module's core features, data flows, and integrations with other modules. Analyzes real-world usage patterns, designs 10-15 tests with the best coverage-to-effort ratio, implements them, executes them, and **root-causes and fixes any gaps discovered — in this module or any other module involved**.

## Arguments
- `$ARGUMENTS` - Module ID (e.g., `M3b`, `M01`, `M7`), plan/blueprint path, or keyword to match
- `--analysis-only` - Generate test plan without implementing or running tests
- `--skip-execution` - Build tests but do not run them
- `--focus "<area>"` - Narrow scope to a specific area (e.g., `--focus "offline"`, `--focus "privacy"`)
- `--timeout=<seconds>` - Per-test timeout in seconds (default: 30). Total suite timeout = timeout * test_count * 2.
- `--include-cross-module` - Force inclusion of cross-module integration tests even if the module appears isolated
- `--rerun` - Re-execute an existing E2E validation suite without regenerating tests

Use TodoWrite. Execute autonomously from start to finish.

<!--
@include ./_shared-autonomous.md
@include ./_shared-agent-timeout.md
-->

---

## Core Rule: Root-Cause and Fix All Gaps

> **MANDATORY**: Any gap, failure, or inconsistency discovered during ANY phase of this command — test design, implementation, execution, or analysis — MUST be root-caused and fixed at its origin, regardless of which module owns the faulty code.
>
> This is NOT a read-only audit. E2E validation exists to surface real problems. When a problem is found:
>
> 1. **Trace to root cause** — Follow the failure from symptom to origin. A test failure in M3b may be caused by incorrect data from M01, a missing field in M2 contracts, or a silent error in M10 privacy scrubbing.
> 2. **Fix at the source** — Apply the fix in whichever module owns the defect. Do NOT paper over upstream bugs with workarounds in the test or the module under test.
> 3. **Fix scope is unrestricted** — Source code, contracts, schemas, configs, type definitions, other modules' code, shared helpers, test infrastructure — anything that is genuinely broken gets fixed.
> 4. **Validate the fix** — After fixing, rerun the failing test(s) to confirm the fix resolves the issue without introducing regressions.
> 5. **Document cross-module fixes** — When a fix touches a module other than the one under test, record it in the validation report with: affected module, what was wrong, what was changed, and which test now passes.
>
> The only exception: if a fix requires architectural changes beyond the scope of a point fix (e.g., redesigning an API contract used by 5+ consumers), document the issue as a **DEFERRED** finding with a clear description of the required change, and move on.

---

## Phase 1: Module Discovery & Context Loading

### 1. Resolve Target Module

**Priority order:**
1. Explicit `$ARGUMENTS` — module ID or file path
2. Session context — check TodoWrite todos, recent `/implement-plan` or `/blueprint` invocations
3. `context/implementation-status.md` — if exactly ONE module is `IN PROGRESS`, use it
4. If ambiguous, prompt: "Multiple candidates: [list]. Specify which module to validate."

### 2. Load Module Context

Read ALL of the following (skip missing files gracefully):

| Source | Purpose |
|--------|---------|
| Architecture spec (`docs/architecture/NN-*.md`) | Design intent, safety invariants, data schemas |
| Blueprint (`context/blueprints/blprnt-M*.md`) | Module boundaries, verification playbook, integration points |
| Implementation spec (`context/implementation/impl-M*.md`) | File map, TypeScript interfaces, internal contracts |
| Source code (`packages/*/src/**`) | Actual implementation to test |
| Existing tests (`packages/*/test/**`) | What's already covered — avoid duplication |
| Cross-reference matrix (`docs/architecture/CROSS-REFERENCE-MATRIX.md`) | Module dependencies and data flows |
| Config schemas | Runtime configuration shapes |

### 3. Map Module Dependencies

From the architecture spec and cross-reference matrix, identify:
- **Upstream modules**: What this module consumes (data, APIs, events)
- **Downstream modules**: What consumes this module's output
- **Shared contracts**: Zod schemas, TypeScript interfaces bridging modules
- **Integration surfaces**: Where data crosses module boundaries

### 4. Catalog Existing Test Coverage

Scan `packages/*/test/` for tests touching this module. Classify:
- **Unit tests**: Isolated function/class tests
- **Integration tests**: Multi-component within the module
- **E2E tests**: Full pipeline / subprocess-based tests
- **Cross-module tests**: Tests that exercise cross-boundary data flow
- **Parity tests**: Tests that assert consistency across packages

Identify gaps: which real-world scenarios are NOT covered by existing tests?

**Gap discovery rule**: If cataloging reveals that existing tests have incorrect assertions, outdated imports, or stale test data, fix them now — don't carry forward known-broken tests.

### 5. Pipeline Wiring Analysis

Determine whether the module is fully wired into the end-to-end pipeline:

**5a. Where does this module plug in?**
- Identify every integration point where this module MUST be wired: imports, re-exports, barrel files, factory registrations, CLI command registrations, config schema entries, DI bindings, route tables, middleware chains, event subscriptions, and pipeline stage arrays.
- For each integration point, verify the wiring EXISTS in source code — not just in the architecture spec.

**5b. Is it completely wired?**
- Compare the module's declared integration surface (from architecture spec, blueprint, and cross-reference matrix) against actual source code wiring.
- Flag any integration point that is specified in the design but missing in source code as `UNWIRED`.
- Flag any wiring that exists in source but points to stubs, no-ops, or TODO placeholders as `PARTIAL`.

**5c. Cross-module wiring dependencies**
- Identify any wiring that is BLOCKED because another module hasn't been implemented yet or hasn't exposed the required export/API. These are `BLOCKED-UPSTREAM`.
- Identify any downstream module that SHOULD consume this module but doesn't yet wire to it. These are `UNWIRED-DOWNSTREAM`.
- For anything that is NOT blocked by an unimplemented module — i.e., the code exists but the wiring is simply missing — **fix it immediately**, regardless of which module the wiring fix falls into. This follows the same cross-module fix philosophy as the Core Rule.

**5d. Downstream-depended stubs**
- Identify any stubs in this module that downstream modules import, call, or depend on.
- For each such stub, check whether it is marked with a tracking marker (`TODO-STUB-BLOCKED(M<ID>)`, `TODO-STUB-ACTIONABLE`, etc.) so it can be resolved when the downstream module is built.
- If a downstream-depended stub is NOT marked, add the appropriate marker now with the downstream module ID(s) that depend on it.
- Record these in the pipeline wiring output as `DOWNSTREAM-DEPENDED-STUBS` with their marker status.

**Output (append to Phase 1 output):**
```
PIPELINE WIRING:
  FULLY WIRED: [list of confirmed integration points]
  UNWIRED: [list — these will be fixed in Phase 4]
  PARTIAL: [list — stubs/no-ops that need completion]
  BLOCKED-UPSTREAM: [list — waiting on another module, with blocker module ID]
  UNWIRED-DOWNSTREAM: [list — downstream modules that should consume but don't]
  DOWNSTREAM-DEPENDED-STUBS: [list — stubs consumed by downstream modules, with marker status]
  WIRING FIXES APPLIED (Phase 1): [N] — [brief description of any immediate fixes]
```

**Fix rule**: Any `UNWIRED` or `PARTIAL` item where the required code exists on both sides gets fixed NOW (during Phase 1, before test design). Do not wait for test failures to discover missing wiring — it is a first-class analysis output. `BLOCKED-UPSTREAM` items are recorded but not fixable here; they feed into the Phase 5 report as deferred recommendations. `UNWIRED-DOWNSTREAM` items where the downstream module exists and has the integration surface ready are fixed immediately.

**Output:**
```
MODULE: [name] (M[ID])
DEPENDENCIES: upstream=[list], downstream=[list]
EXISTING TESTS: unit=[N], integration=[N], e2e=[N], cross-module=[N]
COVERAGE GAPS: [list of untested scenarios]
EXISTING TEST ISSUES: [any broken/stale tests found during cataloging]
```

---

## Phase 2: Test Case Design (Exhaustive Analysis)

Design 10-15 E2E test cases that maximize real-world coverage. Each test must justify its existence by covering a scenario that no other test covers.

### 2.1 Analysis Dimensions

Evaluate the module across ALL of these dimensions and select the highest-value test for each:

**A. Core Feature Validation (3-5 tests)**
- Happy path: The primary use case works end-to-end with realistic data
- Feature variants: Each major feature branch/mode exercised at least once
- Configuration: Non-default config values produce correct behavior changes

**B. Data Flow & Integrity (2-3 tests)**
- Input-to-output pipeline: Raw input enters the module, correct output emerges
- Data completeness: Every field in the output schema is populated (no undefined/null where values are expected)
- Data transformation accuracy: Intermediate transformations produce correct results
- Schema compliance: Output conforms to declared Zod/TypeScript contracts

**C. Cross-Module Integration (2-3 tests)**
- Upstream contract: Module correctly consumes upstream module output (real data, not mocks)
- Downstream contract: Module output is correctly consumed by downstream modules
- Shared state: Any shared state (files, config, events) is read/written correctly across boundaries
- If existing E2E tests from other modules exercise the boundary, IMPORT and extend them rather than duplicating

**D. Error & Edge Cases (2-3 tests)**
- Graceful degradation: Module handles upstream failures without crashing
- Boundary conditions: Empty inputs, maximum-size inputs, concurrent access
- Timeout/budget: Time-bounded operations respect their budgets
- Offline/disconnected: If module has offline capability, validate it works without network

**E. Safety & Security Invariants (1-2 tests)**
- Every P0 safety invariant from the architecture spec gets at least one E2E assertion
- PII/privacy: No raw PII leaks through the data pipeline
- No fabrication: Module never produces data it didn't derive from real inputs

### 2.2 Test Case Specification

For each test, define:

```
TEST [N]: [descriptive-name]
DIMENSION: [A/B/C/D/E] — [sub-category]
SCENARIO: [What real-world usage this simulates]
MODULES INVOLVED: [M-IDs]
PRECONDITIONS: [Setup required — fixtures, config, state]
STEPS:
  1. [Action]
  2. [Action]
  ...
ASSERTIONS:
  - [What to verify]
  - [What to verify]
COVERAGE JUSTIFICATION: [Why this test exists — what gap it fills]
DATA FLOW: [input] → [module A] → [module B] → [output]
EXISTING TEST OVERLAP: [None / partial overlap with test X — this test adds Y]
```

### 2.3 Prioritization & Deduplication

After designing all candidates:
1. **Rank by coverage value**: Tests covering more untested paths rank higher
2. **Eliminate redundancy**: If two tests cover substantially similar paths, merge or drop one
3. **Ensure invariant coverage**: Every safety invariant from the arch spec MUST have at least one test
4. **Balance dimensions**: No dimension should have 0 tests; aim for roughly even distribution
5. **Final count**: 10-15 tests. If analysis yields fewer than 10 high-value tests, do not pad with low-value tests — report why fewer suffice.

**Design-time gap rule**: If designing a test reveals that a module's interface is missing a field, returning wrong types, or has an undocumented behavior, record the gap immediately. These feed into Phase 4 root-cause analysis — do not wait for runtime failures to discover design-time issues.

**Output the test plan as a numbered table:**
```
| # | Test Name | Dimension | Modules | Key Assertion | Gap Filled |
|---|-----------|-----------|---------|---------------|------------|
| 1 | ... | A-happy | M3b, M3a | ... | ... |
```

If `--analysis-only`, output the test plan and EXIT. Do not proceed to Phase 3.

---

## Phase 3: Test Implementation

### 3.0 Full Autonomy on Test Design

> **You have full autonomy on how tests are designed and implemented.** There is no prescribed testing pattern you must follow. Your job is to produce the most realistic, highest-signal E2E validation possible for this module — choose whatever combination of tools, frameworks, harnesses, fixtures, and orchestration strategies gives you the best coverage-to-effort ratio.
>
> The patterns in §3.1 are a **non-exhaustive starting catalog**, not a closed list. If the module demands a tool or approach not listed — use it. If a test needs to drive a real browser, spin up a real server, hit a real database, spawn multiple subprocesses, and coordinate all of the above in a single test — do it. Realism beats convention.
>
> Constraints you still must respect: do not mock the module under test, do not fabricate test data where real fixtures exist, do not skip cross-module verification, and do not bypass existing test sequencing/pool rules. Everything else — how you structure the test, what drivers you use, how you orchestrate setup/teardown — is your call.

### 3.1 Testing Arsenal (Non-Exhaustive)

Pick and combine any of the following. Most high-value E2E tests will use 2-4 of these together.

| Category | Tools / Patterns | Typical Use |
|----------|------------------|-------------|
| **Test runner / harness** | Vitest (`describe`/`it`, `pool: 'forks'`, `poolMatchGlobs`, `global-setup.ts`, custom sequencers) | Default orchestrator for all patterns below |
| **Browser automation** | Playwright (`@playwright/test`, `chromium.launch()`, `Page`, `BrowserContext`, tracing, network interception, storage state) | Real DOM interactions, selector validation, visual/behavioral assertions, fingerprint capture, A2 creation loops |
| **MCP / subprocess** | `@modelcontextprotocol/sdk`, `child_process.spawn`, stdio JSON-RPC framing, `@playwright/mcp` upstream | MCP proxy behavior, tool forwarding, substitution audits, session lifecycle, stdin/stdout boundary tests |
| **API / HTTP** | `fetch`, `undici`, `supertest`, `light-my-request` (Fastify inject), raw `http.request`, `nock`, MSW, WebSocket clients, SSE readers | Server route tests, auth exchange, JWT flows, rate limits, streaming endpoints, multi-tenant isolation |
| **Fixture servers** | Static HTTP server for `/fixtures/pages/*.html`, express/fastify in-test servers, `listen(0)` for ephemeral ports, TLS fixtures | Realistic page loads, redirect chains, cookie/CORS scenarios, auth callbacks |
| **Database** | Real Postgres 16 (Docker/testcontainers), `pg`/`postgres-js`, migrations, RLS policy tests, partition tests, direct SQL for setup/assertions | Tenant isolation, schema migrations, query correctness, RLS invariants, HMAC key rotation |
| **Cryptography / security** | Node `crypto` (HMAC, AES-GCM, Ed25519), key rotation harnesses, replay/tamper tests, timing-safe comparisons | Signing, verification, redaction invariants, PII scrub parity |
| **CLI subprocess** | `execa`, `child_process.spawn`, pty harnesses, stdin/stdout assertions, exit-code checks, `--help` snapshot tests | Project CLI subcommands (e.g., register, sync, show-state) |
| **File system / golden files** | `fs/promises`, temp dirs (`mkdtemp`), snapshot assertions, JSON/NDJSON parity, lock files, atomic writes | Trace flushes, last-good snapshots, concurrency locks, `initDirectory` behavior |
| **Concurrency / timing** | `Promise.all` storms, worker threads, artificial latency injection, real timers (avoid fake timers for E2E), `AbortController` | Race conditions, timeout budgets (e.g., 150ms rank calls), lock contention |
| **Network conditions** | Offline simulation (disable fetch / block JWT), slow network, connection refusal, TLS errors | Passthrough mode, degraded-mode assertions, reconnect logic |
| **Cross-package imports** | Multiple workspace packages (`@app/*`) composed in one test | Contract parity, shared Zod schema validation across client/server |
| **Tracing / observability** | Read emitted trace JSON files, assert shape + key fields (e.g., id hashes, audit fields) | Live trace correctness, privacy-safe logging |
| **Docker / containers** | `docker compose` services from repo root, testcontainers-node | Postgres, MCP upstreams, any service the module genuinely needs |

> **Not listed here? Use it anyway.** If the module benefits from a tool you don't see above (a gRPC client, a PDF parser, a headless terminal emulator, a fuzzer, a load generator) and you can justify it against a test's coverage goal — add it. Record the choice in the validation report under "New tools introduced."

Follow existing patterns from the module's test directory first. If the module already has E2E infrastructure (helpers, fixtures, configs), REUSE it before introducing new tooling.

### 3.2 Implementation Rules

**DO:**
- Place tests in `packages/[package]/test/[module]/e2e/` or `packages/[package]/test/[module]/e2e-validate/` if a separate directory avoids confusion with existing E2E tests
- Reuse existing test helpers (`_integration-helper.ts`, `_fingerprint-e2e-helper.ts`, etc.)
- Import from other modules' test fixtures when testing cross-module integration
- Use realistic data — no trivial "foo/bar" test data when real-world structures matter
- Assert data completeness — check every field in output schemas, not just one or two
- Use `pool: 'forks'` for tests that spawn subprocesses (add to `poolMatchGlobs` in vitest config if needed)
- Respect existing test sequencing (e.g., `EngineParityFirstSequencer`) — do not break ordering guarantees
- Add timeout per test: `{ timeout: CONFIGURED_TIMEOUT }` matching the `--timeout` flag
- Exercise the **full arsenal from §3.1** — Playwright browser, real HTTP servers, real Postgres, MCP subprocesses, CLI subprocesses, crypto, WebSocket/SSE, whatever the module genuinely requires for realism
- Introduce new tooling when no existing pattern fits, and record the choice in the Phase 5 report

**DO NOT:**
- Mock the module under test — these are E2E tests; use real implementations
- Duplicate existing test coverage — if an existing test already validates a scenario, skip it or extend it
- Create new test infrastructure from scratch when existing infrastructure can be reused
- Add tests that merely re-assert what unit tests already cover
- Skip cross-module tests because "that's the other module's responsibility"
- Generate synthetic test data when real-world representative data is available in fixtures
- Ignore existing test sequencing or pool configuration constraints

### 3.3 Implementation-Time Gap Detection

While implementing tests, you will read module source code closely. If you discover:
- **Dead code paths** that can never execute
- **Missing error handling** where the arch spec requires it
- **Contract mismatches** between declared types and runtime behavior
- **Stale imports** or references to removed functions
- **Incorrect defaults** that differ from the config schema spec

**Fix these immediately** in the source code before continuing test implementation. Record each fix. These are not test failures — they are bugs caught during code review as a side effect of writing thorough tests.

### 3.4 Cross-Module Integration Pattern

When a test validates cross-module data flow:

1. **Check for existing E2E tests** in the other module's test directory
2. **If exists**: Import the helper/fixture and compose with it
3. **If not exists**: Create the test as a standalone that exercises both modules through their public API
4. **Shared test data**: Place in `packages/[package]/test/fixtures/` or use existing golden files

### 3.5 Per-Test Implementation

For each test in the plan:
1. Create the test file
2. Implement all steps and assertions from the spec
3. Mark the test as implemented in TodoWrite
4. Do NOT run individual tests yet — batch execution in Phase 4

**Output after all tests implemented:**
```
IMPLEMENTED: [N]/[total] tests
FILES CREATED:
  - packages/client/test/[module]/e2e-validate/[test-name].test.ts
  - ...
HELPERS REUSED: [list of existing helpers imported]
NEW HELPERS: [list of any new helpers created, with justification]
SOURCE FIXES DURING IMPLEMENTATION: [N] (details in Phase 5 report)
```

If `--skip-execution`, output the implementation summary and EXIT. Do not proceed to Phase 4.

---

## Phase 4: Test Execution, Root-Cause Analysis & Remediation

### 4.1 Pre-Execution Checks

1. **TypeScript compilation**: Run `npx tsc --noEmit` on the test files to catch type errors
2. **Import resolution**: Verify all imports resolve (no missing modules)
3. **Fixture availability**: Confirm any required fixtures/servers/configs exist

If pre-execution checks fail, fix the issue (type error, missing export, stale import) at its source — which may be in the module code, not the test.

### 4.2 Execute Test Suite

Run the full E2E validation suite:

```bash
npx vitest run --reporter=verbose [test-file-patterns...]
```

**Timeout handling:**
- Per-test timeout from `--timeout` flag (default 30s)
- Total suite timeout = per-test * count * 2
- If a test times out, record it as `TIMEOUT` and continue

### 4.3 Failure Triage & Root-Cause Protocol

For EVERY non-passing test:

**Step 1 — Read the error**
- Full error message, stack trace, and assertion diff

**Step 2 — Classify the root cause**

| Classification | Definition | Action |
|----------------|------------|--------|
| **Test bug** | Test assertion is wrong, setup is incomplete, or test has a race condition | Fix the test |
| **Module bug (this module)** | Module behavior genuinely violates its spec/contract | **Fix the module source code** |
| **Module bug (other module)** | Upstream/downstream module produces incorrect data or violates its contract | **Fix the other module's source code** |
| **Contract bug** | Shared Zod schema, TypeScript interface, or config schema is incorrect/incomplete | **Fix the contract in `packages/contracts`** or wherever it lives |
| **Integration mismatch** | Two modules implement the same contract differently | **Fix whichever module diverged from the spec**; if spec is ambiguous, fix the spec too |
| **Environment issue** | Missing dependency, port conflict, stale build | Fix environment and rerun |

**Step 3 — Apply the fix at the source**

- **This module**: Edit the source file in `packages/[package]/src/`
- **Other module**: Edit the source file in the other module's package
- **Contract**: Edit the schema/type in `packages/contracts/` or the owning package
- **Config**: Fix the config schema or default values
- **Test infrastructure**: Fix shared helpers or fixture setup

**Step 4 — Rerun and verify**
- Rerun the fixed test
- Run any existing tests in the affected module to confirm no regressions
- If the fix touches a contract or shared module, run `pnpm test` across all packages to check for ripple effects

### 4.4 Fix-Rerun Loop

```
FOR EACH failing test:
  attempts = 0
  WHILE test fails AND attempts < 3:
    1. Root-cause the failure
    2. Fix at source (any module)
    3. Rerun the test
    4. If fix touched shared code: run affected packages' test suites
    5. attempts++
  IF still failing after 3 attempts:
    Mark as UNRESOLVED with full diagnosis
```

**Cross-module regression check**: After all fixes are applied, run the full test suite for every module that had source code changes:
```bash
# For each modified package
cd packages/[modified-package] && pnpm test
```

### 4.5 Fix Tracking

Maintain a running log of all fixes applied during execution:

```
FIX LOG:
| # | File Changed | Module | What Was Wrong | What Was Fixed | Tests Affected |
|---|-------------|--------|----------------|----------------|----------------|
| 1 | packages/privacy/src/scrubber.ts | M10 | Missing null check on input field | Added guard clause | Test #7, #11 |
| 2 | packages/contracts/src/schemas/ingest.ts | M2 | Optional field should be required | Changed to z.string() | Test #4 |
```

---

## Phase 5: Results & Report

### 5.1 Generate Validation Report

Output a structured report:

```markdown
# E2E Validation Report: [Module Name] (M[ID])

**Date**: [timestamp]
**Tests**: [pass]/[total] passing | [fail] failing | [timeout] timeout
**Dimensions covered**: A=[N] B=[N] C=[N] D=[N] E=[N]
**Source fixes applied**: [N] (this module: [N], other modules: [N])

## Test Results

| # | Test | Status | Duration | Notes |
|---|------|--------|----------|-------|
| 1 | [name] | PASS | 1.2s | — |
| 2 | [name] | PASS (after fix) | 0.8s | Fixed: [brief] |
| 3 | [name] | UNRESOLVED | — | [diagnosis] |

## Source Fixes Applied

### This Module ([M-ID])
| File | What Was Wrong | What Was Fixed | Commit |
|------|---------------|----------------|--------|
| ... | ... | ... | ... |

### Other Modules
| Module | File | What Was Wrong | What Was Fixed | Commit |
|--------|------|---------------|----------------|--------|
| M10 | packages/privacy/src/... | ... | ... | ... |

### Regression Check
| Package | Tests Run | Result |
|---------|-----------|--------|
| @app/client | 516 | PASS |
| @app/privacy | 284 | PASS |

## Data Flow Validation

| Data Path | Status | Evidence |
|-----------|--------|----------|
| [input] → M[X] → M[Y] → [output] | VERIFIED | Test #N |

## Safety Invariant Coverage

| Invariant | Test(s) | Status |
|-----------|---------|--------|
| S1 — [name] | #N | COVERED |

## Cross-Module Integration Status

| Integration | Modules | Status | Fixes Required |
|-------------|---------|--------|----------------|
| [boundary] | M[X] ↔ M[Y] | VERIFIED | None / [brief] |

## Unresolved Issues

| Issue | Root Cause | Why Unresolved | Recommended Action |
|-------|-----------|----------------|-------------------|
| ... | ... | Requires architectural change | [description] |

## Gaps & Recommendations

- [Any scenarios that should be tested but weren't included, with justification]
- [Any flaky tests that need stabilization]
- [Any module areas where confidence remains low after fixes]
```

### 5.2 Update Context

- Add test file paths to the module's implementation tracking if applicable
- If source fixes were applied to other modules, note the changes in those modules' tracking

---

## Decision Protocol

When facing ambiguous choices during any phase:

1. **Test design ambiguity**: Prefer tests that exercise real data flow over tests that check config parsing
2. **Mock vs. real**: Always prefer real module implementations; mock ONLY external services (network, third-party APIs)
3. **Scope creep**: If analysis reveals the module needs >15 tests for adequate coverage, implement the top 15 by coverage value and list the remainder as recommendations
4. **Cross-module test ownership**: Place the test in the package that owns the PRIMARY module under test. Import the secondary module as a dependency.
5. **Existing test extension vs. new test**: If an existing test covers 70%+ of a planned scenario, extend it rather than creating a new file. Below 70%, create a new test.
6. **Flaky test handling**: If a test passes on first run but fails on rerun (or vice versa), mark as FLAKY and add `{ retry: 2 }` annotation. Do not delete flaky tests.
7. **Fix scope judgment**: When a root-cause leads to a large refactor (touching 5+ files or redesigning an interface), apply the minimal point fix now and record the larger refactor as a DEFERRED recommendation. Do not let perfect be the enemy of working.
8. **Fix vs. report**: DEFAULT is fix. Only defer if the fix is genuinely architectural (not just "touches another module"). Cross-module point fixes are expected and normal — do not defer them.

---

## Anti-Patterns (DO NOT)

- Do NOT mock the module under test — this defeats the purpose of E2E validation
- Do NOT write tests for hypothetical features not yet implemented
- Do NOT paper over module bugs with test workarounds — fix the bug at its source
- Do NOT skip fixing a bug because "it's in another module" — cross-module fixes are in scope
- Do NOT create test infrastructure that duplicates existing helpers
- Do NOT add tests that merely re-assert what unit tests already cover
- Do NOT skip cross-module tests because "that's the other module's responsibility"
- Do NOT generate synthetic test data when real-world representative data is available in fixtures
- Do NOT ignore existing test sequencing or pool configuration constraints
- Do NOT leave known-failing tests without a root-cause analysis
- Do NOT apply fixes without rerunning the affected test to verify the fix works
- Do NOT fix a shared contract without running downstream consumers' tests for regressions
