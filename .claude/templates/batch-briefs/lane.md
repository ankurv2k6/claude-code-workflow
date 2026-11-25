<!-- Brief for lane <lane>, <date>. Relaunch with this text plus the resume preface in
~/.claude/commands/_shared-agent-tracking.md. Keep under 60 lines: point at sections, don't paste them. -->

Read `context/batch-briefs/_common.md` first: the programme rules and `## Delta: <set>`. Both are binding.

# Lane <lane>: <modules, in order>

**What:** implement `<module blueprint path(s)>` with `<impl spec path(s)>`, in this order: <order>.
<One or two sentences on anything this lane must know that the specs don't say: a merged input to build on,
a contract-first cycle, a merge note from an earlier lane.>

**Read first** (by anchor, in one turn): `<impl spec>#<task section>`, `<impl-contracts>#<sections>`,
`<blueprint>#<§6 acceptance>`.

**Where:**
- worktree `<path>`, branch `<branch>` at base `<sha>`; run `<commands.install>` and `<commands.build>` first
  (skip when the scaffold already built it);
- test DB `<name from test_db.name_pattern>` (fresh: `<test_db.bootstrap>`);
- ports: `<from the port registry>`;
- logs `<logs_dir>`; scratch `<scratch dir>/agents/<lane>/`.

**Commands:** as `_common.md` lists them; for this lane `{base}` = `<sha>`.

**Effort:** high (`~/.claude/commands/_shared-effort-budget.md`, row "Implementation lane").

**Screens (if any):** `<screen ids>`: wireframes `<paths>`, mockups `<paths>` and their states.

**Done:** per `_common.md` "Done means", plus: <lane-specific acceptance, e.g. stub X replaced, flag Y
false>. Hand back under `_common.md`'s headings.
