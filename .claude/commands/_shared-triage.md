---
description: Shared protocol, not a standalone command. Which verification findings block, the 2-sweep cap, the deferred log, and how an independent verifier focuses on the delta's risks.
disable-model-invocation: true
---
<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: implement-plan, implement-batch, verify-implementation, verify-ui, e2e-validate
Generated: 2026-10-27 (replaces the 5-iteration, zero-Medium verify loop)
Last audit: 2026-11-25 (v2: risk focus from the profile, a regression guard on shared code, verifiers on
Opus. Generalist verifiers of contract lanes had found nothing; specialist ones found CRITICAL defects)
-->

# Verification triage

**A module passes when no CRITICAL or HIGH finding is open after at most 2 sweeps.** Medium, Low and
edge cases are logged with a reason, not chased.

## Severity → action

| Finding | Action |
|---|---|
| CRITICAL: a project invariant broken (list below) | fix now; blocks the merge |
| HIGH: a security, contract, data-loss or wiring defect; an actionable stub the module should have replaced | fix now; blocks the merge |
| Breaks normal use, at any severity: a main-path screen, flow or command that a typical user hits | treat as HIGH |
| MEDIUM, LOW, edge case, style, copy nit, a few pixels of spacing | log in **Deferred findings** with a reason and a revisit trigger |
| Intentional stub (post-MVP, waiting on a later module) | track only |

Re-mapped from `/verify-implementation`'s categories: UI-STYLE with 1–3 properties, STUB-TEST,
STUB-STAGE (module in progress), DOC-FLOW and logging/quality gaps are **logged** unless they break
normal use.

## The project's CRITICAL list

The project's invariants and hard guardrails: the sections the profile's `docs.invariants` and
`docs.guardrails` name (`_shared-project-profile.md`), or without a profile, CLAUDE.md's invariants section
and `## Hard guardrails`. A breach of any of them is CRITICAL. Typical entries: suppression or consent
bypass, cross-tenant data leak, PII in a URL, a call to a live third-party service from local code, a
non-additive migration. If the project names none, use: security bypass, data loss, cross-tenant leak,
secrets exposed. A red in a suite the profile lists in `invariant_suites` is CRITICAL until shown otherwise.

## The sweep cap

1. **Sweep 1** audits and fixes.
2. **Sweep 2** re-checks only the fixes and the code they touched.
3. **Stop.** A HIGH still open after sweep 2 marks the module `VERIFY_FAILED` with the finding named.
   Dependent modules go ahead, flagged `DEPENDS_ON_UNVERIFIED`.
4. **The same finding twice** means stop fixing it: log it as architectural, and raise an Owner item if
   it needs a decision.

## Deferred findings log

One table in the task list (or the module's report when run standalone):

| Module | Finding | Severity | Why deferred | Revisit when |
|---|---|---|---|---|

## How a verifier works

- **Independent.** A different agent from the one that wrote the code, on `agents.verifier_model`
  (default `opus`). Its brief says: "You did not write this code; be skeptical. Verify the implementer's
  claims, don't trust them."
- **Verify what will merge, merging once.** Merge the integration branch into the lane once, at the start,
  then verify the result. This doubles as merge prep: migration renumbering, conflict resolution, the
  journal-order check. Merge again at the end **only if the integration branch moved**.
- **`tiers.merge` once, on your final head**, never per sweep (`run-tier.mjs merge --parallel`), and record
  that head's sha with the result. The orchestrator's merge skips the tier when the lane head is that sha
  and it contains the integration head.
- **Focus on the risk, not the whole module:**
  - **the delta** (`git diff <base>...HEAD`) **and its callers**: the code that imports or calls what
    changed;
  - **the focus list** from the profile's `risk_routing`: each route whose `paths` match a changed file adds
    its `reason` to the list and its `verifier` as the agent type (several matches: one verifier per type,
    split by file ownership). No profile (v1): the orchestrator picks the focus from the module's risks: its
    invariants, the screens with the most states, new routes, new cross-package dependencies;
  - **the risks the lane did not test**, rather than re-proving what its tests already cover.
- **Regression guard.** A fix to shared code (a file other modules import) runs its callers' tests too,
  not only the fix's own.
- **Re-run the lane's selection once** (`_shared-test-selection.md`), then only the delta of your fixes.
- **Run the code as well as reading it.** Reading finds security and contract defects; only running
  finds the rest:
  - UI through `_shared-ui-parity.md`, the one parity pass;
  - network code against one real local socket, not only fakes;
  - one real request per route access class.
- **Check a claim by running it before acting on it**, including another verifier's claim.
- **Report** in the final reply, at most `limits.handback_lines` (default 30) lines, under these headings:
  `Verdict` · `Findings` (by severity, each fixed with its commit or deferred with its reason) · `UI parity`
  (per screen, pair paths) · `Stubs` (actionable vs blocked) · `Tests run` · `Merge prep` (migrations after
  renumbering, the final head sha, the integration head it contains, `tiers.merge` green or red on it).
