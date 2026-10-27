# Test map — design guide

A test map lets every agent run **only the tests that can fail because of its change**, instead of the
whole suite after every edit. `~/.claude/commands/_shared-test-selection.md` uses it when
`context/testing/test-map.mjs` exists. Create it when the project starts (`/blueprint`), not after the
suite has grown.

## The three files a project adds

| File | Role |
|---|---|
| `context/testing/test-map.mjs` | The data: runners, groups, edges, escalations, tiers. Start from `test-map.example.mjs` here |
| `scripts/test-select.mjs` | Reads the changed files (`--files`, `--since <sha>`, or the merge-base), prints the commands to run (`--json` for agents), and executes them with `--run` |
| `scripts/test-map.mjs --check` | Fails when a test file exists that no group claims, or a group names a path that is gone. Runs in the commit gate and CI |

Document the bootstrap, the runner commands and the traps in `context/testing/TESTING.md`.

## What the map must declare

- **runners:** how to invoke each test config, and from where. If one config excludes part of the repo
  (a separate web config, say), "the whole suite" must invoke every runner.
- **groups:** every test file belongs to exactly one group (usually one per package or app), with the
  source globs it observes.
- **edges:** tests that read a file without importing it (fixtures, manifests, stylesheets, a directory
  walk). The import graph cannot see them, so the map must.
- **escalations:** changes that make narrow selection dishonest (a lockfile, a test config, a shared
  contract or stylesheet) and the tier they raise to. Inside a lane an escalation is recorded and
  deferred, not run.
- **tiers:** `quick` (related tests of the changed files), `standard` (whole affected groups plus their
  dependents), `full` (every runner).

## Traps the selector must handle

Each produced a false green in a real project:

- **Workspace packages that resolve through `dist/`:** a consumer's import graph contains the built file,
  not `src/`. Offer each changed `src/**.ts` to the runner as its `dist/**.js` twin too, and build first.
- **Relative paths:** some runners' `related` mode matches nothing on a relative path and exits 0. Resolve
  every path to absolute.
- **An empty selection:** never report it as a pass. Refuse to `--run` a plan that selected nothing.
- **Pass-with-no-tests settings** hide the two traps above. Turn them off for selected runs.
