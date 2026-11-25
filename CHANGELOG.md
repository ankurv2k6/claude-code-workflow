# Changelog

Behaviour changes per workflow version, in generic words. `VERSION` holds the current one. A batch is
pinned to the version in its task list's `workflow_version` header, and versions never mix inside one batch.

## 2.0.0 (2026-11-25)

Each check now runs once, at the stage that can find its kind of defect. Mechanical work moves to
scripts in `scripts/workflow/`, found at `$WORKFLOW_HOME/scripts/workflow/` (`WORKFLOW_HOME` defaults
to `~/.claude/workflow-release`). Project facts move to a per-project profile.

### Behaviour changes

| # | Where | Change |
|---|---|---|
| R1 | `/plan` | The MVP paragraph states the interaction model, the entry states (at rest, after reload, empty) and the UI words, checked against the project's UI brief. Research starts after it is agreed |
| R2 | `/analyze-plan` | One review round per MVP or cut. CRITICAL and HIGH are fixed without asking; MEDIUM and LOW are listed for the owner in one line; legal, security and compliance findings are never auto-deferred. A fix agent edits; reviewers return at most 30 lines. A re-run reviews only new text. `--ask-tiers` restores the tier question |
| R3 | `/blueprint` | One writer and one verifier (a second verify only checks a CRITICAL fix). Central files and contracts are LOCKED before module writers start. Size budgets per file. Every gate the blueprint names is dry-run through the profile. Impl specs anchor edits as `file:line` ranges. The orchestrator never writes blueprint files |
| R4 | `/design-ui` | Design runs before the UI blueprint and writes its UI section and the Design Sync table, covering the acceptance scenario's states plus entry, empty, loading, error and refusal. Accessibility is a separate agent, run once |
| R5 | `/implement-batch` | Phase 0 reads the profile, runs the scaffold, checks the known reds and writes `workflow_version`. A lane launches only when its inputs have merged and the contracts are signed off. Sessions split at a task boundary past the context budget. Heavy jobs take a slot. Merges run the profile's merge tier; a watchdog detects stalls. Verifiers get a focus list from risk routing. The final runs the cut-end tier (invariants first), one combined final, one full run. Last step: `/workflow-sync` |
| R6 | `/implement-plan --lane` | One targeted test run per task, the per-commit tier per commit, the lane-end tier and selection once at lane end. Progress notes follow a template. Long commands write to the logs directory. A lane never ends its turn while its own background job runs. The lane report goes in the final reply under fixed headings, not in a report file |
| R7 | `/verify-implementation`, triage | Focus on the delta and its callers; a fix to shared code runs its callers' tests; specialists from risk routing; verifiers on the profile's verifier model (default Opus); the lane's selection re-run once |
| R8 | test selection | Commands from the profile, a tier cap where the selector supports one, one call per task, no broad runs in lanes, heavy runs through a slot |
| R9 | effort budget | Lanes are sized by a context budget, not by hours or tool calls. The 30-line hand-back is enforced. Independent reads are batched. A model-by-role table puts verifiers on Opus |
| R10 | UI parity | One parity pass on the real stack, by the UI verifier after the API merges. Fakes are for building, never for proof |
| R11 | agent timeout | A watchdog loop exits on a stall measured from commits, progress notes and log growth, and wakes the orchestrator. A slot holder is not stalled |
| R12 | lane briefs | One programme `_common.md` plus a per-cut delta. CLAUDE.md is referenced by section, never copied. Commands come from the profile |
| R13 | task list | `workflow_version` header, an Owner corrections log written as corrections happen, one Decision log, a lessons pointer |
| R14 | `/workflow-sync` (new) | Harvests a batch's lessons from artifacts on disk, classifies them, diffs the profile, applies only mechanical additions, writes the project's lessons file and generic proposals. Never edits a skill |
| R15 | project profile (new) | `<project>/.claude/workflow-profile.json`: commands, gate registry, tiers, test DBs, ports, limits, risk routing, provenance. Without one, a project's mechanics stay as in 1.x; the universal rules above still apply |

`scripts/check-skills.mjs` now also fails on a profile key the schema does not define, and on the
retired lane-sizing and lane-report phrases.

### Switch-over (owner)

1. Tag the last 1.x commit `v1.0.0` and the merged v2 commit `v2.0.0`.
2. `scripts/workflow/release.sh v2.0.0` prints the plan; read it.
3. `scripts/workflow/release.sh v2.0.0 --apply` creates the pinned checkout at
   `~/.claude/workflow-release` and points `~/.claude/commands` and `~/.claude/templates` at it.
4. Optional, per project: copy `.claude/templates/workflow-profile.example.json` to
   `<project>/.claude/workflow-profile.json`, edit it, and run `profile-check.mjs` on it.
5. A batch already in flight has no `workflow_version` and is treated as 1.0.0: on `--resume` it
   follows that version's text (`git -C ~/claudeworkflow show v1.0.0:.claude/commands/<file>`).

### Rollback

`scripts/workflow/release.sh v1.0.0` to preview, then `--apply`. Profiles may stay in projects; 1.x
ignores them. Finish a batch started on 2.0.0 before rolling back: 1.x commands do not read
`workflow_version`.
