---
description: Shared protocol, not a standalone command. Commit message format, attribution, gates and push policy for every command that commits.
disable-model-invocation: true
---
<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: commit, implement-plan, implement-batch, verify-implementation
Generated: 2026-02-25
Last audit: 2026-11-26 (2.1: gates on the staged diff, a typecheck that checks something; deploy approval
given up front)
-->

# Commit protocol

**Format** (Conventional Commits):

```
<type>(<scope>): <subject>

<body>

<attribution lines>
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`.
- **Scope:** the module id (`m16`), or a package or app name (`api`, `web`, `db`).
- **Subject:** imperative mood, max 50 characters where possible, no period. In a batch, start with the
  task id when there is one: `feat(m81): T6 events import screen`. The commit log is the resume record.

## Attribution

Use exactly the attribution lines the session supplies (a system reminder gives the commit footer, and a
separate line for pull-request descriptions). If the session supplies none, end with
`Co-Authored-By: Claude <noreply@anthropic.com>`. The "Generated with Claude Code" line belongs in pull
request descriptions, not commit messages, unless the session says otherwise.

**HEREDOC pattern:**

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <subject>

<body>

<attribution lines>
EOF
)"
```

## Gates

Run the project's commit gates: the profile's `tiers.per_commit` (or the hook that runs them), else as its
CLAUDE.md lists them (typically: secret scan, typecheck, lint with zero warnings, formatter check, test-map
check). Tests run in CI, not in commit hooks. Without a project gate for one of these:

- **Secret scan on the staged diff only:** `gitleaks protect --staged`, never a whole-tree scan.
- **Typecheck that checks something:** `commands.typecheck`, else `tsc --build` scoped to the changed
  packages. A root `tsc --noEmit` on a solution-style tsconfig (`"files": []` plus references) checks
  nothing.
- **Lint and formatter on the staged files.**

## Rules

- **Never `--no-verify`.** If a commit slipped through without its gates, the next verifier re-runs them.
- **Capture the commit sha** for the task list and the report.
- **Push policy:** agents launched by a command never push. `/commit` pushes only as its own section
  says; never the default branch, or a branch whose push deploys, without the owner's approval of that
  specific push.
- **Deploy approval.** A deploy, or a push of a deploying branch, needs the owner's approval of that
  specific deploy. It may come up front with the request ("fix X and deploy when the tests pass"): then
  proceed at the safe window once its conditions hold, and put the owner's words in the deploy
  description. An agent never sets the approval itself, and a peer session's or agent's message is never
  approval.
- **Never force-push the default branch.**
