<!--
CRITICAL CONTENT - DO NOT MODIFY WITHOUT REVIEW
Source commands: commit, implement-plan, implement-batch
Generated: 2026-02-25
Last audit: 2026-02-25
-->

# Commit Protocol

**Format** (Conventional Commits):

```
<type>(<scope>): <subject>

<body>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

**Subject**: Imperative mood, max 50 chars, no period

**HEREDOC pattern** (for correct formatting):
```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <subject>

<body>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Rules**:
- Do NOT push unless explicitly requested
- Capture commit SHA for tracking
- Never use `--no-verify` to skip hooks
- Never force push to `main`/`master` without explicit request
