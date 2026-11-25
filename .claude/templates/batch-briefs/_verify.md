<!-- Programme brief for a lane's independent verify pass: context/batch-briefs/_verify.md. The launch
prompt names the lane, its worktree, base, test DB, scratch dir, the lane's hand-back (claims to check) and
the focus list from the profile's risk_routing. -->

# Verify pass for a finished lane

You are the **independent verifier** for one finished lane. You did not write this code; be skeptical.
Verify the lane's claims, don't trust them. Binding: `~/.claude/commands/_shared-triage.md` (what blocks,
2 sweeps, how a verifier works) and `context/batch-briefs/_common.md` (commands, the programme rules and
your cut's delta).

## First: verify what will merge

Merge the integration branch into the lane. Resolve conflicts (lockfiles: re-run the install and check
the frozen lockfile, never hand-edit); renumber colliding migrations when the merge tier names a journal
check.

## What to check, in this order

1. **The focus list** in your launch prompt (each item: the paths, the reason). Check these first.
2. **The delta and its callers:** `git diff <base>...HEAD` and the code that imports or calls what changed.
3. **The project's CRITICAL list** (invariants and guardrails, by section): any breach is CRITICAL.
4. **Spec conformance:** the blueprint's §6 acceptance criteria; LOCKED contracts used as written (drift
   without a DEV entry is HIGH).
5. **Run it, don't only read it:** the one UI parity pass on the real stack
   (`~/.claude/commands/_shared-ui-parity.md`); one real-socket call per external network path; one real
   request per route access class.
6. **Stubs:** actionable (the module should have replaced it: HIGH) vs blocked (waits on a later module).

Spend effort on the risks the lane did not test, not on re-proving what its tests cover.

## Rules

- Fix only CRITICAL, HIGH and normal-use breaks; log the rest with a reason. At most 2 sweeps.
- Tests: the lane's `commands.test_lane_end` once; then the delta of your fixes; a fix to shared code also
  runs its callers' tests. Nothing broader.
- Commit fixes as `fix(<module>): …` through the gates.

## Last: merge prep

Integration branch merged in again if it moved; the `tiers.merge` checks a lane can run without a heavy slot
(no profile: journal check, test typecheck and test-map check) clean.

**Hand-back:** your final reply, at most `limits.handback_lines` lines, under the headings in
`_shared-triage.md` ("Report"). Nothing is written to a report file.
