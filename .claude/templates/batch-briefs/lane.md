<!-- Brief for lane <lane>, <date>. Relaunch with this text plus the resume preface in
~/.claude/commands/_shared-agent-tracking.md. Keep under 60 lines: point at files, don't paste them. -->

Read `context/batch-briefs/<set>/_common.md` first; it is binding.

# Lane <lane>: <modules, in order>

**What:** implement `<module blueprint path(s)>` with `<impl spec path(s)>`, in this order: <order>.
<One or two sentences on anything this lane must know that the specs don't say: a stub to replace, a
contract-first cycle, a merge note from an earlier lane.>

**Where:**
- worktree `<path>`, branch `<branch>` at base `<sha>`; run `<install && build>` first;
- test DB `<lane db>` on `<host:port>` (fresh: `<bootstrap script>`); lane prefix `<prefix>`;
- ports: api `<port>`, web `<port>`;
- scratch `<scratch dir>/agents/<lane>/`.

**Effort:** high (`~/.claude/commands/_shared-effort-budget.md`, row "Implementation lane").

**Screens (if any):** `<screen ids>`: wireframes `<paths>`, mockups `<paths>` and their states.

**Done:** per `_common.md` "Done means", plus: <lane-specific acceptance, e.g. stub X replaced, flag Y
false>.
