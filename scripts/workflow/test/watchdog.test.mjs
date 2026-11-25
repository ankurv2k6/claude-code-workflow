import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, run, write, gitRepo, sh } from './helpers.mjs';
import { taskList } from './tasklist-fixture.mjs';

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3);
const stamp = (d) => d.toISOString().replace('T', ' ').slice(0, 16);

/** stalled lane A, active lane B, slot-holding lane C (all old signals), finished lane D. */
function fixture(t) {
  const d = tmp(t);
  const old = hoursAgo(3).toISOString();
  const wtA = gitRepo(join(d, 'wt-a'), { dateIso: old });
  const wtB = gitRepo(join(d, 'wt-b'), { dateIso: old });
  const wtC = gitRepo(join(d, 'wt-c'), { dateIso: old });
  const wtD = gitRepo(join(d, 'wt-d'), { dateIso: old });
  for (const wt of [wtA, wtB, wtC]) {
    const p = write(join(wt, '.lane', 'progress.md'), 'T1 done\n');
    utimesSync(p, hoursAgo(3), hoursAgo(3));
    utimesSync(join(wt, '.lane'), hoursAgo(3), hoursAgo(3));
    utimesSync(join(wt, '.git'), hoursAgo(3), hoursAgo(3));
  }
  // B: a fresh commit
  sh(wtB, 'echo y >> README.md && git commit -qam T2', wtB);
  // C: holds a heavy-job slot, recorded by slot.sh's convention, held by this (live) process
  const lock = join(d, 'locks', 'rehearsal');
  mkdirSync(join(lock, 'slot-1'), { recursive: true });
  writeFileSync(join(lock, 'slot-1', 'pid'), `${process.pid}\n`);
  writeFileSync(join(lock, 'slot-1', 'cwd'), `${join(wtC, 'packages', 'x')}\n`);
  const profile = write(join(d, '.claude', 'workflow-profile.json'), {
    version: 1,
    project: 'my-app',
    updated: '2026-11-25',
    heavy_jobs: { rehearsal: { slots: 1, lock_dir: lock } },
    logs_dir: 'logs',
    limits: { stall_minutes: 45 },
  });
  const rows = [
    { lane: 'A', worktree: wtA, launched: stamp(hoursAgo(4)) },
    { lane: 'B', worktree: wtB, launched: stamp(hoursAgo(4)) },
    { lane: 'C', worktree: wtC, launched: stamp(hoursAgo(4)) },
    { lane: 'D', worktree: wtD, state: 'finished' },
  ];
  return { d, wtA, wtB, wtC, profile, rows };
}

test('watchdog: a stalled lane exits 3 with a report; an active and a slot-holding lane are not stalled', (t) => {
  const f = fixture(t);
  const tl = write(join(f.d, 'context', 'batch-progress.md'), taskList(f.rows));
  const r = run('watchdog.mjs', ['--task-list', tl, '--profile', f.profile, '--json', '--once']);
  assert.equal(r.code, 3, r.out + r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.running, 3, 'finished rows are ignored');
  const by = Object.fromEntries(j.lanes.map((l) => [l.lane, l]));
  assert.equal(by.A.stalled, true);
  assert.equal(by.B.stalled, false);
  assert.equal(by.C.stalled, false);
  assert.match(by.C.reason, /holds slot rehearsal\/slot-1/);
  const text = run('watchdog.mjs', ['--task-list', tl, '--profile', f.profile, '--once']);
  assert.match(text.out, /STALLED A/);
  assert.match(text.out, /SendMessage/);
});

test('watchdog: log growth and progress notes count as activity; --once exits 4 when all are healthy', (t) => {
  const f = fixture(t);
  write(join(f.wtA, 'logs', 'test-run.log'), 'still going\n');
  const tl = write(join(f.d, 'context', 'batch-progress.md'), taskList(f.rows));
  const r = run('watchdog.mjs', ['--task-list', tl, '--profile', f.profile, '--once', '--json']);
  assert.equal(r.code, 4, r.out);
  assert.equal(JSON.parse(r.out).stalled, 0);
});

test('watchdog: the stall threshold comes from the flag before the task list', (t) => {
  const f = fixture(t);
  const tl = write(join(f.d, 'context', 'batch-progress.md'), taskList(f.rows.filter((r) => r.lane === 'A'), { stall: 45 }));
  assert.equal(run('watchdog.mjs', ['--task-list', tl, '--profile', f.profile, '--once']).code, 3);
  assert.equal(run('watchdog.mjs', ['--task-list', tl, '--profile', f.profile, '--once', '--stall-minutes', '600']).code, 4);
});

test('watchdog: exits 0 when no lane is running, and the loop exits 3 on a stall', (t) => {
  const f = fixture(t);
  const none = write(join(f.d, 'context', 'none.md'), taskList([{ lane: 'D', worktree: f.wtA, state: 'finished' }]));
  const r = run('watchdog.mjs', ['--task-list', none, '--profile', f.profile]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 running/);
  const tl = write(join(f.d, 'context', 'batch-progress.md'), taskList(f.rows));
  assert.equal(run('watchdog.mjs', ['--task-list', tl, '--profile', f.profile, '--interval', '0.1']).code, 3);
});

test('watchdog: a running row whose worktree is gone is reported stalled', (t) => {
  const f = fixture(t);
  const tl = write(join(f.d, 'context', 'batch-progress.md'), taskList([{ lane: 'Z', worktree: join(f.d, 'gone') }]));
  const r = run('watchdog.mjs', ['--task-list', tl, '--profile', f.profile, '--once']);
  assert.equal(r.code, 3);
  assert.match(r.out, /worktree missing/);
});
