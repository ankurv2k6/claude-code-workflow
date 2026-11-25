// The v2 shared profile contract: C1 agent gates, C2 self-locking heavy jobs, C3 merge, C4
// conventional gate names, C5 the full run is never a tier gate; notes inside the gate and job maps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, run, write, EXAMPLE_PROFILE } from './helpers.mjs';
import { checkProfile, semanticWarnings, smokeEntries } from '../lib/profile.mjs';
import { diffProfiles } from '../profile-diff.mjs';
import { planTier } from '../lib/tier.mjs';

const schema = () => JSON.parse(readFileSync(join(EXAMPLE_PROFILE, '..', 'workflow-profile.schema.json'), 'utf8'));
const base = () => ({
  version: 1,
  project: 'my-app',
  updated: '2026-11-25',
  commands: { test_full: 'pnpm test:full' },
  gates: { typecheck: { cmd: 'pnpm typecheck', kind: 'check' } },
  tiers: { merge: ['typecheck'] },
});
const errs = (p) => checkProfile(p, schema()).join('\n');

test('C1: an agent gate needs a verifier, may omit cmd, and is never smoke-run', (t) => {
  const p = base();
  p.gates.review = { kind: 'agent', verifier: 'code-reviewer', asks: 'Check the contracts; PASS or FAIL.' };
  p.gates.helper = { kind: 'agent', verifier: 'code-reviewer', cmd: 'git diff --name-only {base}', smoke: true };
  p.tiers.cut_end = ['review', 'helper'];
  assert.equal(errs(p), '');
  assert.deepEqual(smokeEntries(p, { includeCommands: false }), [], 'no agent gate in a smoke run');
  assert.match(semanticWarnings(p).join('\n'), /helper\.smoke: an agent gate is never smoke-run/);

  const bad = base();
  bad.gates.review = { kind: 'agent', asks: 'two\nlines' };
  bad.gates.plain = { kind: 'check' };
  bad.gates.mixed = { kind: 'check', cmd: 'true', verifier: 'x' };
  const e = errs(bad);
  assert.match(e, /review: an agent gate needs "verifier"/);
  assert.match(e, /review\.asks: one line only/);
  assert.match(e, /plain: missing required "cmd"/);
  assert.match(e, /mixed\.verifier: only an agent gate/);

  // profile-check --smoke lists it as skipped, never runs its helper
  const d = tmp(t);
  const f = write(join(d, '.claude', 'workflow-profile.json'), { ...p, commands: {} });
  const r = run('profile-check.mjs', ['--profile', f, '--smoke', '--only', 'gates.helper', '--base', 'x', '--json']);
  assert.equal(r.code, 0, r.out);
  const s = JSON.parse(r.out).smoke;
  assert.deepEqual(s.map((x) => [x.id, x.status]), [['gates.helper', 'skipped']]);
  assert.match(s[0].reason, /agent gate: launched by a skill \(verifier code-reviewer\)/);
});

test('C1: the tier runner lists an agent gate for the skill and runs only its helper', () => {
  const p = base();
  p.gates.review = { kind: 'agent', verifier: 'code-reviewer', asks: 'Check it.', cmd: 'echo {base}' };
  p.tiers.cut_end = ['typecheck', 'review'];
  const steps = planTier(p, 'cut_end', { base: 'abc' });
  assert.equal(steps[0].status, 'run');
  assert.deepEqual([steps[1].status, steps[1].verifier, steps[1].helper], ['agent', 'code-reviewer', 'echo abc']);
});

test('C2: heavy_jobs.<job>.self_locking is never wrapped in slot.sh; lock_dir is optional with a warning', () => {
  const p = base();
  p.heavy_jobs = { notes: 'jobs', solo: { slots: 1, lock_dir: '/tmp/x', self_locking: true }, shared: { slots: 2 } };
  p.gates.rehearse = { cmd: 'pnpm rehearse', kind: 'rehearsal', heavy: 'solo' };
  p.gates.e2e = { cmd: 'pnpm e2e', kind: 'test', heavy: 'shared' };
  p.tiers.cut_end = ['rehearse', 'e2e'];
  assert.equal(errs(p), '');
  assert.match(semanticWarnings(p).join('\n'), /heavy_jobs\.shared\.lock_dir: unset/);
  const [a, b] = planTier(p, 'cut_end', {});
  assert.deepEqual([a.cmd, a.wrapped, a.selfLocking], ['pnpm rehearse', false, true]);
  assert.equal(b.wrapped, true);
  assert.match(b.cmd, /slot\.sh'? shared 2 -- bash -c 'pnpm e2e'$/);
});

test('C3: merge.renumber and merge.check are schema keys with checked placeholders; a change is a command-change', () => {
  const p = base();
  p.merge = { renumber: 'node renumber.mjs --after {base}', check: 'node journal.mjs', notes: 'x' };
  assert.equal(errs(p), '');
  assert.match(errs({ ...p, merge: { renumber: 'x {nope}' } }), /\$\.merge\.renumber: unknown placeholder \{nope\}/);
  assert.match(errs({ ...p, merge: { renumber: "x '{base}'" } }), /\$\.merge\.renumber: placeholder \{base\} is inside quotes/);
  assert.match(errs({ ...p, merge: { other: 'x' } }), /\$\.merge\.other: unknown key/);
  const d = diffProfiles(base(), p);
  assert.deepEqual(d.changes.map((c) => [c.class, c.path]), [['command-change', 'merge.renumber'], ['command-change', 'merge.check']]);
});

test('C4: risk_routing without a reach-walk gate is a WARNING, not an error', (t) => {
  const d = tmp(t);
  const p = { ...base(), risk_routing: [{ paths: ['**/auth/**'], verifier: 'security-engineer' }] };
  const f = write(join(d, '.claude', 'workflow-profile.json'), p);
  const r = run('profile-check.mjs', ['--profile', f]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^valid$/m);
  assert.match(r.out, /WARNING: .*risk_routing is set but no "reach-walk" gate/);
  p.gates['reach-walk'] = { cmd: 'node walk.mjs', kind: 'check' };
  write(f, p);
  assert.doesNotMatch(run('profile-check.mjs', ['--profile', f]).out, /WARNING/);
});

test('C5: a tier gate whose cmd is commands.test_full is an error', () => {
  const p = base();
  p.gates.full = { cmd: ' pnpm test:full ', kind: 'test' };
  p.tiers.cut_end = ['full'];
  assert.match(errs(p), /\$\.tiers\.cut_end: gate "full" runs commands\.test_full/);
  p.tiers.cut_end = [];
  assert.equal(errs(p), '', 'registered but in no tier is fine');
});

test('notes strings are allowed in the gates and heavy_jobs maps and are not entries', () => {
  const p = base();
  p.gates.notes = 'about the gates';
  p.heavy_jobs = { notes: 'about the jobs' };
  assert.equal(errs(p), '');
  p.tiers.merge.push('notes');
  assert.match(errs(p), /names gate "notes", which is not in gates/);
});

test('profile-diff: a new agent gate, and a changed verifier or asks, are command-changes', () => {
  const a = base();
  a.gates.review = { kind: 'agent', verifier: 'code-reviewer', asks: 'one' };
  const b = structuredClone(a);
  b.gates.review.verifier = 'security-engineer';
  b.gates.review.asks = 'two';
  b.gates.review2 = { kind: 'agent', verifier: 'code-reviewer' };
  b.tiers.merge.push('review2');
  b.gates.typecheck.kind = 'agent';
  const d = diffProfiles(a, b);
  const cls = Object.fromEntries(d.changes.map((c) => [c.path, c.class]));
  assert.equal(cls['gates.review.verifier'], 'command-change');
  assert.equal(cls['gates.review.asks'], 'command-change');
  assert.equal(cls['gates.review2'], 'command-change');
  assert.equal(cls['gates.typecheck.kind'], 'command-change', 'a kind moving to agent changes what runs');
  assert.equal(d.changes.find((c) => c.path === 'tiers.merge').class, 'command-change');
  assert.equal(d.only_additions, false);
});

test('the example profile exercises the contract and is valid', () => {
  const p = JSON.parse(readFileSync(EXAMPLE_PROFILE, 'utf8'));
  assert.equal(errs(p), '');
  assert.ok(Object.values(p.gates).some((g) => g.kind === 'agent' && g.verifier));
  assert.ok(Object.values(p.heavy_jobs).some((j) => j.self_locking === true));
  assert.ok(p.merge.renumber.includes('{base}'));
  assert.ok(p.gates['reach-walk'] && p.gates['caller-list']);
  assert.deepEqual(semanticWarnings(p), []);
});
