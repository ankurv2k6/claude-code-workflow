#!/bin/bash
# release.sh — pin the installed workflow to a tag: a detached worktree plus two symlinks. bash 3.2.
set -u

usage() {
  cat <<'EOF'
release.sh — install a tagged workflow version (dry run unless --apply)

Usage:
  release.sh <tag> [--apply] [--repo <dir>] [--dest <dir>]

  <tag>          any commit-ish of this repo, normally v<VERSION> (e.g. v2.0.0)
  --apply        make the changes; without it, print what would change and change nothing
  --repo <dir>   the workflow repo (default: the repo this script is in)
  --dest <dir>   the release checkout (default: ~/.claude/workflow-release, $WORKFLOW_HOME's default)

What it does:
  1. creates a detached worktree of <repo> at <tag> in <dest>, or moves an existing one to <tag>
     (refused if <dest> has local changes, is not a linked worktree of <repo>, is a directory
     inside a checkout, or is on a branch: a release worktree is always detached);
  2. points ~/.claude/commands at <dest>/.claude/commands and ~/.claude/templates at
     <dest>/.claude/templates. An existing symlink is replaced; a real directory is never deleted:
     it is renamed to <name>.pre-release-<timestamp>.
Rollback is the same command with the previous tag (printed below as "currently").
It never pushes, fetches or deletes. The owner runs it at switch-over; lanes never do.

Exit: 0 done (or dry run printed) · 1 refused · 2 usage.
EOF
}

die() { echo "release.sh: $*" >&2; exit "${2:-1}"; }

TAG=; APPLY=; REPO=; DEST=
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --apply) APPLY=1; shift ;;
    --repo) [ $# -ge 2 ] || die "--repo needs a value" 2; REPO=$2; shift 2 ;;
    --repo=*) REPO=${1#*=}; shift ;;
    --dest) [ $# -ge 2 ] || die "--dest needs a value" 2; DEST=$2; shift 2 ;;
    --dest=*) DEST=${1#*=}; shift ;;
    -*) die "unknown flag $1 (see --help)" 2 ;;
    *) [ -z "$TAG" ] || die "unexpected argument $1" 2; TAG=$1; shift ;;
  esac
done
[ -n "$TAG" ] || { usage >&2; exit 2; }
[ -n "${HOME:-}" ] || die "HOME is not set" 2

if [ -z "$REPO" ]; then
  REPO=$(cd "$(dirname "$0")" && git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repo; pass --repo"
fi
REPO=$(cd "$REPO" 2>/dev/null && pwd) || die "no repo at $REPO"
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || die "$REPO is not a git repo"
CLAUDE_DIR="$HOME/.claude"
[ -n "$DEST" ] || DEST="$CLAUDE_DIR/workflow-release"

SHA=$(git -C "$REPO" rev-parse --verify --quiet "$TAG^{commit}") || die "$TAG is not a commit in $REPO"
git -C "$REPO" cat-file -e "$SHA:.claude/commands" 2>/dev/null || die "$TAG has no .claude/commands"
git -C "$REPO" cat-file -e "$SHA:.claude/templates" 2>/dev/null || die "$TAG has no .claude/templates"
VERSION_AT=$(git -C "$REPO" show "$SHA:VERSION" 2>/dev/null | head -1)
COMMON=$(cd "$REPO" && cd "$(git rev-parse --git-common-dir)" && pwd -P)

MODE=dry-run; [ -n "$APPLY" ] && MODE=apply
echo "release.sh ($MODE): $TAG = ${SHA%"${SHA#????????????}"}${VERSION_AT:+ (VERSION $VERSION_AT)}"
echo "  repo  $REPO"
echo "  dest  $DEST"

do_or_say() {
  if [ -n "$APPLY" ]; then
    echo "  run   $*"
    "$@" || die "failed: $*"
  else
    echo "  would $*"
  fi
}

# 1. the release worktree
if [ -e "$DEST" ] || [ -L "$DEST" ]; then
  [ -d "$DEST" ] || die "$DEST exists and is not a directory"
  DCOMMON=$(cd "$DEST" && d=$(git rev-parse --git-common-dir 2>/dev/null) && cd "$d" && pwd -P) || die "$DEST is not a git worktree; move it aside first"
  [ "$DCOMMON" = "$COMMON" ] || die "$DEST is a worktree of another repo ($DCOMMON)"
  # Only a linked, detached worktree is ours to move: never the repo's main working tree, a
  # directory inside a checkout, or a worktree someone works in on a branch.
  DTOP=$(cd "$(git -C "$DEST" rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null && pwd -P)
  [ "$DTOP" = "$(cd "$DEST" && pwd -P)" ] || die "$DEST is inside the checkout $DTOP, not a release worktree"
  DGIT=$(cd "$DEST" && cd "$(git rev-parse --git-dir)" && pwd -P)
  [ "$DGIT" != "$DCOMMON" ] || die "$DEST is the main working tree of $REPO, not a release worktree"
  if git -C "$DEST" symbolic-ref -q HEAD >/dev/null 2>&1; then
    die "$DEST is on branch $(git -C "$DEST" symbolic-ref --short HEAD); a release worktree is detached"
  fi
  [ -z "$(git -C "$DEST" status --porcelain 2>/dev/null)" ] || die "$DEST has local changes; commit or discard them first"
  CUR=$(git -C "$DEST" rev-parse HEAD)
  CUR_DESC=$(git -C "$DEST" describe --tags --exact-match HEAD 2>/dev/null || echo "${CUR%"${CUR#????????????}"}")
  echo "  currently $CUR_DESC (rollback: release.sh $CUR_DESC --apply)"
  if [ "$CUR" = "$SHA" ]; then
    echo "  keep  $DEST already at $TAG"
  else
    do_or_say git -C "$DEST" checkout --quiet --detach "$SHA"
  fi
else
  echo "  currently not installed"
  do_or_say mkdir -p "$(dirname "$DEST")"
  do_or_say git -C "$REPO" worktree add --quiet --detach "$DEST" "$SHA"
fi

# 2. the symlinks
STAMP=$(date '+%Y%m%d-%H%M%S')
link() {
  local name=$1 target="$DEST/.claude/$1" path="$CLAUDE_DIR/$1" now
  if [ -L "$path" ]; then
    now=$(readlink "$path")
    if [ "$now" = "$target" ]; then echo "  keep  $path -> $target"; return; fi
    echo "  link  $path: $now -> $target"
    do_or_say rm "$path"
  elif [ -e "$path" ]; then
    echo "  move  $path is not a symlink; it is kept as $path.pre-release-$STAMP"
    do_or_say mv "$path" "$path.pre-release-$STAMP"
  else
    echo "  link  $path (new) -> $target"
  fi
  do_or_say mkdir -p "$CLAUDE_DIR"
  do_or_say ln -s "$target" "$path"
}
link commands
link templates

if [ -n "$APPLY" ]; then
  for n in commands templates; do
    [ -d "$CLAUDE_DIR/$n/" ] || die "$CLAUDE_DIR/$n does not resolve after the switch"
  done
  echo "done: $CLAUDE_DIR/commands and templates now serve $TAG"
else
  echo "dry run: nothing changed (add --apply)"
fi
