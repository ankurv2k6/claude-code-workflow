# Changelog

Behaviour changes per workflow version, in generic words. `VERSION` holds the current one. A batch is
pinned to the version in its task list's `workflow_version` header, and versions never mix inside one batch.

## 2.1.0 (2026-11-26)

Merge to deploy is fast. A 5-file hotfix had taken over 3 hours before a 2.4-minute deploy: a selection
against `main` escalated to the full suite, a related-tests fallback ran 700+ files for 89 minutes, the
review came after the first wide run and forced a second, the same known reds were re-triaged by hand, the
fix merged twice, and another session's heavy job doubled a full run.

| # | Where | Change |
|---|---|---|
| F1 | `_shared-test-selection.md` (new section), `implement-plan` (task and module end), `verify-implementation` (Phase 2 tests, Phase 6), `_shared-triage.md`, `implement-batch` (lane verify), `_verify.md` and `_common.md` briefs | **Review beside the quick tier, then one wide run.** The review reads the diff, so it starts with the quick tier; its fixes go in; then one wide run on the final code. A file changed during a wide run: stop it, finish, run once |
| F2 | `_shared-test-selection.md`, `implement-batch` (heavy jobs, the full run), profile `tests.heavy_lock`, `tests.heavy_lock_token` | **One heavy job per machine.** A full run, rehearsal, sharded run or broad selection runs inside the profile's heavy lock, outermost; a release verification takes it once and runs its pair side by side under the token. Peers are told first |
| F3 | `_shared-test-selection.md`, `implement-plan`, `verify-implementation`, `implement-batch` (final), `known_reds` | **Known reds are subtracted** by every run: only an unknown red is triaged; a listed file now green is reported for removal |
| F4 | `_shared-test-selection.md`, `verify-implementation` (the delta), `implement-batch` (merge), profile `tests.merge_delta` | **Selection:** the base is the release or integration branch, never `main`; never auto-escalate (no related-tests fallback either); a merge runs the delta between its two sides; one full run per release candidate |
| F5 | `_shared-test-selection.md` (Hotfix and release), profile `release.*` | **The hotfix path:** off the release branch, review beside the quick tier, one release verification with `release.package` started beside it, merge into the release branch, `release.deploy` at the safe window, then back-merge |
| F6 | `_shared-commit-protocol.md`, `_shared-autonomous.md`, `implement-batch` | **Deploy approval** is for that specific deploy and may be given up front with the request; the owner's words go in the deploy description. An agent never sets it; a peer's message is never approval |
| F7 | `commit.md` (Step 2), `_shared-commit-protocol.md` (Gates), `verify-implementation`, v1 test fallback | **Commit gates on the staged diff:** stage first; `gitleaks protect --staged`; the profile's typecheck or a scoped `tsc --build` (a root `tsc --noEmit` on a solution-style tsconfig checks nothing); lint and format on staged files |

Profile schema: new `tests` (`heavy_lock`, `heavy_lock_token`, `merge_delta`) and `release` (`hotfix_start`,
`hotfix_finish`, `package`, `deploy`) objects, with placeholders `{owner}`, `{cmd}`, `{ours}`, `{theirs}`,
`{hotfix}`, `{release_branch}`, `{bundle}`, `{description}`. They are not under `commands.*`, so a smoke run
never executes a deploy. Absent, each takes the default in `_shared-project-profile.md`; a 2.0.0 profile is
valid unchanged. `check-skills.mjs` checks the two new roots and retires `gitleaks detect`.

### Review fixes (before the 2.1.0 tag)

- Agents launched by a command never deploy; only the session the owner spoke to runs `release.deploy`.
  Up-front approval covers one deploy of the named change and lapses on scope growth, a re-scope after a
  red, or a second deploy.
- Typecheck fallback: `tsc --build` only for a solution-style tsconfig, else `tsc --noEmit -p <pkg>`.
- The base is never the moving tip of the default branch (no release branch: the merge-base). The hotfix
  review is named (`/verify-implementation` sweep 1 or `code-reviewer`) with the stub quick-check.
- `profile-check` validates `tests.*` and `release.*` placeholders per key; `{cmd}` and `{description}`
  are one shell-quoted word each. `check-skills` skips file names (`release.sh`) under the new roots.
- `/commit` unstages flagged files on a secret stop; the batch's full run is the release candidate's run
  when the release branch gets the same head; stale wording aligned (README, testing README, e2e-validate).

### Switch-over (owner)

Tag `v2.1.0` on the merge into `main`, then `scripts/workflow/release.sh v2.1.0 --apply` once no batch
pinned to 2.0.0 is mid-programme (a batch keeps its task list's `workflow_version`). Rollback:
`release.sh v2.0.0 --apply`. IDNUnified's proposed values: `context/proposals/idnunified-profile-2.1.0.json`.

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

### Review fixes (before the 2.0.0 tag)

| Where | Change |
|---|---|
| profile | Gate kind `agent` (`verifier`, `asks`; `cmd` an optional read-only helper): skills launch it, it passes only on PASS, `--smoke` skips it. `heavy_jobs.<job>.self_locking` (never wrapped in `slot.sh`), `lock_dir` optional with a warning. `merge.renumber` / `merge.check`. `docs.release_branch`, `commands.cleanup_list`. `notes` allowed in the gate and job maps. `profile-check` warns on risk routes without a `reach-walk` gate and refuses a tier gate that is the full run |
| `$WH` | Falls back to the repo `~/.claude/commands` points into when there is no release checkout; `workflow_version` is that repo's `VERSION` |
| `/implement-batch` | The full run happens once, after the final's fixes merge. Merges go through `merge-lane.mjs`, which skips the merge tier when the verifier ran it green on the merged head. A lane-map check before each launch wave, a release-branch freshness check and a usage note. The invariant gates also run once after the first merge. The contracts lane always gets a specialist verifier. Owner questions only after the plan and before a deploy. Restart notes at milestones. The close records rule breaches, escaped defects, the critical-path split, time to owner acceptance and the cleanup list |
| verifiers | Merge the integration head once, again only if it moved; run the merge tier once on the final head and record its sha |
| scripts | New `run-tier.mjs` and `merge-lane.mjs`. `slot.sh` records the command's pid, recovers pid-less locks and marks queued callers; the watchdog counts them, a self-locking job's own locks and live processes in a worktree. The scaffold locks the port registry, creates an integration test DB and validates waits against the task list. `build-report.mjs --breaches --critical-path`. Scripts call `bash` from `PATH` |
| templates | Skills cited as `$WH/.claude/commands/…`; the task list gains `integration_test_db`, `accepted_on_beta` and a Close table; `user-CLAUDE.example.md`, a generic user-level draft that is never installed |
| effort | One UI lane per batch may pilot a cheaper model when `agents.overrides` names `ui-lane-pilot`; verifiers never move |

### Switch-over (owner)

In this order, so that no project ever runs a mix of versions:

1. `scripts/workflow/release.sh v1.0.0 --apply`: tag the last 1.x commit `v1.0.0` first if it is not
   tagged, then pin every project to v1 (`~/.claude/commands` and `~/.claude/templates` point at the
   pinned checkout `~/.claude/workflow-release`). Run it once without `--apply` and read the plan first.
2. Merge the v2 branch into `main` and tag the merge commit `v2.0.0`.
3. `scripts/workflow/release.sh v2.0.0 --apply` moves the pinned checkout to v2.
4. Optional, per project: copy `.claude/templates/workflow-profile.example.json` to
   `<project>/.claude/workflow-profile.json`, edit it, and run `profile-check.mjs` on it.
5. A batch already in flight has no `workflow_version` and is treated as 1.0.0: on `--resume` it
   follows that version's text (`git -C ~/claudeworkflow show v1.0.0:.claude/commands/<file>`).

Until step 1, `$WH` (`_shared-project-profile.md`) falls back to the repo `~/.claude/commands` points
into, and `workflow_version` is that repo's `VERSION`.

### Rollback

`scripts/workflow/release.sh v1.0.0` to preview, then `--apply`. Profiles may stay in projects; 1.x
ignores them. Finish a batch started on 2.0.0 before rolling back: 1.x commands do not read
`workflow_version`.
