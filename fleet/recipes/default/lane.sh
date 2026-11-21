#!/usr/bin/env bash
# The default fleet recipe, for a repo without its own .fleet/lane.sh: the lane gets its worktree and nothing more.
#   research  makes context/research/, the one place a research lane may write.
#   build     no install: the session installs what it needs. A repo that needs more before the session starts
#             (dependencies, a database, containers) adds its own .fleet/lane.sh with the same up|down contract.
set -euo pipefail

profile="${FLEET_PROFILE:-build}"
case "${1:-}" in
  up)
    if [ "$profile" = research ]; then mkdir -p context/research; fi
    echo "default recipe ($profile): the worktree only, no install"
    # Lane settings only, never secrets: fleet copies these lines into the session's prompt.
    printf 'FLEET_PROFILE=%s\n' "$profile" >"$FLEET_LANE_DIR/env"
    ;;
  down) ;;
  *)
    echo "usage: lane.sh up | down" >&2
    exit 64
    ;;
esac
