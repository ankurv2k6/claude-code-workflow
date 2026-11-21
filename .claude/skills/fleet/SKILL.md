---
name: fleet
description: Send parallel research and review work to the home-LAN worker laptops instead of running it on the iMac. Use when a task splits into two or more independent tracks that read code, docs or the web and write a report (codebase research, competitor or web research, audits, reviews) in any git repo, or when the user mentions the fleet, workers or worker-01. Not for work that needs the iMac's databases, containers or running app.
---

# fleet: send work to the worker laptops

The iMac orchestrates; the workers run unattended Claude Code **lanes**, each in its own git worktree, in auto mode
(the same permission mode as an iMac session). Workers hold no GitHub or AWS credentials: the iMac pushes code to them
over SSH and fetches the lane branches back. `fleet --help` lists every command.

## Decide what goes where

- **Lanes on a worker:** tracks that read code, docs, git history or the web and write a report.
- **Your own subagents on the iMac:** anything that needs the running app, a database or containers (they stay on the
  iMac for now), MCP servers or connectors, anything interactive, anything that needs GitHub or AWS.
- **Any git repo works with no setup.** `fleet lane .` registers the repo on first use; a `.fleet/` recipe is optional.
  Outside a git repo, give the repo's path instead of `.`.

## What a lane gets

- **The checkout as it is now:** HEAD, a snapshot commit of uncommitted and untracked files, and the gitignored files,
  except `node_modules` and `.venv` (macOS builds). Commit nothing first; fleet prints what it sent.
- Your user skills, the workflow commands, the repo's own agents and a read-only copy of the project's memory.
- **Not:** MCP servers, plugins, or anything running on the iMac. The worker is Linux: macOS-only tools (`sips`) and
  paths (`/Users/…`) don't exist there; the lane is told to read `/Users/…/<repo>` paths as its worktree.
- Only your brief, not this conversation: put everything the lane needs to know into it.

## Choose the model and effort per lane

Pass `--model` for every lane, by the tiers in `~/.claude/_repo/AGENT-INDEX.md` (section 3):

| `--model` | Use for |
|---|---|
| `opus` | complex reasoning, architecture, security, synthesis, review and verification, code research that needs judgement |
| `sonnet` | general development, wide web reading and summarising, inventories, moderate complexity |
| `haiku` | simple lookups and extraction with a known target |

`--agent <name>` runs the lane as one of the repo's agents (`.claude/agents/<name>.md`) and uses that agent's model
unless `--model` is given. Effort: `--effort` by role (`~/.claude/commands/_shared-effort-budget.md`), and a project or
user rule wins (for example, "every background agent runs at high"); the default is `high`. Opus uses the shared plan's
limits fastest, so do not give a lane Opus out of habit.

## Limits

- **At most 6 agents at once** in total: your local subagents plus every lane (owner rule).
- **fleet does the placing.** Each worker caps its lanes (`slots`, `research_slots`, optional `mem_gb` in
  `~/.fleet/workers`); a lane reserves memory (research lanes 1 GB). Without `--host`, a lane goes to the worker with
  the most free room. `fleet lane` refuses, naming the reason, when no worker has room or a laptop is on battery.
  Other windows' lanes count too, so a refusal is normal: wait for one of your lanes to end, or do the track yourself.
  Never retry in a loop.
- Every lane uses the Claude account the iMac is signed in to, and shares its limits.
- Lanes never push. You push only when the user asks (`fleet fetch --push`).

## Steps

1. **Check:** `fleet status` (a worker is reachable, on mains power and has free slots) and `fleet claude status`.
2. **Brief each track** in the iMac checkout at `context/lanes/<batch>/<lane>-brief.md`. It need not be committed;
   `fleet lane` copies it. A brief holds:
   - **Question:** one question, answerable on its own.
   - **Reading pack:** exact paths, globs and URLs, never "read the docs". Lanes have no one to ask.
   - **Output:** `context/research/<batch>/<lane>.md` (research lanes write only there). Each finding with its evidence
     (`file:line` or URL) and confidence; "not found" stated plainly, after checking ignored files too, not only
     `git ls-files`.
   - **Done when**, and what is out of scope.
   - **Last step:** `git add context/research/<batch> && git commit -m "research(<batch>): <lane>"`.
3. **Dispatch** each lane (names: lowercase and dashes, unique per project, prefixed by the batch, e.g. `ar-a`):
   ```bash
   fleet lane . <lane> --brief context/lanes/<batch>/<lane>-brief.md --profile research --model <opus|sonnet|haiku>
   ```
   Run it from the repo. Pass `--base <branch>` if the task names one (the lane then gets that commit plus the ignored
   files, not your uncommitted work), `--host <worker>` only to pin a lane. It prints the lane's full name,
   `<project>/<lane>`; inside the repo you may write it `./<lane>`.
   - **Exit 4 means "run it on the iMac":** the worker lacks this checkout's files and copying them first would take
     over a minute (fleet sends nothing). Do that track yourself, as a local subagent with the same brief (it counts
     toward the 6), and start `fleet sync . --host <worker>` in the background so later lanes find the files there.
     Pass `--copy-anyway` only when the user would rather wait for the copy than load the iMac.
   - Workers that already hold a repo's files are chosen first, and then only changes travel.
4. **Wait without polling:** run `fleet wait ./<lane>` in the background, one per lane, so you are notified as each
   ends. Meanwhile, do the iMac-only tracks yourself.
5. **Collect** each finished lane:
   - Read the `fleet wait` summary: the model, the result, the **refused tool calls**, the commits.
   - `fleet fetch ./<lane>` puts the lane's commits on your HEAD at dispatch (without the snapshot), then read the report
     with `git show lane/<lane>:context/research/<batch>/<lane>.md`. If fetch says a commit does not apply, read it from
     `refs/fleet/raw/<lane>` instead and tell the user.
   - Refused calls in auto mode are the classifier or a hard rule (push, credentials) saying no: report them; never
     work around one.
6. **Clean up** once you have saved what you need: `fleet remove ./<lane> --delete-branch` (the worker's and the iMac's
   copies). Logs stay in `~/.fleet/lanes-archive`.

Watch a lane live with `fleet logs ./<lane> --follow`. Stop one with `fleet remove ./<lane> --force`.

## When something goes wrong

| Symptom | Do |
|---|---|
| `fleet lane` says the worker is not on the iMac's account | `fleet claude status`; tell the user if a token is missing (`fleet claude add`) |
| A lane ends with refused tool calls | Report them; rerun with a brief that avoids them |
| A lane ends with an error result about usage limits | Tell the user; rerun after the limit resets |
| `fleet status` shows a lane as `gone` (the worker restarted) | Dispatch it again; its branch keeps whatever it had committed |
| `fleet lane` exits 4, "run … on the iMac" | Run the track locally; `fleet sync . --host <worker>` in the background for next time |
| `no worker can take a … lane now` | Wait for one of your lanes to end, or run the track locally; say which. "On battery": ask the user to plug the laptop in |
