import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, utimesSync, writeFileSync, readFileSync } from 'node:fs';
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

test('watchdog: a task list whose status is not in_progress exits 0 with "batch not running"', (t) => {
  const f = fixture(t);
  for (const status of ['completed', 'dry_run']) {
    const tl = write(join(f.d, 'context', `${status}.md`), taskList(f.rows).replace(/^status: in_progress$/m, `status: ${status}`));
    const r = run('watchdog.mjs', ['--task-list', tl, '--profile', f.profile, '--once']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, new RegExp(`batch not running \\(status: ${status}\\)`));
  }
  const noStatus = write(join(f.d, 'context', 'nostatus.md'), taskList(f.rows).replace(/^status: in_progress\n/m, ''));
  assert.equal(run('watchdog.mjs', ['--task-list', noStatus, '--profile', f.profile, '--once']).code, 3, 'no status line: read as running');
});

test('watchdog: a slot holder in <lock_dir>/<n>/pid (no slot- prefix) counts as active', (t) => {
  const f = fixture(t);
  const lock = join(f.d, 'locks', 'flows');
  mkdirSync(join(lock, '2'), { recursive: true });
  writeFileSync(join(lock, '2', 'pid'), `${process.pid}\n`);
  writeFileSync(join(lock, '2', 'cwd'), `${f.wtA}\n`);
  const tl = write(join(f.d, 'context', 'batch-progress.md'), taskList(f.rows.filter((r) => r.lane === 'A')));
  const r = run('watchdog.mjs', ['--task-list', tl, '--profile', f.profile, '--lock-dir', lock, '--once', '--json']);
  assert.equal(r.code, 4, r.out + r.err);
  assert.match(JSON.parse(r.out).lanes[0].reason, /holds slot flows\/2/);
});

test('watchdog: a task list with no Agents table exits 0 (nothing to watch), not a usage error', (t) => {
  const f = fixture(t);
  const tl = write(join(f.d, 'context', 'noagents.md'), '---\nset: x\nstatus: in_progress\n---\n\n# Batch progress — x\n\n## Module status\n');
  const r = run('watchdog.mjs', ['--task-list', tl, '--profile', f.profile, '--once']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /batch not running \(status: no Agents table\)/);
});

test('watchdog: a lane queued for a slot (slot.sh waiting marker) is active, not stalled', (t) => {
  const f = fixture(t);
  const lock = join(f.d, 'locks', 'rehearsal');
  mkdirSync(join(lock, 'waiting'), { recursive: true });
  writeFileSync(join(lock, 'waiting', String(process.pid)), `A\n${f.wtA}\n2026-11-25T10:00:00+0000\n`);
  writeFileSync(join(lock, 'waiting', '999999'), `A\n${f.wtA}\n`); // a dead waiter counts for nothing
  const tl = write(join(f.d, 'context', 'batch-progress.md'), taskList(f.rows.filter((r) => r.lane === 'A')));
  const r = run('watchdog.mjs', ['--task-list', tl, '--profile', f.profile, '--json', '--once', '--no-proc']);
  assert.equal(r.code, 4, r.out + r.err);
  const a = JSON.parse(r.out).lanes[0];
  assert.equal(a.stalled, false);
  assert.match(a.reason, /waits for slot rehearsal/);
});

test('watchdog: a self-locking job\'s own pid file and a slot\'s live child pid count as holders', (t) => {
  const f = fixture(t);
  const own = join(f.d, 'locks', 'own');
  mkdirSync(join(own, 'db-lock'), { recursive: true });
  writeFileSync(join(own, 'db-lock', 'pid'), `${process.pid}\n`);
  writeFileSync(join(own, 'db-lock', 'holder'), 'A\n');
  // slot.sh was killed -9 (pid dead) but its command (child) still runs: still held
  const lock = join(f.d, 'locks', 'rehearsal');
  mkdirSync(join(lock, 'slot-2'), { recursive: true });
  writeFileSync(join(lock, 'slot-2', 'pid'), '999999\n');
  writeFileSync(join(lock, 'slot-2', 'child'), `${process.pid}\n`);
  writeFileSync(join(lock, 'slot-2', 'holder'), 'B\n');
  const p = JSON.parse(readFileSync(f.profile, 'utf8'));
  p.heavy_jobs.own = { slots: 1, lock_dir: own, self_locking: true };
  write(f.profile, p);
  const rows = f.rows.filter((r) => r.lane === 'A').concat([{ lane: 'B', worktree: f.wtA + '-none', launched: stamp(hoursAgo(4)) }]);
  const tl = write(join(f.d, 'context', 'batch-progress.md'), taskList(rows.slice(0, 1)));
  const r = run('watchdog.mjs', ['--task-list', tl, '--profile', f.profile, '--json', '--once', '--no-proc']);
  const a = JSON.parse(r.out).lanes[0];
  assert.equal(a.stalled, false, r.out);
  assert.match(a.reason, /holds slot own\/db-lock/);
  // the child-held slot, matched by holder name
  const tlB = write(join(f.d, 'context', 'batch-progress.md'), taskList([{ lane: 'B', worktree: f.wtB, launched: stamp(hoursAgo(4)) }]));
  const b = JSON.parse(run('watchdog.mjs', ['--task-list', tlB, '--profile', f.profile, '--json', '--once', '--no-proc', '--stall-minutes', '1']).out).lanes[0];
  assert.match(b.reason, /holds slot rehearsal\/slot-2/);
});

test('watchdog: a live process whose cwd is inside the worktree keeps the lane active; --no-proc ignores it', async (t) => {
  const f = fixture(t);
  const { spawn } = await import('node:child_process');
  const child = spawn('sleep', ['30'], { cwd: f.wtA, stdio: 'ignore' });
  t.after(() => process.kill(child.pid));
  await new Promise((r) => setTimeout(r, 200));
  const tl = write(join(f.d, 'context', 'batch-progress.md'), taskList(f.rows.filter((r) => r.lane === 'A')));
  const r = run('watchdog.mjs', ['--task-list', tl, '--profile', f.profile, '--json', '--once']);
  const a = JSON.parse(r.out).lanes[0];
  assert.equal(a.stalled, false, r.out);
  assert.match(a.reason, new RegExp(`live process ${child.pid} runs in the worktree`));
  const off = run('watchdog.mjs', ['--task-list', tl, '--profile', f.profile, '--json', '--once', '--no-proc']);
  assert.equal(off.code, 3);
});

test('watchdog: an absolute logs_dir counts only the files that name the lane', (t) => {
  const f = fixture(t);
  const logs = join(f.d, 'shared-logs');
  write(join(logs, 'other-lane-test.log'), 'x\n');
  const p = JSON.parse(readFileSync(f.profile, 'utf8'));
  p.logs_dir = logs;
  write(f.profile, p);
  const tl = write(join(f.d, 'context', 'batch-progress.md'), taskList(f.rows.filter((r) => r.lane === 'A')));
  const args = ['--task-list', tl, '--profile', f.profile, '--json', '--once', '--no-proc'];
  assert.equal(run('watchdog.mjs', args).code, 3, 'another lane\'s log does not count');
  write(join(logs, 'a-lane-end.log'), 'running\n');
  const r = run('watchdog.mjs', args);
  assert.equal(r.code, 4, r.out);
  assert.equal(JSON.parse(r.out).lanes[0].stalled, false);
});
