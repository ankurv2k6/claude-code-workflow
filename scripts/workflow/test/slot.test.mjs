import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, run, runAsync } from './helpers.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('two callers on a 1-slot job: the second waits for the first', async (t) => {
  const d = tmp(t);
  const lock = join(d, 'locks');
  const log = join(d, 'order.log');
  const a = runAsync('slot.sh', ['job', '1', '--lock-dir', lock, '--poll', '0.1', '--', '/bin/bash', '-c', `echo a-start >> ${log}; sleep 1; echo a-end >> ${log}`]);
  // wait until A holds the slot
  for (let i = 0; i < 50 && !existsSync(join(lock, 'slot-1', 'pid')); i++) await sleep(50);
  assert.ok(existsSync(join(lock, 'slot-1', 'pid')), 'A took slot-1');
  const b = runAsync('slot.sh', ['job', '1', '--lock-dir', lock, '--poll', '0.1', '--', '/bin/bash', '-c', `echo b-start >> ${log}`]);
  const [ra, rb] = await Promise.all([a.done, b.done]);
  assert.equal(ra.code, 0);
  assert.equal(rb.code, 0);
  assert.match(rb.err, /busy; waiting/);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['a-start', 'a-end', 'b-start']);
  assert.ok(!existsSync(join(lock, 'slot-1')), 'slot released');
});

test('two slots let two callers run at once', async (t) => {
  const d = tmp(t);
  const lock = join(d, 'locks');
  // A barrier, not a stopwatch: each caller exits 0 only if it sees both inside their slots at
  // once, so the test cannot fail on a slow machine and cannot pass on serial execution.
  const body = (me) => `touch ${d}/${me}; i=0; while [ $i -lt 100 ]; do [ -e ${d}/a ] && [ -e ${d}/b ] && exit 0; sleep 0.1; i=$((i+1)); done; exit 9`;
  const a = runAsync('slot.sh', ['job', '2', '--lock-dir', lock, '--poll', '0.1', '--timeout', '5', '--', '/bin/bash', '-c', body('a')]);
  const b = runAsync('slot.sh', ['job', '2', '--lock-dir', lock, '--poll', '0.1', '--timeout', '5', '--', '/bin/bash', '-c', body('b')]);
  const [ra, rb] = await Promise.all([a.done, b.done]);
  assert.equal(ra.code, 0, ra.err);
  assert.equal(rb.code, 0, rb.err);
  assert.doesNotMatch(ra.err + rb.err, /waiting/);
});

test('three callers on two slots: never more than two at once, all finish', async (t) => {
  const d = tmp(t);
  const lock = join(d, 'locks');
  const log = join(d, 'log');
  const body = `echo s >> ${log}; sleep 0.5; echo e >> ${log}`;
  const runs = [1, 2, 3].map(() => runAsync('slot.sh', ['job', '2', '--lock-dir', lock, '--poll', '0.05', '--timeout', '30', '--', '/bin/bash', '-c', body]));
  const rs = await Promise.all(runs.map((r) => r.done));
  assert.deepEqual(rs.map((r) => r.code), [0, 0, 0]);
  let c = 0;
  let max = 0;
  for (const l of readFileSync(log, 'utf8').trim().split('\n')) max = Math.max(max, (c += l === 's' ? 1 : -1));
  assert.equal(max, 2);
  assert.match(rs.map((r) => r.err).join(''), /busy; waiting/);
});

test('a stale lock whose pid is dead is reclaimed', (t) => {
  const d = tmp(t);
  const lock = join(d, 'locks');
  mkdirSync(join(lock, 'slot-1'), { recursive: true });
  writeFileSync(join(lock, 'slot-1', 'pid'), '999999\n'); // the convention: slot-<i>/pid
  const r = run('slot.sh', ['job', '1', '--lock-dir', lock, '--poll', '0.1', '--timeout', '5', '--', 'echo', 'ran']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /ran/);
  assert.match(r.err, /reclaiming stale slot-1/);
});

test('a live holder is never reclaimed; the waiter times out with 75', (t) => {
  const d = tmp(t);
  const lock = join(d, 'locks');
  mkdirSync(join(lock, 'slot-1'), { recursive: true });
  writeFileSync(join(lock, 'slot-1', 'pid'), `${process.pid}\n`);
  const r = run('slot.sh', ['job', '1', '--lock-dir', lock, '--poll', '0.2', '--timeout', '1', '--', 'echo', 'ran']);
  assert.equal(r.code, 75);
  assert.doesNotMatch(r.out, /ran/);
  assert.equal(readFileSync(join(lock, 'slot-1', 'pid'), 'utf8').trim(), String(process.pid));
});

test('the command exit code passes through, the slot records its holder and is released', (t) => {
  const d = tmp(t);
  const lock = join(d, 'locks');
  const r = run('slot.sh', ['job', '1', '--lock-dir', lock, '--holder', 'lane-a', '--', '/bin/bash', '-c', `cat ${lock}/slot-1/holder; exit 7`]);
  assert.equal(r.code, 7);
  assert.match(r.out, /lane-a/);
  assert.ok(!existsSync(join(lock, 'slot-1')));
  const l = run('slot.sh', ['--list', 'job', '--lock-dir', lock]);
  assert.match(l.out, /no slots held/);
});

test('usage errors exit 2', () => {
  assert.equal(run('slot.sh', ['job', '0', '--', 'true']).code, 2);
  assert.equal(run('slot.sh', ['bad/job', '1', '--', 'true']).code, 2);
  assert.equal(run('slot.sh', ['job', '1']).code, 2);
});
