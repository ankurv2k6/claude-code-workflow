---
description: Shared protocol, not a standalone command. The per-project workflow profile — its keys, how skills read it, the defaults and the v1 fallback, the gate registry and tiers, where a lesson belongs, what may be applied without the owner, and provenance.
disable-model-invocation: true
---
<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: implement-batch, implement-plan (--lane), verify-implementation, blueprint, workflow-sync,
_shared-test-selection, _shared-effort-budget, _shared-triage
Generated: 2026-11-25 (workflow v2: project facts had been hard-coded into briefs and copied between cuts)
Last audit: 2026-11-25
-->

# Project profile

**Project facts live in the project, process rules live in the skills.** A skill never hard-codes a
project's command, gate, port, test DB or limit; it reads them from the profile.

- **Path:** `<project>/.claude/workflow-profile.json`, committed in the project. JSON only.
- **Schema:** `~/.claude/templates/workflow-profile.schema.json`. Example:
  `~/.claude/templates/workflow-profile.example.json`.
- **Scripts:** `$WH/scripts/workflow/<script>`, where `WH="${WORKFLOW_HOME:-$HOME/.claude/workflow-release}"`
  (the pinned release; set `WORKFLOW_HOME` to a worktree to test unreleased scripts). Always expand the
  default: a bare `$WORKFLOW_HOME` that is unset points at `/scripts/…`, and the step silently falls back to
  "script absent". Each skill says what to do by hand when a script is absent.
- **Check:** `node "$WH/scripts/workflow/profile-check.mjs" --profile .claude/workflow-profile.json` (the
  path goes in `--profile`; a bare positional path is ignored).

## Keys

Any object may carry a `"notes"` string. Only `version`, `project` and `updated` are required.

| Key | Holds | Default when absent |
|---|---|---|
| `version` · `project` · `updated` | schema version (1), project name, date of the last change | required |
| `docs.*` | `path#anchor` of the project's invariants, guardrails, process and other rule docs | CLAUDE.md sections, found by heading |
| `shell_prefix` | prepended to every command and gate a skill runs | none |
| `commands.*` | `install`, `build`, `test_task`, `test_lane_end`, `test_full`, `typecheck`, `typecheck_clean` | the v1 step (below) |
| `gates` | the gate registry: name → `cmd`, `kind`, optional `heavy`, `smoke` | the v1 gates |
| `tiers.*` | gate names per stage: `per_commit`, `lane_end`, `merge`, `cut_end`, `track_merge` | the v1 gates for that stage |
| `invariant_suites` | test paths never quarantined, run first at cut end | none named |
| `risk_routing` | `paths` globs → `verifier` agent, with a `reason` | the verifier's own judgement |
| `heavy_jobs` | slot name → `slots`, `lock_dir` | heavy runs one at a time, by the orchestrator |
| `test_db.*` | `host`, `port`, `container`, `name_pattern`, `create`, `bootstrap`, `allow_hosts` | CLAUDE.md and the briefs, as in v1 |
| `ports.*` | `range` [low, high] and the `registry` file | ports from the briefs, as in v1 |
| `known_reds` | file of reds that predate the cut | none: every red is new |
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
| `{url}` | the test DB URL built from `test_db.host`, `port` and `{name}` |
| `{port}` | a port allocated from `ports.range` and recorded in `ports.registry` |
| `{lane}` · `{set}` | the lane id and the set name, lower case |

A command with an unfilled placeholder is not run. A test DB host outside `test_db.allow_hosts` is
refused.

## Gates and tiers

A **gate** is a named command in the registry. A **tier** is the list of gates run at one stage, in
order; the first red stops the tier and is recorded.

| `kind` | Is |
|---|---|
| `check` | static: lint, types, a journal or format check |
| `test` | runs tests |
| `rehearsal` | a production-like run: migrations on a copy, an invariant sweep |
| `health` | the environment is up: DB, container, ports |

| Tier | Runs | By |
|---|---|---|
| `per_commit` | at each commit (or the project's hook runs it) | the lane |
| `lane_end` | once, when the lane's last task is done | the lane |
| `merge` | on each merge into the integration branch | the orchestrator, through the merge script |
| `cut_end` | once per cut, invariant gates first | the orchestrator |
| `track_merge` | at a merge between parallel tracks | the orchestrator |

- **Every tier entry names a gate in the registry, and every `heavy` names a `heavy_jobs` slot.** A
  skill that meets an unknown name stops and raises it.
- **A gate with `heavy` takes a slot:** `"$WH/scripts/workflow/slot.sh" <slot> <heavy_jobs.<slot>.slots>
  --lock-dir <heavy_jobs.<slot>.lock_dir> -- <cmd>`. Exit 75 means the wait timed out (default 7200 s): the
  gate did not run, which is neither green nor red; re-queue it. Without the script, the orchestrator runs
  heavy gates one at a time.
- **`smoke: true`** marks a gate safe for the scaffold's smoke run (fast, read-only). Only those run there.
- **Conventional gate names** that skills look for when present (absent means the v1 step):
  `reach-walk` (walks the permission or reach tables; `/blueprint` verify and the contracts verifier run it),
  `caller-list` (lists the callers of changed response shapes; `/blueprint` and merges run it).
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
| `command-change` | a changed `commands.*` or gate `cmd`; **a new gate in the registry** (a new command to run), and a tier entry naming it | Owner item |
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
