---
name: fleet
description: Send parallel research and review work to the home-LAN worker laptops instead of running it on the iMac. Use when a task splits into two or more independent tracks that read code, docs or the web and write a report (codebase research, competitor or web research, audits, reviews) in any git repo, or when the user mentions the fleet, workers or worker-01. Not for work that needs the iMac's databases, containers or running app.
---

# fleet: send work to the worker laptops

The iMac orchestrates; the workers run unattended Claude Code **lanes**, each in its own git worktree. Workers hold no
GitHub or AWS credentials: the iMac pushes code to them over SSH and fetches the lane branches back. `fleet --help` lists
every command.

## Decide what goes where

- **Lanes on a worker:** tracks that only read code, docs, git history or the web and write a report.
- **Your own subagents on the iMac:** anything that needs the running app, a database or containers (they stay on the
  iMac for now), anything interactive, anything that needs GitHub or AWS.
- **Any git repo works with no setup.** `fleet lane .` registers the repo on first use; a `.fleet/` recipe is optional
  (without one a lane gets its worktree and nothing more). Outside a git repo, give the repo's path instead of `.`.

## Limits

- **At most 6 agents at once** in total: your local subagents plus every lane (owner rule).
- **fleet does the placing.** Each worker caps its lanes (`slots`, `research_slots`, optional `mem_gb` in
  `~/.fleet/workers`); a lane reserves memory (research lanes 1 GB). Without `--host`, a lane goes to the worker with
  the most free room, and `fleet lane` refuses, naming the reason, when no worker has room. Other windows' lanes count
  too, so a refusal is normal: wait for one of your lanes to end, or do the track yourself. Never retry in a loop.
- `fleet status` shows each worker's lanes against its caps, its reserved and available memory and its load.
- Every lane uses the Claude account the iMac is signed in to, and shares its limits. Use `--model sonnet` for wide web
  reading; keep the default model for code research, verification and synthesis.
- Lanes never push. You push only when the user asks (`fleet fetch --push`).

## Steps

1. **Check:** `fleet status` (the worker is reachable and has free slots) and `fleet claude status` (same account).
2. **Brief each track** in the iMac checkout at `context/lanes/<batch>/<lane>-brief.md`. It need not be committed;
   `fleet lane` copies it. A brief holds:
   - **Question:** one question, answerable on its own.
   - **Reading pack:** exact paths, globs and URLs, never "read the docs". Lanes have no one to ask.
   - **Output:** `context/research/<batch>/<lane>.md`, the only place a research lane can write. Each finding with its
     evidence (`file:line` or URL) and confidence; "not found" stated plainly.
   - **Done when**, and what is out of scope.
   - **Last step:** `git add context/research/<batch> && git commit -m "research(<batch>): <lane>"`.
3. **Dispatch** each lane (names: lowercase and dashes, unique per project, prefixed by the batch, e.g. `ar-a`):
   ```bash
   fleet lane . <lane> --brief context/lanes/<batch>/<lane>-brief.md --profile research [--model sonnet]
   ```
   Run it from the repo. The lane starts from the committed `HEAD`: uncommitted changes are not sent (fleet says so).
   Pass `--base <branch>` if the task names one, `--host <worker>` only to pin a lane. It prints the lane's full name,
   `<project>/<lane>`; inside the repo you may write it `./<lane>`.
4. **Wait without polling:** run `fleet wait ./<lane>` in the background, one per lane, so you are notified as
   each ends. Meanwhile, do the iMac-only tracks yourself.
5. **Collect** each finished lane:
   - Read the `fleet wait` summary: the result, the **refused tool calls**, the commits.
   - `fleet fetch ./<lane>`, then read the report with
     `git show lane/<lane>:context/research/<batch>/<lane>.md`.
   - If refused calls blocked the lane, say which, then rerun with a narrower brief or ask the user to widen the
     allow-list. Never work around a refusal.
6. **Clean up** once you have saved what you need: `fleet remove ./<lane> --delete-branch`. Logs stay in
   `~/.fleet/lanes-archive`.

Watch a lane live with `fleet logs ./<lane> --follow`. Stop one with `fleet remove ./<lane> --force`.

## When something goes wrong

| Symptom | Do |
|---|---|
| `fleet lane` says the worker is not on the iMac's account | `fleet claude status`; tell the user if a token is missing (`fleet claude add`) |
| A lane ends with refused tool calls | Report them; rerun with a brief that avoids them, or ask the user to widen the allow-list |
| A lane ends with an error result about usage limits | Tell the user; rerun after the limit resets |
| `fleet status` shows a lane as `gone` (the worker rebooted) | Dispatch it again; its branch keeps whatever it had committed |
| `no worker can take a … lane now` | Wait for one of your lanes to end, or run the track locally; say which |

## What a lane can do

- **research** profile: read anything in its worktree; read-only git; web search and web pages; write only under
  `context/research/`; commit. No edits elsewhere, no `pnpm`, `node` or `docker`, no push.
- **build** profile: wider (edits, `pnpm`, tests without a database). Use it only when the task needs it.
- A lane's port block and settings are written into its prompt. Unattended sessions refuse shell commands that expand
  most environment variables, so a lane writes those values out literally.
