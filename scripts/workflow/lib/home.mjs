// Where the installed workflow lives ($WH), and its version. Node >= 18 built-ins only.
//
// WH is, in order:
//   1. $WORKFLOW_HOME, when set (a worktree, to test unreleased scripts);
//   2. ~/.claude/workflow-release, the pinned release, when it exists;
//   3. the repo root that ~/.claude/commands points into: realpath(~/.claude/commands) is
//      <root>/.claude/commands, so the root is two levels up (a v1 install, before any release).
// The same order, in shell (bash 3.2), is WH_SHELL below; _shared-project-profile.md quotes it.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export const WH_SHELL =
  'WH="${WORKFLOW_HOME:-}"; [ -n "$WH" ] || { [ -d "$HOME/.claude/workflow-release" ] && WH="$HOME/.claude/workflow-release"; } || WH="$(cd -P "$HOME/.claude/commands/../.." 2>/dev/null && pwd -P)"';

/** { path, source } of the workflow home, or { path: null } when none resolves. */
export function workflowHome({ env = process.env, home = env.HOME || homedir() } = {}) {
  if (env.WORKFLOW_HOME) return { path: env.WORKFLOW_HOME, source: 'WORKFLOW_HOME' };
  const rel = join(home, '.claude', 'workflow-release');
  if (existsSync(rel)) return { path: rel, source: 'release' };
  try {
    const cmds = realpathSync(join(home, '.claude', 'commands'));
    return { path: dirname(dirname(cmds)), source: 'commands-link' };
  } catch {
    return { path: null, source: 'none' };
  }
}

/** The workflow version at a home: its VERSION file, else "1.0.0" (a v1 install has none). */
export function workflowVersion(wh = workflowHome().path) {
  try {
    return readFileSync(join(wh, 'VERSION'), 'utf8').trim().split('\n')[0] || '1.0.0';
  } catch {
    return '1.0.0';
  }
}
