import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, run, write, gitRepo, sh } from './helpers.mjs';
import { taskList } from './tasklist-fixture.mjs';
import { readTable, frontmatter } from '../lib/tasklist.mjs';

const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

function setup(t) {
  const d = tmp(t);
  const tl = write(join(d, 'batch-progress.md'), taskList());
  const ev = (...a) => {
    const r = run('orch-event.mjs', [a[0], '--task-list', tl, ...a.slice(1)]);
    assert.equal(r.code, 0, r.err);
    return r;
  };
  return { d, tl, ev, read: () => readFileSync(tl, 'utf8') };
}

test('orch-event: agent rows, relaunch, module status and lane status', (t) => {
  const { ev, read } = setup(t);
  ev('agent', '--lane', 'A', '--id', 'ag-1', '--worktree', '../wt/demo-a', '--branch', 'lane/demo-a (abc)', '--effort', 'high');
  ev('agent', '--lane', 'A', '--id', 'ag-2', '--relaunch-of', 'ag-1');
  ev('agent', '--lane', 'A', '--id', 'ag-2', '--last-commit', 'def456');
  let agents = readTable(read(), 'Agents').rows;
  assert.equal(agents.length, 2);
  assert.equal(agents[0].State, 'relaunched → ag-2');
  assert.equal(agents[1]['Agent id'], 'ag-2');
  assert.equal(agents[1].Worktree, '../wt/demo-a', 'copied from the old row');
  assert.equal(agents[1].Effort, 'high');
  assert.equal(agents[1].State, 'running');
  assert.equal(agents[1]['Last commit seen'], 'def456');
  assert.match(agents[1].Launched, STAMP);

  ev('module', '--module', 'M1', '--lane', 'A', '--status', 'running');
  ev('module', '--module', 'M1', '--status', 'merged', '--commits', '4');
  const mods = readTable(read(), 'Module status').rows;
  assert.equal(mods.length, 1);
  assert.equal(mods[0].Status, '✅ MERGED');
  assert.equal(mods[0].Lane, 'A');
  assert.equal(mods[0].Commits, '4');

  ev('lane', '--lane', 'C0', '--status', 'blocked:M1');
  const plan = readTable(read(), 'Execution plan').rows;
  assert.equal(plan.find((r) => r.Lane === 'C0').Status, '⛔ BLOCKED(M1)');
});

test('orch-event: decisions and owner corrections land in their logs, timed by the clock', (t) => {
  const { ev, read } = setup(t);
  ev('decision', '--module', 'M2', '--decision', 'keep the a | b split', '--rationale', 'smaller diff');
  ev('correction', '--text', 'run the full suite once per cut', '--applied-to', 'the lane briefs', '--beyond', 'yes');
  ev('checkpoint', '--event', 'merged lane A');
  const text = read();
  const dec = readTable(text, 'Decision log').rows;
  assert.equal(dec.length, 1);
  assert.match(dec[0].When, STAMP);
  assert.equal(dec[0].Decision, 'keep the a \\| b split', 'pipes are escaped');
  const cor = readTable(text, 'Owner corrections').rows;
  assert.equal(cor.length, 1);
  assert.equal(cor[0]["Correction (owner's words)"], 'run the full suite once per cut');
  assert.equal(cor[0]['What it changed'], 'the lane briefs');
  assert.equal(cor[0]['Applies beyond this batch?'], 'yes');
  const cp = readTable(text, 'Checkpoint log').rows;
  assert.equal(cp[0].Event, 'merged lane A', 'newest first');
  assert.equal(cp.length, 3);
  assert.equal(frontmatter(text).fields.workflow_version, '2.0.0', 'header kept');
  assert.equal(text.match(/^## Decision log/gm).length, 1, 'one decision log');
});

test('orch-event: an older task list without Owner corrections gets the section', (t) => {
  const d = tmp(t);
  const old = taskList().replace(/## Owner corrections[\s\S]*?(?=## Deferred findings)/, '');
  const tl = write(join(d, 'old.md'), old);
  assert.equal(run('orch-event.mjs', ['correction', '--task-list', tl, '--text', 'x']).code, 0);
  assert.equal(readTable(readFileSync(tl, 'utf8'), 'Owner corrections').rows.length, 1);
});

test('orch-event: --dry-run writes nothing; errors exit 1 or 2', (t) => {
  const { tl, read } = setup(t);
  const before = read();
  const r = run('orch-event.mjs', ['decision', '--task-list', tl, '--decision', 'x', '--dry-run']);
  assert.equal(r.code, 0);
  assert.match(r.out, /\| x \|/);
  assert.equal(read(), before);
  assert.equal(run('orch-event.mjs', ['lane', '--task-list', tl, '--lane', 'NOPE', '--status', 'merged']).code, 1);
  assert.equal(run('orch-event.mjs', ['agent', '--task-list', tl, '--lane', 'A']).code, 2, 'needs --id');
  assert.equal(run('orch-event.mjs', ['bogus', '--task-list', tl]).code, 2);
});

test('orch-event --commit commits the task list alone', (t) => {
  const d = tmp(t);
  const repo = gitRepo(join(d, 'repo'), { home: d });
  const tl = write(join(repo, 'context', 'batch-progress.md'), taskList());
  write(join(repo, 'other.txt'), 'untouched\n');
  sh(repo, 'git add . && git commit -qm "task list"', d);
  write(join(repo, 'other.txt'), 'changed\n');
  const r = run('orch-event.mjs', ['decision', '--task-list', tl, '--decision', 'ship it', '--commit'], { home: d });
  assert.equal(r.code, 0, r.err);
  assert.equal(sh(repo, 'git log -1 --format=%s', d), 'chore(batch): decision: ship it');
  assert.equal(sh(repo, 'git status --porcelain', d), 'M other.txt');
});
