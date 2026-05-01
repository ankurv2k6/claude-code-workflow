---
name: commit
description: Stage, commit, and push all changes to the repository with an AI-generated commit message following project conventions.
---

# Commit Changes

**Command**: `/commit [message]`
**Usage**:

- `/commit` - Auto-generate commit message
- `/commit "message"` - Use provided message
- `/commit --no-push` - Commit without pushing
- `/commit --amend` - Amend previous commit (use with caution)

---

## Workflow

### Step 1: Analyze State

```bash
git status
git diff --stat
git diff --cached --stat
git log --oneline -5
```

### Step 2: Security & Integrity Checks

Run these checks **before staging**. STOP and report if any fail.

#### 2a. Gitleaks Secret Scan (Required)

```bash
# Check if gitleaks is installed
if command -v gitleaks &> /dev/null; then
  gitleaks detect --source . --verbose --no-git
else
  echo "⚠️ gitleaks not installed. Install with: brew install gitleaks"
  # Fallback to manual pattern scan
fi
```

#### 2b. Manual Secret Pattern Scan

Scan staged/changed files for these patterns (case-insensitive):

```bash
# Only run grep if there are staged files (prevents xargs hang on empty input)
staged_files=$(git diff --cached --name-only)
[ -n "$staged_files" ] && echo "$staged_files" | xargs grep -iE \
  "(api[_-]?key|secret[_-]?key|password|passwd|pwd)\s*[:=]\s*['\"][^'\"]+['\"]" \
  "(AWS|AZURE|GCP|GITHUB|GITLAB|SLACK|STRIPE|TWILIO)[_-]?(SECRET|KEY|TOKEN)" \
  "-----BEGIN (RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY-----" \
  "(sk-[a-zA-Z0-9]{32,}|ghp_[a-zA-Z0-9]{36}|xox[baprs]-[a-zA-Z0-9-]+)" \
  "Bearer [a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+"
```

**STOP if matches found** - require explicit user confirmation to proceed.

#### 2c. Sensitive File Check

**STOP if found in staged files**:

- `.env*` (except `.env.example`, `.env.sample`)
- `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.keystore`
- `credentials.json`, `secrets.json`, `*_secret*.json`
- `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`
- `.npmrc`, `.pypirc` with auth tokens
- `*.sqlite`, `*.db` (database files)

#### 2d. Code Integrity Checks

Scan for issues that shouldn't be committed:

```bash
# Debug code / development artifacts
git diff --cached | grep -E \
  "console\.(log|debug|trace)\(" \
  "debugger;" \
  "TODO:|FIXME:|HACK:|XXX:" \
  "\.only\(" # test.only, describe.only
```

**Warn** (don't stop) if found - ask user to confirm.

#### 2e. Repository Safety Checks

**STOP if**:

- Files >1MB (suggest Git LFS)
- On `main`/`master` (suggest feature branch)
- Unresolved merge conflicts (`<<<<<<<`, `=======`, `>>>>>>>`)
- Binary files in unexpected locations

#### 2f. TypeScript & Lint Checks (Required)

Run type checking and linting on changed files. **STOP if errors found**.

```bash
# TypeScript type check (if tsconfig.json exists)
if [ -f "tsconfig.json" ]; then
  npx tsc --noEmit
fi

# ESLint (if .eslintrc* or eslint.config.* exists)
if ls .eslintrc* eslint.config.* 1> /dev/null 2>&1; then
  # Lint only staged files for speed (skip if no matching files)
  lint_files=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx|js|jsx)$')
  [ -n "$lint_files" ] && echo "$lint_files" | xargs npx eslint --max-warnings=0
fi

# Prettier check (if .prettierrc* or prettier.config.* exists)
if ls .prettierrc* prettier.config.* 1> /dev/null 2>&1; then
  fmt_files=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx|js|jsx|json|md)$')
  [ -n "$fmt_files" ] && echo "$fmt_files" | xargs npx prettier --check
fi
```

**On failure**: Fix errors before committing. Do NOT skip with `--no-verify`.

#### 2g. Explicit Exclusions

**DO NOT run during commit**:

- Unit tests (`npm test`, `vitest`, `jest`)
- Integration tests
- E2E tests
- Build processes (`npm run build`)

Tests should run in CI/CD pipelines, not blocking local commits.

### Step 3: Generate Commit Message

See `_shared-commit-protocol.md` for format (Conventional Commits), types, HEREDOC pattern, and subject rules.

**Command-specific additions**:
- **Scopes**: `M0`-`M9`, `auth`, `character`, `story`, `scene`, `api`, `ui`
- Include `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line before Co-Authored-By

### Step 4: Stage & Commit

```bash
git add -A
```
Use HEREDOC pattern from `_shared-commit-protocol.md`. Add the `🤖 Generated with [Claude Code]` line before the Co-Authored-By footer.

### Step 5: Push (unless --no-push)

```bash
git push -u origin <branch>
```

If rejected: `git fetch && git rebase origin/<branch>` then retry.

### Step 6: Report

```markdown
✅ Commit Complete
**Branch**: <branch> | **Commit**: <sha>
**Message**: <subject>
**Changes**: X files, +Y/-Z lines
**Status**: Pushed to origin/<branch>
```

---

## Safety Rules

**NEVER**:

- Commit `.env` files with secrets
- Force push to `main`/`master` without explicit request
- Use `--no-verify` to skip hooks
- Amend pushed commits without confirmation
- Skip TypeScript or lint errors
- Run tests as part of commit (tests belong in CI/CD)

**Sensitive patterns**: `.env*`, `*.pem`, `*.key`, `credentials.json`, `secrets.json`, `*_token*`, `*_secret*`

**Required tools**: `gitleaks`, `tsc`, `eslint` (install if missing)

---

## --amend Mode

1. Verify HEAD commit was created by Claude and NOT pushed
2. If already pushed: WARN and require explicit confirmation
3. Use `git push --force-with-lease` (safer than `--force`)

---

## Error Handling

| Error                  | Solution                                    |
| ---------------------- | ------------------------------------------- |
| Nothing to commit      | Check `git status`, files may be gitignored |
| Failed to push         | `git pull --rebase` then retry              |
| Pre-commit hook failed | Fix issues, retry (don't use `--no-verify`) |
| Detached HEAD          | `git checkout -b <branch>` first            |

---

## Examples

```bash
# Auto-generate message
/commit

# With message
/commit "fix(auth): resolve session timeout"

# No push
/commit --no-push

# Specific files
/commit "fix(types): update Scene" -- lib/types/scene.ts
```

---

## Version History

- **2026-02-23**: Added gitleaks, secret scanning, TypeScript/ESLint/Prettier checks; explicit no-tests policy
- **2026-01-22**: Condensed for context efficiency
- **2026-01-08**: Initial version
