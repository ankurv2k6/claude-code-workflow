---
description: Shared protocol, not a standalone command. Which verification findings block, the 2-sweep cap, the deferred log, and how an independent verifier works.
disable-model-invocation: true
---
<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: implement-plan, implement-batch, verify-implementation, verify-ui, e2e-validate
Generated: 2026-10-27 (replaces the 5-iteration, zero-Medium verify loop)
Last audit: 2026-10-27
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

Each project names its invariants in CLAUDE.md (an invariants section, or `## Hard guardrails`). A
breach of any of them is CRITICAL. Typical entries: suppression or consent bypass, cross-tenant data
leak, PII in a URL, a call to a live third-party service from local code, a non-additive migration.
If CLAUDE.md names none, use: security bypass, data loss, cross-tenant leak, secrets exposed.

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

- **Independent.** A different agent from the one that wrote the code. Its brief says: "You did not
  write this code; be skeptical. Verify the implementer's claims, don't trust them."
- **Verify what will merge.** First merge the integration branch into the lane, then verify the result.
  This doubles as merge prep: migration renumbering, conflict resolution, the journal-order check.
- **Run the code as well as reading it.** Reading finds security and contract defects; only running
  finds the rest:
  - UI through `~/.claude/commands/_shared-ui-parity.md`;
  - network code against one real local socket, not only fakes;
  - one real request per route access class.
- **Check a claim by running it before acting on it**, including another verifier's claim.
- **Report** (≤ 30 lines): verdict, findings by severity with fix commits or deferral reasons, UI
  parity per screen with screenshot paths, stubs (actionable vs blocked), tests run, final head sha.
