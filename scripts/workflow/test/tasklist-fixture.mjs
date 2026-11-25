// A synthetic task list in the templates/batch-progress.md format, with given Agents rows.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

export const TEMPLATE = readFileSync(join(REPO_ROOT, '.claude', 'templates', 'batch-progress.md'), 'utf8');

export function taskList(rows = [], { stall } = {}) {
  let t = TEMPLATE.replace('set: <set name, e.g. ss>', 'set: demo').replace('workflow_version: <$WORKFLOW_HOME/VERSION at Phase 0, e.g. 2.0.0; never changed mid-batch>', 'workflow_version: 2.0.0');
  if (stall) t = t.replace(/^stall_minutes: .*$/m, `stall_minutes: ${stall}`);
  const header = '| Lane | Role | Agent id | Worktree | Branch (base sha) | Test DBs | Brief | Effort | Launched | Last commit seen | State |\n|---|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) => `| ${r.lane} | lane | ${r.id || 'agent-' + r.lane} | \`${r.worktree}\` | lane/demo-${r.lane} (abc123) | — | brief.md | high | ${r.launched || ''} | | ${r.state || 'running'} |`).join('\n');
  return t.replace(header, body ? `${header}\n${body}` : header);
}
