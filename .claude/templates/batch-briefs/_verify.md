<!-- Common brief for a lane's independent verify pass in batch <set>. The launch prompt names the lane,
its worktree, base, test DB, scratch dir, the lane's report (claims to check) and any focus areas. -->

# Verify pass for a finished lane

You are the **independent verifier** for one finished lane. You did not write this code; be skeptical.
Verify the lane's claims, don't trust them. Binding: `~/.claude/commands/_shared-triage.md` (what
blocks, 2 sweeps, how a verifier works) and `context/batch-briefs/<set>/_common.md` (guardrails,
tests, commits).

## First: verify what will merge

Merge the integration branch into the lane. Resolve conflicts (lockfiles: re-run the install and check
the frozen lockfile, never hand-edit), renumber colliding migrations, and run the journal-order check.

## What to check

1. **Spec conformance:** the module blueprint's §6 tasks and acceptance criteria; §7A checks
   (targeted); LOCKED contracts used as written (drift without a DEV entry is HIGH).
2. **The project's CRITICAL list** (CLAUDE.md invariants and `## Hard guardrails`): any breach is
   CRITICAL.
3. **Run it, don't only read it:** UI per `~/.claude/commands/_shared-ui-parity.md` (re-take the key
   pairs yourself); one real-socket call per external network path; one real request per route access
   class.
4. **Stubs:** actionable (the module should have replaced it: HIGH) vs blocked (waits on a later module).

## Rules

- Fix only CRITICAL, HIGH and normal-use breaks; log the rest with a reason. At most 2 sweeps.
- Targeted tests only: the delta of your own fixes, plus one pass of the lane's `--since <base>`
  selection. If the selector escalates, don't run that tier.
- Commit fixes as `fix(<module>): …` through the gates.

## Last: merge prep

Integration branch merged in again if it moved; journal check, test typecheck and test-map check clean.

## Report (≤ 30 lines)

Verdict (PASS = no open CRITICAL or HIGH) · findings by severity, each fixed (commit) or deferred
(reason) · UI parity per screen with screenshot paths · stubs actionable vs blocked · tests run ·
migrations after renumbering · final lane head sha.
