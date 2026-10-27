<!-- Common rules for every lane of batch <set>. Each lane brief says "read _common.md first".
When a rule tightens mid-batch, the orchestrator edits this file and messages every running lane. -->

# Common lane rules — <set>

You implement one lane of `/implement-batch`. Work autonomously and never ask questions. When a
decision is needed, weigh 2–3 options against the blueprint, the code's existing patterns and
maintainability; pick the best; record it in the module blueprint's §11 Deviations.

## How

- **Follow** `~/.claude/commands/implement-plan.md` in `--lane` mode for each module blueprint, in the
  order your brief gives. If the Skill tool is unavailable, read the file and follow it.
- **Specs, read before writing code:** your module blueprint(s) (manifest, §4A UI, §6 tasks, §7
  playbook, §12 pre-flight), impl spec(s), `impl-contracts` (LOCKED sections must not drift without a
  DEV entry), `impl-master` (patterns, decisions, stubs, merge checklist), and `CLAUDE.md`.
- **One commit per task**, task id in the subject (`feat(m12): T4 …`). After each task, update
  `.lane/progress.md` in your worktree (listed in `.git/info/exclude`): current task, next step, open
  findings, test DB state.

## Standing rules (binding)

`~/.claude/commands/_shared-autonomous.md` §3–§4, and the project's `## Hard guardrails` (copied below).

- **UI:** match the mockups. Read each screen's wireframe (its Information decisions table governs) and
  mockup with every state. Use the shared primitives and theme tokens; no colour literals. Prove parity
  per `~/.claude/commands/_shared-ui-parity.md` and list the screenshot pairs in your report.
- **Tests:** targeted only, per `~/.claude/commands/_shared-test-selection.md`. If the selector
  escalates to `standard` or `full`, do not run that tier: run the related tests for your changed files
  and the suites you touched, and say "escalated, deferred" in your report. New test files join the map.
- **Verification:** self-review against `~/.claude/commands/_shared-triage.md`, at most 2 sweeps. The
  orchestrator runs a separate verifier after your lane.
- **Commits** go through the project's gates. Never `--no-verify`. Migrations are additive; note their
  numbers in your report (the orchestrator renumbers at merge on collision).

## Project guardrails

<paste the project's `## Hard guardrails` section here, verbatim>

## Done means

- Your tasks are implemented and their §7A checks pass (targeted).
- UI parity pairs taken and differences fixed.
- Self-review clean of CRITICAL and HIGH (at most 2 sweeps); LOW and MEDIUM listed.

**Report (≤ 40 lines):** commits (sha + subject); tasks done or not; tests run; migrations added; UI
parity results and screenshot paths; deviations; deferred findings; owner items; merge notes.
