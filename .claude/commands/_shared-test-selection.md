<!--
Shared test-selection protocol. Referenced by implement-plan, implement-batch,
verify-implementation and e2e-validate. Not a standalone command.

Projects opt in by providing a test map. Projects without one keep the old
behaviour unchanged, so this file is safe to reference everywhere.
-->

# Test selection protocol

**Detect first, then follow the matching branch. Do not skip the detection step.**

```bash
test -f context/testing/test-map.mjs && echo MAPPED || echo UNMAPPED
```

## If MAPPED — run the selector, not the suite

The project has declared which tests can observe which changes. **Do not choose a test scope by
judgment, and do not run the full suite "to be safe".** That decision is already made and recorded;
re-deciding it per task is what makes verification slow and inconsistent between runs.

```bash
node scripts/test-select.mjs --tier <quick|standard|full> --json
```

Run exactly the commands it prints. Tier by situation:

| Situation | Tier |
| --- | --- |
| After an edit, mid-task | `quick` |
| **Every verify-loop iteration** | `quick` |
| End of a module/task, before reporting status | `standard` |
| Before merging to an integration branch, or before a deploy | `full` |
| Final gate of a multi-module batch | `full` |

The selector escalates its own tier when a change makes narrow selection dishonest (a lockfile,
a harness config, a shared-contract file). **Never override an escalation downward.**

### Rules

1. **An empty plan is not a pass.** If the selector prints no commands, that is a map gap, not a
   clean run. Report it and widen to `--tier standard`; never record a green status off it.
2. **Build before trusting a cross-package selection.** Workspace packages resolve through
   `dist/`, so a stale build makes the selection wrong. Run the project's build first.
3. **Check the map before a narrow run on an unfamiliar area**, with
   `node scripts/test-map.mjs --check`. If it fails, fix the map before trusting any narrowed run —
   an unclaimed test file is invisible to every selection.
4. **Only a `full` run may be reported as "all tests pass."** A `quick` or `standard` run is
   reported as what it was: `tests: quick (N files) ✅`. Do not round up.
5. **When you add a test that reads a file it does not import** (a fixture, a manifest, a
   stylesheet, a directory walk), add the edge to the map in the same change. Nothing detects that
   omission automatically.
6. **If a selected test fails for a setup reason** (a missing seed, an absent extension, no
   database), fix the environment — see the project's `context/testing/TESTING.md` bootstrap
   section — and re-run. Do not record it as a product defect, and do not skip it.

## If UNMAPPED — current behaviour, unchanged

```bash
npm test 2>/dev/null || npx vitest run
npx tsc --noEmit
npm run lint 2>/dev/null || npx eslint .
```

Consider proposing a map if the suite is large enough that running it in full after every edit is
the dominant cost of the loop.
