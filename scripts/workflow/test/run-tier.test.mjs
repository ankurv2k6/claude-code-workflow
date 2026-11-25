import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, run, write } from './helpers.mjs';

function profile(t, extra) {
  const d = tmp(t);
  const f = write(join(d, 'proj', '.claude', 'workflow-profile.json'), { version: 1, project: 'my-app', updated: '2026-11-25', shell_prefix: 'export TIER_PREFIX=1;', ...extra });
  return { d, f, root: join(d, 'proj') };
}

test('run-tier --parallel runs independent check gates at once', (t) => {
  const { d, f } = profile(t, {});
  // a barrier: each gate passes only if it sees the other running too
  const body = (me, other) => `touch ${d}/${me}; i=0; while [ $i -lt 100 ]; do [ -e ${d}/${other} ] && exit 0; sleep 0.05; i=$((i+1)); done; exit 9`;
  write(f, {
    version: 1,
    project: 'my-app',
    updated: '2026-11-25',
    gates: { a: { cmd: body('a', 'b'), kind: 'check' }, b: { cmd: body('b', 'a'), kind: 'check' } },
    tiers: { lane_end: ['a', 'b'] },
  });
  const r = run('run-tier.mjs', ['lane_end', '--profile', f, '--parallel']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /GREEN: a pass · b pass/);
});

test('run-tier: the first red stops the tier; the prefix applies; output goes to the logs', (t) => {
  const { f, root } = profile(t, {
    gates: {
      ok: { cmd: 'test "$TIER_PREFIX" = 1 && echo fine', kind: 'check' },
      bad: { cmd: 'echo broken; exit 3', kind: 'test' },
      later: { cmd: 'touch ../later', kind: 'check' },
    },
    tiers: { merge: ['ok', 'bad', 'later'] },
  });
  const r = run('run-tier.mjs', ['merge', '--profile', f, '--json']);
  assert.equal(r.code, 1);
  const s = Object.fromEntries(JSON.parse(r.out).steps.map((x) => [x.name, x]));
  assert.equal(s.ok.status, 'pass');
  assert.equal(s.bad.status, 'fail');
  assert.equal(s.bad.exit, 3);
  assert.equal(s.later.status, 'not-run');
  assert.equal(readFileSync(join(root, 'logs', 'tier-merge-bad.log'), 'utf8'), 'broken\n');
  assert.ok(!existsSync(join(root, '..', 'later')));
});

test('run-tier: a heavy gate takes a slot unless its job is self-locking; an agent gate is listed with its helper output', (t) => {
  const { d, f, root } = profile(t, {});
  const shared = join(d, 'locks', 'shared');
  const own = join(d, 'locks', 'own');
  write(f, {
    version: 1,
    project: 'my-app',
    updated: '2026-11-25',
    heavy_jobs: { shared: { slots: 1, lock_dir: shared }, own: { slots: 1, lock_dir: own, self_locking: true } },
    gates: {
      wrapped: { cmd: `test -f ${shared}/slot-1/pid && test -f ${shared}/slot-1/child`, kind: 'test', heavy: 'shared' },
      self: { cmd: `test ! -e ${own}/slot-1`, kind: 'rehearsal', heavy: 'own' },
      review: { kind: 'agent', verifier: 'code-reviewer', asks: 'Review it.', cmd: 'echo changed-files {base}' },
    },
    tiers: { cut_end: ['wrapped', 'self', 'review'] },
  });
  const r = run('run-tier.mjs', ['cut_end', '--profile', f, '--base', 'abc']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /\[pass\] wrapped .*\[slot\]/);
  assert.match(r.out, /\[pass\] self .*\[self-locking\]/);
  assert.match(r.out, /\[agent\] review → launch code-reviewer: Review it\. \(helper output .*tier-cut_end-review-helper\.log\)/);
  assert.match(r.out, /1 agent gate\(s\) to launch/);
  assert.match(r.out, /AGENT GATES PENDING/);
  assert.equal(readFileSync(join(root, 'logs', 'tier-cut_end-review-helper.log'), 'utf8'), 'changed-files abc\n');
  assert.ok(!existsSync(join(shared, 'slot-1')), 'slot released');
});

test('run-tier: an unfilled placeholder is not run and is red; an unknown tier is usage', (t) => {
  const { f } = profile(t, { gates: { g: { cmd: 'echo {files}', kind: 'check' } }, tiers: { lane_end: ['g'] } });
  const r = run('run-tier.mjs', ['lane_end', '--profile', f]);
  assert.equal(r.code, 1);
  assert.match(r.out, /\[unfilled\] g .*needs \{files\}/);
  assert.equal(run('run-tier.mjs', ['lane_end', '--profile', f, '--files', 'a b.ts', '--print']).code, 0);
  assert.equal(run('run-tier.mjs', ['nope', '--profile', f]).code, 2);
});
