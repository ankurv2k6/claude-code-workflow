---
description: Shared protocol, not a standalone command. Commit message format, attribution, gates and push policy for every command that commits.
disable-model-invocation: true
---
<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: commit, implement-plan, implement-batch, verify-implementation
Generated: 2026-02-25
Last audit: 2026-10-27 (attribution from the session; gates from CLAUDE.md; push policy)
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

Run the project's commit gates, as its CLAUDE.md lists them (typically: secret scan, typecheck,
lint with zero warnings, formatter check, test-map check). Tests run in CI, not in commit hooks.

## Rules

- **Never `--no-verify`.** If a commit slipped through without its gates, the next verifier re-runs them.
- **Capture the commit sha** for the task list and the report.
- **Push policy:** agents launched by a command never push. `/commit` pushes only as its own section
  says; never the default branch, or a branch whose push deploys, without the owner's approval of that
  specific push.
- **Never force-push the default branch.**
