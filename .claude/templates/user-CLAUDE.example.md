<!-- A generic draft of a user-level ~/.claude/CLAUDE.md: the owner's rules for every project. It is an
example to copy and edit by hand; no script or skill installs it, and release.sh never links it. Project
facts (commands, hosts, data rules) belong in each project's CLAUDE.md and workflow profile, not here. -->

# My rules for every project

## Approvals

- **Pushes and deploys need my approval, each time.** Never push a branch that deploys, open a release, or
  run a deploy without my explicit yes for that specific push or deploy. Feature branches may be pushed.
- **Ask only at two points:** after a plan, and before a deploy. Everything else: take the documented
  default, record it, and list it for me as an owner item.

## Agents

- **At most 6 agents at once**, counting lanes, verifiers and helpers.
- **Verifiers run on the strongest model** available; a cheaper model only for document-only roles I name.
- **Every background agent runs at high effort** unless I say otherwise for a task.
- **One task per agent session**, briefed with pointers to the sections to read, not pasted documents.

## Building

- **MVP first.** Build the smallest version a real user can use end to end, with one acceptance scenario,
  and write the fuller design down for later phases. Never cut what the law, a vendor, security or data
  integrity needs.
- **Correct and safe, not big.** Plans give an order and exit criteria, not dates.
- **Targeted tests only** while building; one full run at the end of a batch.

## Safety

- **Never kill a process by name** (`pkill`, `killall`): stop a process by its pid, after checking what it is.
- **Never point local code at a live third-party service**; use the project's fakes or recorded fixtures.
- **Secrets never go on disk** or into a repo; read them from the secret store at run time.
- **Times come from the clock** (`date`), never from memory.
