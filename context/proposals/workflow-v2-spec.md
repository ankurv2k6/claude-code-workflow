# Workflow v2: build spec (binding for the v2 lanes)

Status: in build on branch `workflow-v2`. This repo is public: nothing here names a project, a host, a person or an
internal system. Project facts live in each project's profile, never in this repo.

## 0. Why v2

Measured on a multi-week, multi-agent programme:

- most of each cut's critical path was checking and waiting, not building;
- checks ran late, in series and several times;
- agents loaded far more context than their task needed;
- release-level checks ran at every stage;
- project-specific rules were hard-coded into briefs and copied between cuts.

v2 runs each check once, at the stage that can find its kind of defect. It moves the mechanical work to scripts, keeps
project facts in a per-project profile, and pins every batch to a workflow version.

## 1. Versioning and release

- `VERSION` at the repo root holds the workflow version (`2.0.0`). `CHANGELOG.md` lists the behaviour changes per
  version, in generic words.
- `scripts/workflow/release.sh <tag> [--apply]`:
  - creates or moves a detached worktree of this repo at `<tag>` under `~/.claude/workflow-release`;
  - points `~/.claude/commands` and `~/.claude/templates` at it;
  - without `--apply` it only prints what it would do. Rollback is the same command with the previous tag.
  - It is never run by a lane. The owner runs it at switch-over.
- **Where skills find the generic scripts:** `$WORKFLOW_HOME/scripts/workflow/<script>`. `WORKFLOW_HOME` defaults to
  `~/.claude/workflow-release`, the pinned checkout. For tests before a release, set it to a v2 worktree. Skills must
  say what to do when a script is absent (the v1 step).
- The task-list header gains `workflow_version: <VERSION>`.
  - On `--resume`, a task list whose `workflow_version` differs from the installed `VERSION` follows its own version's
    text, read with `git -C ~/claudeworkflow show v<version>:.claude/commands/<file>`.
  - Versions are never mixed inside one batch.

## 2. The project profile

- **Path:** `<project>/.claude/workflow-profile.json`, committed in the project.
  - JSON only, so that Node built-ins and `jq` can read it.
  - Any object may carry a `"notes"` string.
- **Schema:** `.claude/templates/workflow-profile.schema.json`, checked by `scripts/workflow/profile-check.mjs` with no
  dependencies.
- **Keys:**

```json
{
  "version": 1,
  "project": "my-app",
  "updated": "2026-11-25",
  "docs": { "invariants": "CLAUDE.md#project-invariants", "guardrails": "CLAUDE.md#hard-guardrails", "process": "context/development-process.md" },
  "shell_prefix": "unset AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN;",
  "commands": {
    "install": "pnpm install --frozen-lockfile",
    "build": "pnpm -r build",
    "test_task": "node scripts/test-select.mjs --files {files} --max-tier quick --run",
    "test_lane_end": "node scripts/test-select.mjs --since {base} --max-tier standard --run",
    "test_full": "pnpm test:full:sharded",
    "typecheck": "pnpm typecheck",
    "typecheck_clean": "pnpm typecheck:clean"
  },
  "gates": {
    "lint-staged": { "cmd": "…", "kind": "check", "smoke": true, "notes": "…" },
    "invariant-check": { "cmd": "…", "kind": "rehearsal", "heavy": "rehearsal", "smoke": false }
  },
  "tiers": {
    "per_commit": ["…"], "lane_end": ["…"], "merge": ["…"], "cut_end": ["…"], "track_merge": ["…"]
  },
  "invariant_suites": ["path/to/never-quarantined/suite"],
  "risk_routing": [ { "paths": ["**/auth/**"], "verifier": "security-engineer", "reason": "…" } ],
  "heavy_jobs": { "rehearsal": { "slots": 1, "lock_dir": "/tmp/my-app-slots/rehearsal" } },
  "test_db": { "host": "127.0.0.1", "port": 5432, "container": "…", "name_pattern": "app_{set}_{lane}_test",
               "create": "… {name} …", "bootstrap": "… {url} …", "allow_hosts": ["127.0.0.1"] },
  "ports": { "range": [4400, 4999], "registry": ".claude/ports.json" },
  "known_reds": "context/testing/known-reds.md",
  "logs_dir": "logs",
  "agents": { "max_concurrent": 6, "verifier_model": "opus", "overrides": {} },
  "limits": { "context_budget_tokens": 200000, "handback_lines": 30, "stall_minutes": 45 },
  "provenance": [ { "path": "tiers.cut_end", "source": "context/batch-report-x.md", "date": "2026-11-25", "change": "added invariant-check" } ]
}
```

- **Placeholders** in commands: `{files}`, `{base}`, `{name}`, `{url}`, `{port}`, `{lane}`, `{set}`.
- **Tiers name gates;** the gate registry maps each name to its command.
  - `kind` is one of `check`, `test`, `rehearsal` or `health`.
  - `heavy` names a `heavy_jobs` slot.
  - `smoke: true` marks a gate safe to run in the scaffold's smoke run.
- **Without a profile,** a project's mechanics stay exactly as in v1: test selection, gates and briefs as before. The
  universal process rules in §3 still apply, and are announced in `CHANGELOG.md`.

## 3. Universal process rules, by owning file

| # | File | Rule |
| --- | --- | --- |
| R1 | `plan.md` | The MVP paragraph must state the interaction model, entry states (at rest, after reload, empty) and the UI words, checked against the project's UI brief if one exists. Research starts after the MVP paragraph is agreed |
| R2 | `analyze-plan.md` | One review round per MVP or cut. CRITICAL and HIGH are fixed without asking. MEDIUM and LOW are listed for the owner in one line; legal, security and compliance findings are never auto-deferred. A fix agent applies the edits. Reviewers return at most 30 lines plus a path. A re-run reviews only new text. `--ask-tiers` restores the tier question |
| R3 | `blueprint.md` | One writer and one verifier, with a second verify only to check a CRITICAL fix. Central files and contracts first; module writers start after they are LOCKED. Size budget: module blueprint ≤ 25 KB, impl spec ≤ 30 KB, contracts ≤ 40 KB, unless justified in the file. Every gate command the blueprint names is dry-run through the profile's registry. A reach or permission walk and a caller list run when the profile names scripts for them. Impl specs anchor edits as `file:line` ranges. The orchestrator never writes blueprint files |
| R4 | `design-ui.md` | Design runs before the UI blueprint. The designer writes the UI module's §4 and the Design Sync table. States: the acceptance scenario's, plus entry, empty, loading, error and refusal. Accessibility stays a separate agent, run once |
| R5 | `implement-batch.md` | **Phase 0:** read the profile; run the scaffold; check the known reds; write the `workflow_version` header. **Lanes:** a lane launches when its inputs have merged and the contracts lane's verifier has signed off. Sessions split at a task boundary past the context budget. Heavy jobs take a slot. **Merges:** the profile's `tiers.merge` through the merge script; migrations renumbered at merge when the profile names a journal check; the watchdog runs. **Verifiers:** each gets a focus list from `risk_routing`. **Final:** `tiers.cut_end`, the invariant checks first; one combined final (code and behaviour); then the full run on the merged fixes; an integration fix only for reds not in the known-reds file. `tiers.track_merge` runs at merges between tracks. **Last step:** `/workflow-sync` |
| R6 | `implement-plan.md` (`--lane`) | Per task, `commands.test_task` in one run. Per commit, `tiers.per_commit` (or the project's hook). At lane end, `tiers.lane_end` once and `commands.test_lane_end` once. A progress note follows a template. Sessions end at the context budget at a task boundary. Long commands write to `logs_dir`. A lane never ends its turn while its own background job runs. The report goes in the final reply under fixed headings, never in `.lane/report.md` |
| R7 | `verify-implementation.md`, `_shared-triage.md` | Risk focus: the delta and its callers; a regression guard, so any fix to shared code runs its callers' tests; specialists from `risk_routing`; verifiers on `agents.verifier_model` (default `opus`); the lane's selection re-run once |
| R8 | `_shared-test-selection.md` | Commands from the profile. A tier cap where the selector supports one. One call per task. No broad runs in lanes. Heavy runs through the slot |
| R9 | `_shared-effort-budget.md` | Delete "lanes of 1,000+ tool calls are normal". Add the context budget, the enforced 30-line hand-back, and batched reads (independent reads in one turn, ranged reads). A model-by-role table with verifiers on Opus; doc-only roles may use Sonnet when the profile's `agents.overrides` allows it |
| R10 | `_shared-ui-parity.md` | One parity pass, on the real stack, in the UI verifier after the API merges. Fakes are for building, never for proof |
| R11 | `_shared-agent-timeout.md` | The watchdog: a background loop that exits on a stall, measured from commits, progress notes and log growth. A slot holder is not stalled. Its exit wakes the orchestrator |
| R12 | `templates/batch-briefs/*` | One programme `_common.md` plus a per-cut delta. CLAUDE.md is referenced by section, never copied. Commands come from the profile. No `.lane/report.md`. Reading by anchor |
| R13 | `templates/batch-progress.md` | `workflow_version`; an Owner corrections log, written when a correction happens; one Decision log; a lessons pointer |
| R14 | `workflow-sync.md` (new) | **Harvest** from the batch report, the task list (decisions, owner corrections, deferred findings), verifier findings, `build-report` output and script drift. **Classify** each lesson as skill, profile, user level or memory. **Diff** the profile with `profile-diff.mjs`: mechanical additions are applied by the orchestrator, and everything else becomes an owner item. Lessons go to the project's `context/workflow-lessons.md`. Generic proposals go to `context/proposals/` in this repo, with no project internals. It never edits a skill |
| R15 | `_shared-project-profile.md` (new) | The schema, how skills read it, the defaults, the classification table, apply-by-risk, and provenance |

## 4. Generic scripts (`scripts/workflow/`)

Node ≥ 18 built-ins only, or bash 3.2. Each script has `--help`, and node:test tests live in `scripts/workflow/test/`.

- **`profile-check.mjs`**
  - Validates a profile against the schema.
  - `--smoke` runs every `smoke: true` gate and `commands.*` entry with the `shell_prefix`, placeholders filled from
    flags, and reports each exit code.
- **`profile-diff.mjs <old> <new>`**
  - Classifies each change mechanically:
    - `addition`: a new gate in a tier, a new invariant suite, a new risk route;
    - `command-change`;
    - `removal`;
    - `test-db-change`;
    - `limit-change`;
    - `other`.
  - Prints JSON and a summary. Only `addition` may be auto-applied.
- **`slot.sh <job> <slots> [--lock-dir d] [--timeout s] -- cmd…`**
  - `mkdir`-based locks with a PID file per slot.
  - Recovers a stale lock whose PID is dead, and waits until the timeout.
- **`watchdog.mjs --task-list p --stall-minutes n`**
  - Every 5 minutes, checks each running lane's last commit time, its `.lane/progress.md`, its newest log file and the
    slot holders.
  - Exits 3 with a report when a lane is stalled, and 0 when no lanes are running.
- **`orch-event.mjs`**
  - Writes task-list events: agent rows, module status, decisions, owner corrections.
  - Times come from the clock. `--commit` commits the change.
- **`scaffold.mjs`**
  - From a lane map: creates worktrees and branches, allocates ports from the registry (seeded from existing briefs),
    and creates test DBs through the profile.
  - Runs the `health` gates and smoke-runs the brief commands.
  - `--dry-run` is the default.
- **`build-report.mjs`**
  - Reads the session transcripts under `~/.claude/projects/<slug>/`, including subagents.
  - Reports per agent: tokens, cost (price table in a flag file), active minutes, tool calls per turn, maximum context
    and Bash categories, grouped by role through description patterns.
  - Writes a Markdown table.
- **`release.sh`:** see §1.
- **Project registry:** `~/.claude/workflow-projects.json` lists the project roots that have profiles. It is local only,
  never in this repo. Promotion between projects is deferred until a second project has a profile.

## 5. Safety rules for every lane

- Work only in your own worktree. Never edit `~/claudeworkflow`'s main working tree, and never touch `~/.claude/commands`
  or `~/.claude/templates`.
- No project internals in this repo: no hostnames, ports of real systems, emails, product or customer names. Examples
  use `my-app`.
- No network calls. Scripts never delete without `--apply`, and print what they would do first.
- Never kill a process by name.

## 6. Lane ownership

| Lane | Files |
| --- | --- |
| A | `_shared-project-profile.md`, `workflow-sync.md`, `templates/workflow-profile.schema.json`, `templates/workflow-profile.example.json`, `templates/batch-progress.md`, `VERSION`, `CHANGELOG.md`, `scripts/check-skills.mjs`, `README.md` and `CLAUDE.md` (the command tables) |
| B | `plan.md`, `analyze-plan.md`, `blueprint.md`, `design-ui.md` |
| C | `implement-batch.md`, `implement-plan.md`, `verify-implementation.md`, the other `_shared-*.md`, `templates/batch-briefs/*` |
| D | `scripts/workflow/*` and its tests |

## 7. Acceptance (the build is done when all pass)

1. `node scripts/check-skills.mjs` passes on the merged `workflow-v2` tree. It also checks that every profile key a
   skill names exists in the schema.
2. `node --test scripts/workflow/test/` passes. The tests cover:
   - slot concurrency, with two callers on one slot;
   - stale-lock recovery;
   - `profile-diff` on each change class;
   - `profile-check` on a valid and an invalid profile;
   - the watchdog on a fixture task list;
   - the scaffold in dry-run mode;
   - `orch-event` on a fixture task list;
   - `build-report` on a fixture transcript.
3. **Dry run against an archived batch.** In a scratch worktree of the pilot project, a dry run of `/implement-batch`
   following the v2 files by path (not the installed ones) on an archived, completed blueprint set produces:
   - a lane map in which no lane waits on unmerged code;
   - briefs whose commands pass the smoke run;
   - gates taken from the profile by tier;
   - no `.lane/report.md` request.
4. `/workflow-sync`, run on an existing batch report, produces classified lessons and a profile diff. It applies nothing
   but mechanical additions.
