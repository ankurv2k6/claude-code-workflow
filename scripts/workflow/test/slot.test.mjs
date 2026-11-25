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
  const start = Date.now();
  const a = runAsync('slot.sh', ['job', '2', '--lock-dir', lock, '--poll', '0.1', '--', 'sleep', '1']);
  const b = runAsync('slot.sh', ['job', '2', '--lock-dir', lock, '--poll', '0.1', '--', 'sleep', '1']);
  const [ra, rb] = await Promise.all([a.done, b.done]);
  assert.equal(ra.code + rb.code, 0);
  assert.ok(Date.now() - start < 1900, 'ran in parallel');
  assert.doesNotMatch(ra.err + rb.err, /waiting/);
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
