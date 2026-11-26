---
description: Shared protocol, not a standalone command. The per-project workflow profile — its keys, how skills read it, the defaults and the v1 fallback, the gate registry and tiers, where a lesson belongs, what may be applied without the owner, and provenance.
disable-model-invocation: true
---
<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: implement-batch, implement-plan (--lane), verify-implementation, blueprint, workflow-sync,
_shared-test-selection, _shared-effort-budget, _shared-triage
Generated: 2026-11-25 (workflow v2: project facts had been hard-coded into briefs and copied between cuts)
Last audit: 2026-11-26 (2.1: tests.* heavy lock and merge delta, release.* hotfix path)
-->

# Project profile

**Project facts live in the project, process rules live in the skills.** A skill never hard-codes a
project's command, gate, port, test DB or limit; it reads them from the profile.

- **Path:** `<project>/.claude/workflow-profile.json`, committed in the project. JSON only.
- **Schema:** `~/.claude/templates/workflow-profile.schema.json`. Example:
  `~/.claude/templates/workflow-profile.example.json`.
- **Scripts:** `$WH/scripts/workflow/<script>`. **`$WH`** is, in order: `$WORKFLOW_HOME` when set (a
  worktree, to test unreleased scripts); else `~/.claude/workflow-release` (the pinned release) when it
  exists; else the repo root that `~/.claude/commands` points into (its realpath is
  `<root>/.claude/commands`), so a v1 install before any release still finds its own scripts. In a shell:
  ```bash
  WH="${WORKFLOW_HOME:-}"; [ -n "$WH" ] || { [ -d "$HOME/.claude/workflow-release" ] && WH="$HOME/.claude/workflow-release"; } || WH="$(cd -P "$HOME/.claude/commands/../.." 2>/dev/null && pwd -P)"
  ```
  The scripts resolve it the same way (`scripts/workflow/lib/home.mjs`). **`workflow_version`** is
  `$WH/VERSION` (absent: `1.0.0`). Never use a bare `$WORKFLOW_HOME`: unset, it points at `/scripts/…` and
  the step silently falls back to "script absent". Each skill says what to do by hand when a script is
  absent.
- **Check:** `node "$WH/scripts/workflow/profile-check.mjs" --profile .claude/workflow-profile.json` (the
  path goes in `--profile`; a bare positional path is ignored).

## Keys

Any object may carry a `"notes"` string, the `gates` and `heavy_jobs` maps included (a `notes` entry there
is prose, never a gate or a job). Only `version`, `project` and `updated` are required.

| Key | Holds | Default when absent |
|---|---|---|
| `version` · `project` · `updated` | schema version (1), project name, date of the last change | required |
| `docs.*` | `path#anchor` of the project's invariants, guardrails, process and other rule docs; `docs.release_branch`, the release branch an integration base must contain | CLAUDE.md sections, found by heading; no release-branch check |
| `shell_prefix` | prepended to every command and gate a skill runs | none |
| `commands.*` | `install`, `build`, `test_task`, `test_lane_end`, `test_full`, `typecheck`, `typecheck_clean`; `cleanup_list` (read-only: what a batch leaves behind, run at close) | the v1 step (below) |
| `gates` | the gate registry: name → `kind`, `cmd` (optional only for `agent`), `verifier` and `asks` (`agent` only), optional `heavy`, `smoke` | the v1 gates |
| `tiers.*` | gate names per stage: `per_commit`, `lane_end`, `merge`, `cut_end`, `track_merge` | the v1 gates for that stage |
| `invariant_suites` | test paths never quarantined, run first at cut end | none named |
| `risk_routing` | `paths` globs → `verifier` agent, with a `reason` | the verifier's own judgement |
| `heavy_jobs` | slot name → `slots`, `lock_dir`, `self_locking` | heavy runs one at a time, by the orchestrator; `lock_dir` `${TMPDIR:-/tmp}/workflow-slots/<job>` (per user and session, so `profile-check` warns); `self_locking` false |
| `merge.*` | `renumber` (puts colliding migrations after the integration head's; `{base}`), `check` (verifies the journal) | renumber and check by hand, as the merge step says |
| `test_db.*` | `host`, `port`, `container`, `name_pattern`, `create`, `bootstrap`, `url`, `allow_hosts` | CLAUDE.md and the briefs, as in v1; `url`: `postgresql://{host}:{port}/{name}` |
| `ports.*` | `range` [low, high], the `registry` file, `names` (a lane's port names), `step`, `offsets` (name → offset) | ports from the briefs, as in v1; `names` `["api"]`, `step` 1, no offsets |
| `known_reds` | file of reds that predate the cut; every run subtracts it (`_shared-test-selection.md`) | none: every red is new |
| `tests.*` | `heavy_lock` (wraps a heavy job in the one-per-machine lock; `{owner}`, `{cmd}`), `heavy_lock_token` (the env var a held lock exports, so a nested call joins the hold), `merge_delta` (the test run at a merge; `{ours}`, `{theirs}`) | no machine lock: heavy jobs one at a time by hand, peers told first; a merge runs `tiers.merge` only |
| `release.*` | `hotfix_start` (`{hotfix}`), `hotfix_finish` (`{hotfix}`, `{release_branch}`; the back-merge follows the deploy), `package` (`{bundle}`), `deploy` (`{bundle}`, `{description}`); never smoke-run | the hotfix path by hand with git; package and deploy as the project's deploy doc says |
| `logs_dir` | where long commands write their output | `logs` |
| `agents.*` | `max_concurrent`, `verifier_model`, `overrides` (role → model) | 5 · `opus` · none |
| `limits.*` | `context_budget_tokens`, `handback_lines`, `stall_minutes` | 200000 · 30 · 45 |
| `provenance` | one row per change (below) | — |

## How a skill reads it

1. **Detect once**, at the start of the run (Phase 0 of a batch):
   ```bash
   test -f .claude/workflow-profile.json && echo PROFILE || echo NO_PROFILE
   ```
2. **Check it.** Run `profile-check.mjs`; if it is absent, parse it (`node -e` or `jq .`) and compare the
   keys with the schema by eye. **An invalid profile stops the run** with the error as an Owner item.
   Never fall back silently from a broken profile.
3. **Read keys with `jq` or Node built-ins**, e.g. `jq -r '.commands.test_task // empty'`. An empty
   value means the key is absent: use its default.
4. **Resolve before handing on.** The orchestrator writes each resolved command into the brief, with
   the key it came from. A lane runs its brief's commands; it does not re-read the profile.
5. **Run with the prefix:** `<shell_prefix> <command>`, placeholders filled.

## Without a profile (the v1 fallback)

With no profile, a project's mechanics stay exactly as in v1: test selection from
`_shared-test-selection.md` (test map or the unmapped branch), commit gates from CLAUDE.md or the
project's hook (`_shared-commit-protocol.md`), and test DBs, ports and merge checks as the briefs and
CLAUDE.md state them. The defaults in the Keys table apply. The universal process rules (one check per
stage, the 30-line hand-back, the context budget, the watchdog) apply with or without a profile.

## Placeholders

| Placeholder | Filled with |
|---|---|
| `{files}` | the task's changed paths, space-separated, each shell-quoted |
| `{base}` | the lane's base sha |
| `{name}` | the test DB name, from `test_db.name_pattern` |
| `{url}` | the test DB URL: the `test_db.url` template with `{host}`, `{port}` and `{name}` filled |
| `{port}` | the lane's first named port, allocated from `ports.range` and recorded in `ports.registry` |
| `{lane}` · `{set}` | the lane id and the set name, lower case |
| `{owner}` · `{cmd}` | `tests.heavy_lock`: a label peers see (`<set>-<lane>-full`, `hotfix-<name>-release`) and the heavy command |
| `{ours}` · `{theirs}` | `tests.merge_delta`: the target head before the merge and the head merged in |
| `{hotfix}` · `{release_branch}` · `{bundle}` · `{description}` | `release.*`: the hotfix name, `docs.release_branch`, the bundle path, the deploy description |

Every value is passed as ONE shell-quoted word except `{files}` (one word per path): `{cmd}` and
`{description}` included, so a script given `{cmd}` runs it with `bash -c`. `profile-check` validates the
`tests.*` and `release.*` placeholders per key.

A command with an unfilled placeholder is not run. A test DB host outside `test_db.allow_hosts` is
refused.

**The test DB URL.** `test_db.url` is a template with `{host}`, `{port}` and `{name}` (default
`postgresql://{host}:{port}/{name}`); it must name `{host}` and `{name}`, so the host is always
`test_db.host` and `allow_hosts` still guards it. Use it when the test server needs a named user:
`postgresql://app:app@{host}:{port}/{name}`. **Credentials may be written in it only for a local test
database** (a throwaway container or a dedicated test host), never for a shared, staging or production one,
because the profile is committed. The rendered URL is shell-quoted as one word, so a `$VAR` in it is not
expanded.

**Ports.** The registry (`ports.registry`) holds `allocations` (port → set, lane, name), which the scaffold
appends to, plus two lists it only reads: `taken` (port numbers, or records holding them, for ports another
batch or tool uses) and `fixed` (name → port, for services that never move). None of them is handed out.
Without `step` or `offsets`, each of a lane's port names takes the next free port of the range. With either, a
lane takes a free base port (range start + k × `step`) and each name sits at base + `offsets.<name>`; a name
without an offset takes the next free offset of 0, 1, 2…. A lane-map entry's `ports` lists its names;
absent, `ports.names`; `[]`, none.

**Smoke runs.** A smoke run assumes an installed, built tree: the scaffold runs `commands.install`, then
`commands.build`, before the gates in a worktree it creates, and `profile-check.mjs --smoke` does the same with
`--install-first`. A staged-file gate (lint-staged, a pre-commit hook over the index) passes vacuously on an
empty index: a green smoke proves the hook runs, not that its tools work. The first real commit of a lane is
the check that they do.

## Gates and tiers

A **gate** is a named command in the registry. A **tier** is the list of gates run at one stage, in
order; the first red stops the tier and is recorded.

| `kind` | Is |
|---|---|
| `check` | static: lint, types, a journal or format check |
| `test` | runs tests |
| `rehearsal` | a production-like run: migrations on a copy, an invariant sweep |
| `health` | the environment is up: DB, container, ports |
| `agent` | a named agent judges it: `verifier` (the agent type, required) and `asks` (a one-line task) |

| Tier | Runs | By |
|---|---|---|
| `per_commit` | at each commit (or the project's hook runs it) | the lane |
| `lane_end` | once, when the lane's last task is done | the lane |
| `merge` | on each merge into the integration branch | the orchestrator, through the merge script |
| `cut_end` | once per cut, invariant gates first | the orchestrator |
| `track_merge` | at a merge between parallel tracks | the orchestrator |

- **Every tier entry names a gate in the registry, and every `heavy` names a `heavy_jobs` slot.** A
  skill that meets an unknown name stops and raises it.
- **Run a tier with the tier runner:** `node "$WH/scripts/workflow/run-tier.mjs" <tier> [--parallel]
  [placeholder flags]` runs its gates in order with the prefix (`--parallel`: independent `check` gates at
  once), wraps heavy gates in their slot, and lists each agent gate for you to launch. Script absent: run
  each gate yourself as this section says.
- **An agent gate (`kind: agent`) is launched, never run as a shell check.** The skill launches its
  `verifier` agent with `asks` as the task; when the gate has a `cmd`, that is a read-only helper (a list
  of changed files, say) whose output goes into the agent's prompt. **The gate passes only when the agent
  returns PASS**; record the verdict with the agent's id. Scripts never decide it, and `profile-check
  --smoke` skips it. It takes no slot.
- **A gate with `heavy` takes a slot:** `"$WH/scripts/workflow/slot.sh" <slot> <heavy_jobs.<slot>.slots>
  --lock-dir <heavy_jobs.<slot>.lock_dir> -- <cmd>`, **unless `heavy_jobs.<slot>.self_locking` is true**:
  that job takes its own lock, so it runs as is and is never wrapped (the watchdog still counts its
  holders in `lock_dir`). Exit 75 means the wait timed out (default 7200 s): the gate did not run, which is
  neither green nor red; re-queue it. Without the script, the orchestrator runs heavy gates one at a time.
- **The full run is never a tier gate.** `commands.test_full` runs once, after the final's fixes have
  merged; `profile-check` refuses a tier that lists a gate whose `cmd` equals it.
- **`smoke: true`** marks a gate safe for the scaffold's smoke run (fast, read-only). Only those run there.
- **Conventional gate names** that skills look for when present (absent means the v1 step):
  `reach-walk` (walks the permission or reach tables; `/blueprint` verify and the contracts verifier run it),
  `caller-list` (lists the callers of changed response shapes; `/blueprint` and merges run it). Either may
  be an agent gate. A profile with `risk_routing` but no `reach-walk` gets a `profile-check` WARNING (not
  an error): its reach tables are only read, never walked.
- **Merges:** `merge.renumber` and `merge.check`, when set, run on every lane merge, through
  `merge-lane.mjs` (`/implement-batch` Phase 1 step 5).
- **A blueprint or brief names gates, never raw commands.** `/blueprint` dry-runs each name it uses.

## Where a lesson belongs

Every lesson (a correction, a repeated finding, a gate that should have caught something) has one home.

| Class | Holds | One-line test | Written by |
|---|---|---|---|
| skill | a process rule for any project | Would it hold for a different project on a different stack? | a generic proposal in the workflow repo's `context/proposals/`; the owner edits the skill |
| project profile | a mechanical fact a script can use: command, gate, tier entry, path, route, limit | Could a script run or read it? | `profile-diff.mjs`, then apply by risk (below) |
| user level | the owner's preference in every project | Would the owner want it everywhere? | an Owner item for `~/.claude/CLAUDE.md` |
| project CLAUDE.md | a rule about the product or its data: invariant, guardrail, data trap | Must a person or agent read it to work safely here? | an Owner item; CLAUDE.md is never auto-edited |
| memory | a dated state or fact that will go stale | Will it be wrong in a month? | an Owner item for the memory file |

**Ambiguous goes to the profile first**, with a `notes` line. It is promoted to a skill proposal when a
second project's profile needs the same entry. (`~/.claude/workflow-projects.json`, local only, lists the
projects with profiles; promotion across projects waits until there are two.)

## Apply by risk

`profile-diff.mjs <old> <new>` classifies each change.

| Class | Example | Action |
|---|---|---|
| `addition` | an existing gate added to a tier, a new invariant suite, a new risk route | **may be applied**, by the batch's orchestrator, as its last step |
| `command-change` | a changed `commands.*` or gate `cmd`; **a new gate in the registry** (a new command to run, or for an agent gate a new verdict), and a tier entry naming it; a changed `verifier` or `asks`; a `kind` moved to or from `agent`; any `merge.*` change | Owner item |
| `removal` | a gate, suite or route taken out | Owner item |
| `test-db-change` | a changed `test_db.*` value | Owner item |
| `limit-change` | a changed `limits.*` value | Owner item |
| `other` | anything else | Owner item |

- **Nothing else is ever auto-applied**, and a standalone run (not the orchestrator's last step) applies
  nothing: it writes the diff and lists every change as an Owner item.
- **Deciding:** `profile-diff.mjs` exits 0 whenever it has compared; never read its exit code as the
  answer. Read its JSON: `only_additions: true` (and `owner_items: 0`) is the only state that allows an
  apply.
- **Applying:** write the profile with only the additions; re-run `profile-diff.mjs` and confirm
  `only_additions` is `true`; then **smoke-run each gate newly added to a tier** with the `shell_prefix` (so the shell is
  stripped of credentials as the project requires): `profile-check.mjs --profile <file> --smoke --only
  gates.<name>` for a gate marked `smoke: true`, and for any other gate the static checks only (placeholders
  fillable, every script and path it names exists), never a run. An added gate that fails is taken out
  again and becomes an Owner item. Then add one provenance row per change and set `updated`; run
  `profile-check.mjs`; commit `chore(workflow): profile additions from <set>`.
- **Without `profile-diff.mjs`:** apply nothing. List each change as an Owner item with the old and new
  value.

## Provenance

Every change to the profile, by a skill or by hand, appends one row to `provenance` and sets `updated`.

| Field | Holds |
|---|---|
| `path` | the dotted key, e.g. `tiers.cut_end` |
| `source` | the on-disk artifact that justified it (batch report, task list, verifier findings) |
| `date` | from `date +%F`, never recalled |
| `change` | one line: what changed |

Rows are never edited or removed. A change without a source artifact is not made.
