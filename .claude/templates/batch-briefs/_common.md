<!-- Programme rules for every lane of every cut: context/batch-briefs/_common.md. Each lane brief says
"read _common.md first: the programme rules and your cut's delta". The orchestrator fills the commands from
the project profile, adds one `## Delta: <set>` section per running cut, and removes it when the cut closes
(a rule worth keeping moves up into the programme rules). When a rule tightens mid-batch, it edits this file
and messages every running lane. Keep the programme rules under 4 KB and each delta under 2 KB. -->

# Lane rules — <project>

You implement one lane of `/implement-batch`. Work autonomously and never ask questions. When a
decision is needed, weigh 2–3 options against the blueprint, the code's existing patterns and
maintainability; pick the best; record it in the module blueprint's §11 Deviations.

## Binding, by section (already loaded or read by anchor; never copied here)

- `~/.claude/commands/_shared-autonomous.md` §3–§4.
- The project's invariants and guardrails: `<docs.invariants>` and `<docs.guardrails>` from the profile
  (no profile: CLAUDE.md's invariants section and `## Hard guardrails`). Only the rules a lane can act on
  apply to you; nothing here widens what a lane may touch.
- `~/.claude/commands/implement-plan.md` in `--lane` mode, for each module in the order your brief gives.
  If the Skill tool is unavailable, read the file and follow it.

## Reading

- **By anchor, not by file:** the task's section of your impl spec, and the `impl-contracts` sections it
  names (LOCKED sections must not drift without a DEV entry). Read `impl-master` or the blueprint master
  only when the task needs a pattern, decision or stub they hold.
- **Batch independent reads in one turn,** and use ranged reads on large files.

## Commands (from the profile; run exactly these)

| When | Command |
|---|---|
| Shell, first | `<shell_prefix>` |
| Each task | `<commands.test_task>`, all changed files in one call |
| Each commit | `<tiers.per_commit gates>`, or nothing by hand when the pre-commit hook runs them |
| Lane end, once | `<tiers.lane_end gates>`, then `<commands.test_lane_end>` |
| Typecheck | `<commands.typecheck>` (incremental; `<commands.typecheck_clean>` only after a stale-build error) |
| Heavy gate | through `slot.sh`, per `~/.claude/commands/_shared-test-selection.md` |

No profile: the per-edit, per-commit and lane-end commands from `_shared-test-selection.md` and the
project's commit gates (`_shared-commit-protocol.md`), written out here by the orchestrator.

## Standing rules

- **Tests:** targeted only. Never the full run, and no gate from the cut-end or track-merge tiers. A red
  listed in `<known_reds>` is known: name it, don't diagnose it.
- **Long commands** write to `<logs_dir>`; **never end your turn while your own background job runs**.
- **Context:** end the session at a task boundary once context passes `<limits.context_budget_tokens>`:
  commit, update `.lane/progress.md`, hand back `Session split`.
- **UI:** build to the mockups. Read each screen's wireframe (its Information decisions table governs) and
  mockup with every state. Use the shared primitives and theme tokens; no colour literals. The parity proof
  is your verifier's pass on the real stack (`~/.claude/commands/_shared-ui-parity.md`).
- **Verification:** self-review against `~/.claude/commands/_shared-triage.md`, at most 2 sweeps. A
  separate verifier follows your lane.
- **Commits:** one per task, task id in the subject (`feat(m12): T4 …`), through the project's gates.
  Never `--no-verify`. Migrations are additive; the orchestrator renumbers them at merge.

## Done means

- Your tasks are implemented and their §7A checks pass (targeted).
- `tiers.lane_end` and `commands.test_lane_end` ran once, green or with each red named.
- Self-review clean of CRITICAL and HIGH (at most 2 sweeps); LOW and MEDIUM listed.

**Hand-back:** your final reply, at most `<limits.handback_lines>` lines, under these headings:
`Status` (done | session split | blocked) · `Commits` · `Tasks` · `Tests` · `Migrations` · `Screens` ·
`Deviations` · `Deferred` · `Owner items` · `Merge notes`. Nothing is written to a report file.

## Delta: <set>

<Only what this cut changes: a rule that tightened, a merge note, a stub to keep. Delete when the cut closes.>
