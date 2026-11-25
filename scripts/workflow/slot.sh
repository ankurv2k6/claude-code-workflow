#!/bin/bash
# slot.sh — run a command while holding one of N slots of a heavy job. bash 3.2, mkdir locks.
set -u

usage() {
  cat <<'EOF'
slot.sh — run a command while holding one of N slots for a heavy job

Usage:
  slot.sh <job> <slots> [--lock-dir <dir>] [--timeout <s>] [--poll <s>] [--holder <name>] -- <cmd> [args…]
  slot.sh --list <job> [--lock-dir <dir>]

A slot is a directory <lock-dir>/slot-<i> made with mkdir (atomic on every filesystem; macOS has
no flock) that holds a "pid" file, plus "holder", "cwd", "started" and "cmd" for the watchdog.
This matches the existing convention of a slot-<i> directory with a pid file, so older scripts
that use the same lock dir share the slots.

  <job>            name of the heavy job, [A-Za-z0-9._-]+
  <slots>          how many may run at once (>= 1)
  --lock-dir <d>   default: ${TMPDIR:-/tmp}/workflow-slots/<job>
  --timeout <s>    give up waiting after s seconds (exit 75); 0 waits forever; default 7200
  --poll <s>       seconds between attempts while waiting, default 5 (fractions allowed)
  --holder <name>  recorded in the slot (default: $WORKFLOW_LANE, else the current directory)
  --list           print the slots and their holders, run nothing

A slot whose pid is dead is stale: it is reclaimed under a per-slot reclaim lock, so two waiters
never both reclaim it. The slot is released when the command ends, including on INT/TERM, which
are forwarded to the command by pid.

Exit: the command's exit code · 75 timed out waiting · 2 usage.
EOF
}

die() { echo "slot.sh: $*" >&2; exit 2; }

JOB=; SLOTS=; LOCK_DIR=; TIMEOUT=7200; POLL=5; HOLDER="${WORKFLOW_LANE:-$PWD}"; LIST=
POSITIONAL=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --lock-dir) [ $# -ge 2 ] || die "--lock-dir needs a value"; LOCK_DIR=$2; shift 2 ;;
    --lock-dir=*) LOCK_DIR=${1#*=}; shift ;;
    --timeout) [ $# -ge 2 ] || die "--timeout needs a value"; TIMEOUT=$2; shift 2 ;;
    --timeout=*) TIMEOUT=${1#*=}; shift ;;
    --poll) [ $# -ge 2 ] || die "--poll needs a value"; POLL=$2; shift 2 ;;
    --poll=*) POLL=${1#*=}; shift ;;
    --holder) [ $# -ge 2 ] || die "--holder needs a value"; HOLDER=$2; shift 2 ;;
    --holder=*) HOLDER=${1#*=}; shift ;;
    --list) LIST=1; shift ;;
    --) shift; break ;;
    -*) die "unknown flag $1 (see --help)" ;;
    *)
      if [ $POSITIONAL -eq 0 ]; then JOB=$1
      elif [ $POSITIONAL -eq 1 ]; then SLOTS=$1
      else die "unexpected argument $1 (put the command after --)"
      fi
      POSITIONAL=$((POSITIONAL + 1)); shift ;;
  esac
done

[ -n "$JOB" ] || { usage >&2; exit 2; }
case "$JOB" in *[!A-Za-z0-9._-]*) die "job name must match [A-Za-z0-9._-]+" ;; esac
if [ -z "$LOCK_DIR" ]; then
  T=${TMPDIR:-/tmp}
  LOCK_DIR="${T%/}/workflow-slots/$JOB"
fi

# kill -0 fails for another user's live process too (EPERM), so fall back to ps by pid.
alive() { [ -n "$1" ] || return 1; kill -0 "$1" 2>/dev/null || ps -p "$1" >/dev/null 2>&1; }

if [ -n "$LIST" ]; then
  [ -d "$LOCK_DIR" ] || { echo "no slots ($LOCK_DIR)"; exit 0; }
  found=
  for d in "$LOCK_DIR"/slot-*; do
    [ -d "$d" ] || continue
    case "$d" in *.reclaim) continue ;; esac
    found=1
    pid=$(cat "$d/pid" 2>/dev/null)
    state=dead; alive "$pid" && state=alive
    echo "$(basename "$d") pid=${pid:-?} $state holder=$(cat "$d/holder" 2>/dev/null) started=$(cat "$d/started" 2>/dev/null)"
  done
  [ -n "$found" ] || echo "no slots held ($LOCK_DIR)"
  exit 0
fi

case "$SLOTS" in ''|*[!0-9]*) die "<slots> must be a positive integer" ;; esac
[ "$SLOTS" -ge 1 ] || die "<slots> must be >= 1"
case "$TIMEOUT" in ''|*[!0-9]*) die "--timeout must be whole seconds" ;; esac
[ $# -gt 0 ] || die "no command (put it after --)"

mkdir -p "$LOCK_DIR" || die "cannot create $LOCK_DIR"

SLOT=

# Reclaim slot dir $1 if its pid is dead. A per-slot reclaim lock keeps two waiters from both
# reclaiming (the second would otherwise delete the slot the first has just re-taken).
reclaim() {
  local d=$1 r="$1.reclaim" pid rpid
  if ! mkdir "$r" 2>/dev/null; then
    rpid=$(cat "$r/pid" 2>/dev/null)
    # A reclaim lock whose owner died mid-reclaim (a window of milliseconds) is cleared.
    if [ -n "$rpid" ] && ! alive "$rpid"; then rm -rf "$r"; fi
    return 1
  fi
  echo $$ >"$r/pid"
  pid=$(cat "$d/pid" 2>/dev/null)
  if [ -n "$pid" ] && ! alive "$pid"; then
    echo "slot.sh: reclaiming stale $(basename "$d") of $JOB (pid $pid is dead)" >&2
    rm -rf "$d"
  fi
  rm -rf "$r"
}

try_take() {
  local i=1 d pid
  while [ $i -le "$SLOTS" ]; do
    d="$LOCK_DIR/slot-$i"
    if mkdir "$d" 2>/dev/null; then
      echo $$ >"$d/pid"
      printf '%s\n' "$HOLDER" >"$d/holder"
      printf '%s\n' "$PWD" >"$d/cwd"
      date '+%Y-%m-%dT%H:%M:%S%z' >"$d/started"
      printf '%s\n' "$*" >"$d/cmd"
      SLOT=$d
      return 0
    fi
    pid=$(cat "$d/pid" 2>/dev/null)
    if [ -n "$pid" ] && ! alive "$pid"; then
      reclaim "$d"
      continue   # retry this index at once
    fi
    i=$((i + 1))
  done
  return 1
}

START=$(date +%s)
WAITED=
while ! try_take "$@"; do
  if [ "$TIMEOUT" -gt 0 ] && [ $(( $(date +%s) - START )) -ge "$TIMEOUT" ]; then
    echo "slot.sh: timed out after ${TIMEOUT}s waiting for a $JOB slot ($LOCK_DIR)" >&2
    exit 75
  fi
  if [ -z "$WAITED" ]; then
    echo "slot.sh: all $SLOTS $JOB slot(s) busy; waiting ($LOCK_DIR)" >&2
    WAITED=1
  fi
  sleep "$POLL"
done

release() {
  if [ -n "$SLOT" ] && [ "$(cat "$SLOT/pid" 2>/dev/null)" = "$$" ]; then rm -rf "$SLOT"; fi
  SLOT=
}
trap release EXIT

echo "slot.sh: holding $(basename "$SLOT") of $JOB" >&2
"$@" <&0 &
CHILD=$!
forward() { kill -"$1" "$CHILD" 2>/dev/null; }
trap 'forward TERM' TERM
trap 'forward INT' INT
trap 'forward HUP' HUP
# wait returns early (> 128) when a trapped signal arrives; keep waiting until the child is gone.
while :; do
  wait "$CHILD"
  RC=$?
  kill -0 "$CHILD" 2>/dev/null || break
done
exit $RC
