<!-- Programme brief for a lane's independent verify pass: context/batch-briefs/_verify.md. The launch
prompt names the lane, its worktree, base, test DB, scratch dir, the lane's hand-back (claims to check) and
the focus list from the profile's risk_routing. -->

# Verify pass for a finished lane

You are the **independent verifier** for one finished lane. You did not write this code; be skeptical.
Verify the lane's claims, don't trust them. Binding: `$WH/.claude/commands/_shared-triage.md` (installed
at `~/.claude/commands` after release; what blocks, 2 sweeps, how a verifier works) and
`context/batch-briefs/_common.md` (commands, the programme rules and your cut's delta).

## First: verify what will merge (merge once)

Merge the integration branch into the lane **once, now**. Resolve conflicts (lockfiles: re-run the
install and check the frozen lockfile, never hand-edit); renumber colliding migrations (`merge.renumber`
when the profile has it) and run the journal check (`merge.check`).

## What to check, in this order

1. **The focus list** in your launch prompt (each item: the paths, the reason). Check these first.
2. **The delta and its callers:** `git diff <base>...HEAD` and the code that imports or calls what changed.
3. **The project's CRITICAL list** (invariants and guardrails, by section): any breach is CRITICAL.
4. **Spec conformance:** the blueprint's §6 acceptance criteria; LOCKED contracts used as written (drift
   without a DEV entry is HIGH).
5. **Run it, don't only read it:** the one UI parity pass on the real stack
   (`$WH/.claude/commands/_shared-ui-parity.md`); one real-socket call per external network path; one real
   request per route access class.
6. **Stubs:** actionable (the module should have replaced it: HIGH) vs blocked (waits on a later module).

Spend effort on the risks the lane did not test, not on re-proving what its tests cover.

## Rules

- Fix only CRITICAL, HIGH and normal-use breaks; log the rest with a reason. At most 2 sweeps.
- Tests: the lane's `commands.test_lane_end` once; then the delta of your fixes; a fix to shared code also
  runs its callers' tests. Nothing broader.
- Commit fixes as `fix(<module>): …` through the gates.

## Last: merge prep

1. **Merge the integration branch again only if it moved** since your first merge
   (`git merge-base --is-ancestor <integration head> HEAD` fails); otherwise do not.
2. **Run `tiers.merge` once, on your final head** (`node "$WH/scripts/workflow/run-tier.mjs" merge
   --parallel --base <integration head> --url <integration_test_db>`; no profile: journal check, test
   typecheck and test-map check). Never at each sweep. A heavy gate takes its slot; an agent gate it lists
   is the orchestrator's, not yours.
3. **Record that head's sha** and the tier's result under "Merge prep". When it is green and the head
   contains the integration head, the orchestrator's merge skips `tiers.merge` (`merge-lane.mjs
   --verified-head <sha>`).

**Hand-back:** your final reply, at most `limits.handback_lines` lines, under the headings in
`_shared-triage.md` ("Report"). Nothing is written to a report file.
