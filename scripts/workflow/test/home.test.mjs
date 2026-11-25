import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmp, write, env } from './helpers.mjs';
import { workflowHome, workflowVersion, WH_SHELL } from '../lib/home.mjs';

/** A HOME whose ~/.claude/commands links into a checkout <d>/repo with a VERSION. */
function fixture(t) {
  const d = realpathSync(tmp(t));
  const home = join(d, 'home');
  const repo = join(d, 'repo');
  write(join(repo, '.claude', 'commands', 'plan.md'), 'x\n');
  write(join(repo, 'VERSION'), '1.4.0\n');
  mkdirSync(join(home, '.claude'), { recursive: true });
  symlinkSync(join(repo, '.claude', 'commands'), join(home, '.claude', 'commands'));
  return { d, home, repo };
}

const shellWH = (home, extra = {}) => spawnSync('bash', ['-c', `${WH_SHELL}; printf %s "$WH"`], { env: env(home, extra), encoding: 'utf8' }).stdout;

test('$WH: WORKFLOW_HOME, else the release checkout, else the repo ~/.claude/commands points into', (t) => {
  const { d, home, repo } = fixture(t);
  // 3. no release yet: the repo behind the commands link; workflow_version is its VERSION
  assert.deepEqual(workflowHome({ env: {}, home }), { path: repo, source: 'commands-link' });
  assert.equal(workflowVersion(repo), '1.4.0');
  assert.equal(shellWH(home), repo, 'the shell definition agrees');
  // 2. a release checkout wins
  const rel = join(home, '.claude', 'workflow-release');
  write(join(rel, 'VERSION'), '2.0.0\n');
  assert.equal(workflowHome({ env: {}, home }).path, rel);
  assert.equal(shellWH(home), rel);
  // 1. WORKFLOW_HOME wins over both
  assert.equal(workflowHome({ env: { WORKFLOW_HOME: join(d, 'wt') }, home }).path, join(d, 'wt'));
  assert.equal(shellWH(home, { WORKFLOW_HOME: join(d, 'wt') }), join(d, 'wt'));
  // nothing at all: no home, version 1.0.0
  const bare = join(d, 'bare');
  mkdirSync(bare);
  assert.deepEqual(workflowHome({ env: {}, home: bare }), { path: null, source: 'none' });
  assert.equal(workflowVersion(join(bare, 'none')), '1.0.0');
});

test('profile-check finds the schema through $WH when run from a copy without templates', async (t) => {
  const { d, home } = fixture(t);
  const { cpSync } = await import('node:fs');
  const { REPO_ROOT, EXAMPLE_PROFILE } = await import('./helpers.mjs');
  const copy = join(d, 'scripts-only');
  cpSync(join(REPO_ROOT, 'scripts', 'workflow'), join(copy, 'scripts', 'workflow'), { recursive: true, filter: (p) => !p.includes('/test') });
  write(join(d, 'repo', '.claude', 'templates', 'workflow-profile.schema.json'), JSON.parse((await import('node:fs')).readFileSync(join(REPO_ROOT, '.claude', 'templates', 'workflow-profile.schema.json'), 'utf8')));
  const r = spawnSync(process.execPath, [join(copy, 'scripts', 'workflow', 'profile-check.mjs'), '--profile', EXAMPLE_PROFILE], { env: env(home), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`schema  ${join(d, 'repo')}`));
});
