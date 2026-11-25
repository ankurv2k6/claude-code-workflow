import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, run, write, gitRepo, sh } from './helpers.mjs';

/** A repo on branch int with a profile, and a lane branch feat/x-a off it with one commit. */
function fixture(t, { profile = {}, laneFile = 'a.txt' } = {}) {
  const d = tmp(t);
  const repo = gitRepo(join(d, 'my-app'), { home: d });
  write(join(repo, '.claude', 'workflow-profile.json'), {
    version: 1,
    project: 'my-app',
    updated: '2026-11-25',
    shell_prefix: 'export MERGE_PREFIX=1;',
    logs_dir: 'logs',
    gates: {
      quick: { cmd: 'test "$MERGE_PREFIX" = 1 && printf %s {name} > ../quick.txt', kind: 'check' },
      review: { kind: 'agent', verifier: 'code-reviewer', asks: 'Check the merge.' },
    },
    tiers: { merge: ['quick', 'review'] },
    merge: { renumber: 'echo {base} >> ../renumber.log', check: 'test -f README.md && echo ok >> ../check.log' },
    ...profile,
  });
  write(join(repo, '.gitignore'), 'logs/\n');
  sh(repo, 'git add . && git commit -qm profile && git checkout -qb int', d);
  sh(repo, `git checkout -qb feat/x-a && echo lane > ${laneFile} && git add . && git commit -qm lane && git checkout -q int`, d);
  const head = (ref = 'HEAD') => sh(repo, `git rev-parse ${ref}`, d);
  return { d, repo, head };
}

const ml = (f, ...a) => run('merge-lane.mjs', ['--repo', f.repo, '--lane', 'feat/x-a', ...a], { home: f.d });

test('merge-lane: the dry run is the default, prints at most 10 lines and changes nothing', (t) => {
  const f = fixture(t);
  const before = f.head();
  const r = ml(f, '--name', 'int db');
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(r.out.trim().split('\n').length <= 10, r.out);
  assert.match(r.out, /merge-lane \(dry run\): feat\/x-a .* -> int/);
  assert.match(r.out, /renumber: echo [0-9a-f]{40} >> \.\.\/renumber\.log/);
  assert.match(r.out, /tiers\.merge: quick would-run · review agent/);
  assert.match(r.out, /RESULT: dry run: nothing changed/);
  assert.equal(f.head(), before);
  assert.ok(!existsSync(join(f.d, 'renumber.log')));
});

test('merge-lane --apply: --no-ff merge, renumber with {base}, check, tiers.merge with the prefix and quoted values', (t) => {
  const f = fixture(t);
  const before = f.head();
  const r = ml(f, '--apply', '--name', 'int db; touch ../pwned');
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(r.out.trim().split('\n').length <= 10, r.out);
  assert.equal(sh(f.repo, 'git rev-list --parents -n1 HEAD', f.d).split(' ').length, 3, 'a merge commit with two parents');
  assert.equal(readFileSync(join(f.d, 'renumber.log'), 'utf8').trim(), before, '{base} is the integration head before the merge');
  assert.equal(readFileSync(join(f.d, 'check.log'), 'utf8'), 'ok\n');
  assert.equal(readFileSync(join(f.d, 'quick.txt'), 'utf8'), 'int db; touch ../pwned', 'one quoted word');
  assert.ok(!existsSync(join(f.d, 'pwned')));
  assert.match(r.out, /tiers\.merge: quick pass · review agent/);
  assert.match(r.out, /agent gates to launch: review \(code-reviewer\)/);
  assert.match(r.out, /RESULT: GREEN: merged at/);
  assert.match(ml(f, '--apply').out, /already merged/);
});

test('merge-lane: tiers.merge is skipped only when the verifier was green on a lane head that contains the integration head', (t) => {
  const f = fixture(t);
  // the verifier merged int into the lane and recorded green on that head
  sh(f.repo, 'git checkout -q feat/x-a && git merge -q --no-edit int && git checkout -q int', f.d);
  const verified = f.head('feat/x-a');
  const r = ml(f, '--apply', '--verified-head', verified);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /tiers\.merge: skipped \(verifier green on/);
  assert.ok(!existsSync(join(f.d, 'quick.txt')), 'the tier did not run');

  // the integration branch moved after the verifier's run: the tier runs
  const g = fixture(t);
  const old = g.head('feat/x-a');
  sh(g.repo, 'echo more > b.txt && git add . && git commit -qm moved', g.d);
  const r2 = ml(g, '--apply', '--verified-head', old, '--name', 'db');
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.out, /tiers\.merge: quick pass/);
});

test('merge-lane: a renumber that changes the tree is committed and the tier runs', (t) => {
  const f = fixture(t, { profile: { merge: { renumber: 'echo n > renumbered.txt' } } });
  sh(f.repo, 'git checkout -q feat/x-a && git merge -q --no-edit int && git checkout -q int', f.d);
  const r = ml(f, '--apply', '--verified-head', f.head('feat/x-a'), '--name', 'db');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /renumber: changed the tree, committed/);
  assert.match(sh(f.repo, 'git log -1 --format=%s', f.d), /^chore\(merge\): renumber migrations from feat\/x-a/);
  assert.match(r.out, /tiers\.merge: quick pass/);
});

test('merge-lane: a conflict is listed, never resolved: exit 2 and the merge is aborted', (t) => {
  const f = fixture(t, { laneFile: 'README.md' });
  sh(f.repo, 'echo other > README.md && git commit -qam other', f.d);
  const before = f.head();
  const dry = ml(f);
  if (!/needs git >= 2.38/.test(dry.out)) {
    assert.equal(dry.code, 2, dry.out);
    assert.match(dry.out, /conflicts: README\.md/);
  }
  const r = ml(f, '--apply');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /conflicts: README\.md/);
  assert.match(r.out, /CONFLICT \(1 file\(s\)\); merge aborted/);
  assert.equal(f.head(), before);
  assert.ok(!existsSync(join(f.repo, '.git', 'MERGE_HEAD')));
});

test('merge-lane: a red gate exits 1 and keeps the merge; a dirty tree or the wrong branch is refused', (t) => {
  const f = fixture(t, { profile: { gates: { quick: { cmd: 'exit 4', kind: 'check' } }, tiers: { merge: ['quick'] } } });
  const r = ml(f, '--apply');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /RESULT: RED: quick \(merged at/);
  assert.match(r.out, /log: .*logs\/merge-x-a-quick\.log/);

  const g = fixture(t);
  sh(g.repo, 'echo dirty >> README.md', g.d);
  assert.equal(ml(g, '--apply').code, 3);
  sh(g.repo, 'git checkout -q -- README.md && git checkout -q feat/x-a', g.d);
  const w = ml(g, '--apply', '--into', 'int');
  assert.equal(w.code, 3);
  assert.match(w.out, /is on feat\/x-a, not int/);
  assert.equal(ml(g, '--lane', 'nope').code, 3);
});
