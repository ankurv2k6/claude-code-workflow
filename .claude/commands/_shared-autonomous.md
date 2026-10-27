---
description: Shared protocol, not a standalone command. Autonomous execution, the standing delivery rules and the guardrails every agent-launching command applies and copies into every agent brief.
disable-model-invocation: true
---
<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: implement-plan, implement-batch, verify-implementation, verify-ui, design-ui, blueprint, e2e-validate
Generated: 2026-02-25
Last audit: 2026-10-27 (standing rules and guardrails added)
-->

# Autonomous execution and standing rules

## 1. No pauses

> 🚫 Execute the ENTIRE operation without stopping. Do NOT pause between iterations, modules or layers
> to report status, ask "should I continue?", or wait for input. Only stop for a FATAL error or when all
> work is complete.

## 2. Decide, don't ask

When a decision is needed, weigh 2–3 options against the spec, the code's existing patterns and
maintainability; pick the best; log it (the module's Deviations, or the batch Decision log); continue.

A question only the owner can answer (spend, legal, vendor, production access, credentials, a
production change) goes to **Owner items** in the task list, with the default you are working under.
Work continues around it.

## 3. Standing delivery rules

Apply these, and copy them word for word into every agent brief:

1. **Match the mockups.** A UI change is done only when real-browser screenshot pairs match the mockup
   in the same state (`~/.claude/commands/_shared-ui-parity.md`).
2. **Targeted tests only.** Run what the selector names for the files you changed, once. Never the
   full suite, never the same broad set twice. The orchestrator makes one full run per batch, on the
   final head (`~/.claude/commands/_shared-test-selection.md`).
3. **Fix what matters.** CRITICAL, HIGH and normal-use breaks get fixed; the rest is logged with a
   reason. At most 2 sweeps (`~/.claude/commands/_shared-triage.md`).
4. **Keep the living task list.** Only the orchestrator writes it; agents report into it.
5. **Track every agent.** Brief on disk before launch; id in the task list at launch
   (`~/.claude/commands/_shared-agent-tracking.md`).
6. **Set effort by role** (`~/.claude/commands/_shared-effort-budget.md`).

## 4. Universal guardrails

These hold in every project:

- **No push of the default branch, or of any branch whose push deploys, without the owner's approval of
  that specific push.** Agents launched by a command never push.
- **Never `--no-verify`.** Never force-push the default branch.
- **Never `pkill`, `killall` or kill by process name.** Stop only PIDs you started.
- **Work only in your own worktree, databases and ports.**
- **Never write secrets** to disk, `.env`, logs or commit messages.
- **Never edit CLAUDE.md without the owner's confirmation.**

## 5. Project guardrails

Read the `## Hard guardrails` section of the project's CLAUDE.md: live services never to call,
addresses never to touch, credentials to unset in every shell, tools never to run. They are as binding
as section 4; copy them verbatim into every agent brief.

If the section is missing, propose one from `~/.claude/templates/CLAUDE-hard-guardrails.md` to the
owner (CLAUDE.md is not edited without confirmation), and meanwhile apply section 4 alone.
