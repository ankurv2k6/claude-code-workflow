---
description: Shared protocol, not a standalone command. Which tests run when, who runs them, and the test-hygiene rules, for projects with or without a test map.
disable-model-invocation: true
---
<!--
Shared test-selection protocol. Referenced by implement-plan, implement-batch, verify-implementation,
verify-ui and e2e-validate.
Last audit: 2026-10-27 (lanes defer an escalated tier instead of running it: one lane ran 437 web test
files for a theme change, another 11,952 tests, both repeated anyway on the merged head)

Projects opt in by providing a test map. Projects without one keep the unmapped behaviour.
-->

# Test selection protocol

**Detect first, then follow the matching branch.**

```bash
test -f context/testing/test-map.mjs && echo MAPPED || echo UNMAPPED
```

## If MAPPED — run the selector, not the suite

The project has declared which tests can observe which changes. **Do not choose a scope by judgment,
and do not run the full suite "to be safe".**

```bash
node scripts/test-select.mjs --files <changed files> --json     # or --since <sha>, or --tier <t>
```

Run exactly the commands it prints, once.

### What runs when

| Situation | What runs | Who |
|---|---|---|
| After an edit | `test-select --files <changed>` | the agent editing |
| A verify sweep | the selection for that sweep's own fixes only | the verifier |
| End of a lane or module | `test-select --since <lane base>`, once | the lane |
| The selector escalates **inside a lane or verifier** | do not run the escalated tier: run `vitest related` (or the runner's equivalent) on the changed files plus the suites for the touched code, and report "escalated to `<tier>`, deferred" | the lane or verifier |
| Merge into the integration branch | the suites in files that had conflicts, plus the test typecheck | the orchestrator |
| Final gate of a batch | `--tier full`, once, on the final head | the orchestrator |
| A standalone `/implement-plan` (no orchestrator) | an escalated tier runs once at module end, never per sweep | the agent |

**Baseline plus delta.** Select `--since` the last green sha, not from scratch. A verifier does not
repeat the lane's selection unless it changed code; it runs the delta of its own fixes.

### Rules

1. **An empty plan is not a pass.** No commands printed is a map gap: report it, never record green.
   A path the runner can't resolve (a relative path, a `src/` path where packages resolve through
   `dist/`) also selects nothing and exits 0.
2. **Build before trusting a cross-package selection.** A stale build gives false failures and wrong
   selections.
3. **Check the map before a narrow run on an unfamiliar area** (`node scripts/test-map.mjs --check`).
4. **Only a `full` run may be reported as "all tests pass."** Report the others as what they were:
   `tests: --since a1b2c3 (54 files) ✅`.
5. **A new test file joins the map in the same commit**, including any file it reads without importing
   (a fixture, a manifest, a stylesheet).
6. **A setup failure is not a product defect** (missing seed, extension, database): fix the
   environment per `context/testing/TESTING.md` and re-run.

## Test hygiene

Each of these broke a merged run in a real batch:

- **Suites seed their own data and remove it.** A harness tenant or flag left behind fails other suites
  only after lanes merge.
- **Time-dependent tests take a fixed clock.** Otherwise they fail near midnight or month end.
- **One test per external network path uses a real local socket.** Fakes passed while the real runtime
  failed.
- **One test database per lane**, named with the lane prefix and a `_test` suffix, bootstrapped by the
  project's script. Never a shared database.

## Building the map

`/blueprint` creates the map when the project starts, not after the suite has grown: each module's §7A
names its test files by path, and `/implement-plan` registers new ones. A design guide (what the
selector and map checker must do, and the traps they must handle) and a skeleton map are in
`~/.claude/templates/testing/`.

## If UNMAPPED — run the project's own commands

```bash
npm test 2>/dev/null || npx vitest run
npx tsc --noEmit
npm run lint 2>/dev/null || npx eslint .
```

Run them once at the end of a module, not after every edit. Propose a map when the suite is large
enough that running it in full dominates the loop.
