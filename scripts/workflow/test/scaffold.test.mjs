import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, run, write, gitRepo, sh } from './helpers.mjs';

function fixture(t) {
  const d = tmp(t);
  const repo = gitRepo(join(d, 'my-app'), { home: d });
  write(join(repo, '.claude', 'workflow-profile.json'), {
    version: 1,
    project: 'my-app',
    updated: '2026-11-25',
    shell_prefix: 'export SCAFFOLD_PREFIX=1;',
    commands: { build: 'echo build', test_task: 'echo {files}', test_lane_end: 'echo since {base}' },
    gates: {
      'db-up': { cmd: 'echo healthy >> ../health.log', kind: 'health' },
      quick: { cmd: 'test "$SCAFFOLD_PREFIX" = 1 && echo lane={lane} port={port} > .lane/smoke.txt', kind: 'check', smoke: true },
    },
    tiers: { merge: ['quick'] },
    test_db: {
      host: '127.0.0.1',
      port: 5432,
      name_pattern: 'app_{set}_{lane}_test',
      create: 'echo create {name} >> ../db.log',
      bootstrap: 'echo boot {url} >> ../db.log',
      allow_hosts: ['127.0.0.1'],
    },
    ports: { range: [4400, 4410], registry: '.claude/ports.json' },
  });
  // an older batch's brief already hands out 4401 and 4403
  write(join(repo, 'context', 'batch-briefs', 'old', 'L1.md'), '- ports: api `4401`, web `4403`\n- 4402 appears in prose only\n');
  sh(repo, 'git add . && git commit -qm profile', d);
  const map = write(join(d, 'lanes.json'), {
    set: 'demo',
    base: 'main',
    worktree_root: '../wt',
    lanes: [
      { lane: 'A', ports: ['api', 'web'] },
      { lane: 'B', branch: 'lane/custom-b', ports: ['api'], test_db: false },
    ],
  });
  return { d, repo, map };
}

test('scaffold: the dry run is the default, prints the plan and creates nothing', (t) => {
  const { d, repo, map } = fixture(t);
  const r = run('scaffold.mjs', ['--lane-map', map, '--repo', repo], { home: d });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /dry run \(nothing created; --apply to run\)/);
  assert.match(r.out, /\| A \| lane\/demo-a \| .*wt\/demo-a \| main \| api 4400, web 4402 \| app_demo_a_test \|/);
  assert.match(r.out, /\| B \| lane\/custom-b \| .* \| api 4404 \| — \|/);
  assert.match(r.out, /\[would\] ports: seed \.claude\/ports\.json with 2 port\(s\) found in briefs: 4401, 4403/);
  assert.match(r.out, /\[would\] worktree A: git worktree add -b lane\/demo-a .*demo-a main/);
  assert.match(r.out, /\[would\] test-db A: echo create app_demo_a_test/);
  assert.match(r.out, /\[would\] test-db A: echo boot postgresql:\/\/127\.0\.0\.1:5432\/app_demo_a_test/);
  assert.match(r.out, /\[would\] health: db-up/);
  assert.match(r.out, /\[would\] smoke: gates\.quick: .*lane=a port=4400/);
  assert.match(r.out, /\[skip\] smoke: commands\.test_task: renders/);
  assert.ok(!existsSync(join(repo, '.claude', 'ports.json')), 'no registry written');
  assert.ok(!existsSync(join(d, 'wt')), 'no worktree');
  assert.ok(!existsSync(join(d, 'db.log')), 'nothing run');
  assert.equal(sh(repo, 'git branch --list "lane/*"', d), '', 'no branch');
});

test('scaffold --apply creates worktrees, ports, DBs, runs health and smoke; a re-run reuses them', (t) => {
  const { d, repo, map } = fixture(t);
  const r = run('scaffold.mjs', ['--lane-map', map, '--repo', repo, '--apply'], { home: d });
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(existsSync(join(d, 'wt', 'demo-a', 'README.md')));
  assert.equal(sh(join(d, 'wt', 'demo-b'), 'git rev-parse --abbrev-ref HEAD', d), 'lane/custom-b');
  const reg = JSON.parse(readFileSync(join(repo, '.claude', 'ports.json'), 'utf8'));
  assert.deepEqual(Object.keys(reg.allocations).sort(), ['4400', '4401', '4402', '4403', '4404']);
  assert.equal(reg.allocations['4400'].lane, 'A');
  assert.equal(reg.allocations['4401'].seeded, true);
  assert.equal(readFileSync(join(d, 'db.log'), 'utf8'), 'create app_demo_a_test\nboot postgresql://127.0.0.1:5432/app_demo_a_test\n');
  assert.equal(readFileSync(join(repo, '..', 'health.log'), 'utf8'), 'healthy\n');
  assert.equal(readFileSync(join(d, 'wt', 'demo-a', '.lane', 'smoke.txt'), 'utf8'), 'lane=a port=4400\n');
  assert.equal(sh(join(d, 'wt', 'demo-a'), 'git status --porcelain', d), '', '.lane/ is excluded');

  const again = run('scaffold.mjs', ['--lane-map', map, '--repo', repo, '--skip-db', '--skip-smoke'], { home: d });
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /\[skip\] worktree A: keep/);
  assert.match(again.out, /api 4400, web 4402/, 'ports reused');
  assert.doesNotMatch(again.out, /ports: write/, 'nothing new to allocate');
});

test('scaffold refuses a test DB host outside allow_hosts and an unknown base', (t) => {
  const { d, repo, map } = fixture(t);
  const pf = join(repo, '.claude', 'workflow-profile.json');
  const p = JSON.parse(readFileSync(pf, 'utf8'));
  p.test_db.allow_hosts = ['localhost'];
  write(pf, p);
  const r = run('scaffold.mjs', ['--lane-map', map, '--repo', repo], { home: d });
  assert.equal(r.code, 1, 'an invalid profile is refused');
  assert.match(r.err, /not in allow_hosts/);
  p.test_db.allow_hosts = ['127.0.0.1'];
  write(pf, p);
  const m = JSON.parse(readFileSync(map, 'utf8'));
  m.base = 'no-such-ref';
  write(map, m);
  const r2 = run('scaffold.mjs', ['--lane-map', map, '--repo', repo], { home: d });
  assert.equal(r2.code, 1);
  assert.match(r2.out, /\[fail\] worktree A: base no-such-ref is not a commit/);
});
