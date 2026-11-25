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
  assert.equal(
    readFileSync(join(d, 'db.log'), 'utf8'),
    'create app_demo_a_test\nboot postgresql://127.0.0.1:5432/app_demo_a_test\ncreate app_demo_int_test\nboot postgresql://127.0.0.1:5432/app_demo_int_test\n',
    'the lane DB, then the integration DB',
  );
  assert.match(r.out, /Integration test DB: app_demo_int_test \(postgresql:\/\/127\.0\.0\.1:5432\/app_demo_int_test\)/);
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

const editProfile = (repo, fn) => {
  const pf = join(repo, '.claude', 'workflow-profile.json');
  const p = JSON.parse(readFileSync(pf, 'utf8'));
  fn(p);
  write(pf, p);
};

test('scaffold smoke: in a fresh worktree install, then build, then the gates, then the named commands', (t) => {
  const { d, repo, map } = fixture(t);
  editProfile(repo, (p) => {
    p.commands.install = 'echo installed > .lane/installed';
    p.commands.build = 'test -f .lane/installed && echo built > .lane/built';
    p.commands.typecheck = 'test -f .lane/built && echo typed > .lane/typed';
    p.gates.quick.cmd = 'test -f .lane/built && echo lane={lane} port={port} > .lane/smoke.txt';
  });
  sh(repo, 'git commit -qam install', d);
  const dry = run('scaffold.mjs', ['--lane-map', map, '--repo', repo, '--smoke-commands', 'typecheck'], { home: d });
  assert.equal(dry.code, 0, dry.out + dry.err);
  const order = ['commands.install', 'commands.build', 'gates.quick', 'commands.typecheck'].map((k) => dry.out.indexOf(`[would] smoke: ${k}:`));
  assert.ok(order.every((i) => i >= 0), dry.out);
  assert.deepEqual([...order].sort((a, b) => a - b), order, `smoke order: ${order}`);

  const r = run('scaffold.mjs', ['--lane-map', map, '--repo', repo, '--apply', '--smoke-commands', 'typecheck'], { home: d });
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(readFileSync(join(d, 'wt', 'demo-a', '.lane', 'smoke.txt'), 'utf8'), 'lane=a port=4400\n');
  assert.ok(existsSync(join(d, 'wt', 'demo-a', '.lane', 'typed')));

  // a kept worktree runs install and build only when named
  const again = run('scaffold.mjs', ['--lane-map', map, '--repo', repo, '--skip-db'], { home: d });
  assert.match(again.out, /\[skip\] smoke: commands\.install: renders/);
});

test('scaffold smoke: a failed install skips the gates instead of reporting them red', (t) => {
  const { d, repo, map } = fixture(t);
  editProfile(repo, (p) => (p.commands.install = 'echo no network >&2; exit 7'));
  sh(repo, 'git commit -qam install', d);
  const r = run('scaffold.mjs', ['--lane-map', map, '--repo', repo, '--apply', '--skip-db'], { home: d });
  assert.equal(r.code, 1);
  assert.match(r.out, /\[fail\] smoke: commands\.install: .*no network/);
  assert.match(r.out, /\[skip\] smoke: gates\.quick: .*not run: commands\.install failed/);
});

test('scaffold ports: registry "taken" and "fixed" are never handed out', (t) => {
  const { d, repo, map } = fixture(t);
  write(join(repo, '.claude', 'ports.json'), {
    version: 1,
    allocations: {},
    taken: [4400, { set: 'old', lane: 'x', api: 4401, web: [4402] }],
    fixed: { 'shared-db': 4403, cache: '4405' },
  });
  const r = run('scaffold.mjs', ['--lane-map', map, '--repo', repo, '--json'], { home: d });
  assert.equal(r.code, 0, r.out + r.err);
  const lanes = Object.fromEntries(JSON.parse(r.out).lanes.map((l) => [l.lane, l.portMap]));
  assert.deepEqual(lanes, { A: { api: 4404, web: 4406 }, B: { api: 4407 } });
});

test('scaffold ports: step and offsets give each lane a base port plus named offsets; names default to ports.names', (t) => {
  const { d, repo, map } = fixture(t);
  editProfile(repo, (p) => (p.ports = { range: [4400, 4499], registry: '.claude/ports.json', step: 10, offsets: { web: 2000, site: 2002 }, names: ['api', 'web'] }));
  write(join(repo, '.claude', 'ports.json'), { version: 1, allocations: {}, taken: [4410, 6420] });
  const m = JSON.parse(readFileSync(map, 'utf8'));
  m.lanes = [{ lane: 'A', ports: ['api', 'web', 'site', 'admin'] }, { lane: 'B' }, { lane: 'C', ports: [] }];
  write(map, m);
  const r = run('scaffold.mjs', ['--lane-map', map, '--repo', repo, '--json', '--apply', '--skip-db', '--skip-smoke'], { home: d });
  assert.equal(r.code, 0, r.out + r.err);
  const lanes = Object.fromEntries(JSON.parse(r.out).lanes.map((l) => [l.lane, l.portMap]));
  // A at base 4400; B cannot take 4410 (taken) nor 4420 (its web 6420 is taken), so 4430
  assert.deepEqual(lanes, { A: { api: 4400, web: 6400, site: 6402, admin: 4401 }, B: { api: 4430, web: 6430 }, C: {} });
  // a re-run reuses them
  const again = run('scaffold.mjs', ['--lane-map', map, '--repo', repo, '--json', '--skip-db', '--skip-smoke'], { home: d });
  assert.deepEqual(Object.fromEntries(JSON.parse(again.out).lanes.map((l) => [l.lane, l.portMap])), lanes);
  const reg = JSON.parse(readFileSync(join(repo, '.claude', 'ports.json'), 'utf8'));
  assert.deepEqual(reg.taken, [4410, 6420], 'taken is kept on write');
});

test('scaffold test DB: {url} renders from test_db.url, credentials included', (t) => {
  const { d, repo, map } = fixture(t);
  editProfile(repo, (p) => (p.test_db.url = 'postgresql://app:secret@{host}:{port}/{name}?sslmode=disable'));
  const r = run('scaffold.mjs', ['--lane-map', map, '--repo', repo], { home: d });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /\[would\] test-db A: echo boot 'postgresql:\/\/app:secret@127\.0\.0\.1:5432\/app_demo_a_test\?sslmode=disable'/);
});

test('scaffold smoke: runs in the first lane that has a test DB, and a health gate runs once', (t) => {
  const { d, repo } = fixture(t);
  editProfile(repo, (p) => {
    p.commands.test_task = 'echo test {url} {files}';
    p.gates['db-up'].smoke = true;
  });
  sh(repo, 'git commit -qam smoke-db', d);
  // the first lane has no test DB (a cross-cutting lane); the second has one
  const map = write(join(d, 'lanes-nodb-first.json'), {
    set: 'demo',
    base: 'main',
    worktree_root: '../wt',
    lanes: [
      { lane: 'P', ports: ['api'], test_db: false },
      { lane: 'A', ports: ['api'] },
    ],
  });
  const r = run('scaffold.mjs', ['--lane-map', map, '--repo', repo], { home: d });
  assert.equal(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out, /unfilled \{url\}/, r.out);
  assert.equal((r.out.match(/db-up:/g) || []).length, 1, `health gate listed once:\n${r.out}`);
  const onlyNoDb = write(join(d, 'lanes-nodb-only.json'), {
    set: 'demo',
    base: 'main',
    worktree_root: '../wt',
    lanes: [{ lane: 'P', ports: ['api'], test_db: false }],
  });
  const r2 = run('scaffold.mjs', ['--lane-map', onlyNoDb, '--repo', repo], { home: d });
  assert.equal(r2.code, 0, r2.out + r2.err);
  assert.match(r2.out, /commands\.test_task: needs a lane with a test DB; not smoke-run/);
});

test('scaffold --task-list refuses (exit 2) a lane whose waits_on names a lane not MERGED; --lanes scaffolds a wave', async (t) => {
  const { d, repo } = fixture(t);
  const { TEMPLATE } = await import('./tasklist-fixture.mjs');
  const map = write(join(d, 'wave.json'), {
    set: 'demo',
    base: 'main',
    worktree_root: '../wt',
    lanes: [
      { lane: 'C0', waits_on: [], ports: [] },
      { lane: 'A', waits_on: ['C0'], ports: [] },
      { lane: 'B', waits_on: ['C0', 'A'], ports: [] },
    ],
  });
  const plan = (rows) =>
    TEMPLATE.replace('| C0 | Phase 0: LOCKED contracts + stubs | — | 1 | ⏳ |\n| C0-UI | shared UI foundation | C0 | 2 | ⏳ |', rows.join('\n'));
  const tl = write(join(d, 'tl.md'), plan(['| C0 | contracts | — | 1 | ✅ MERGED (abc123) |', '| A | M1 | C0 | 2 | 🔄 |', '| B | M2 | C0, A | 3 | ⏳ |']));
  const all = run('scaffold.mjs', ['--lane-map', map, '--repo', repo, '--task-list', tl, '--skip-smoke'], { home: d });
  assert.equal(all.code, 2, all.out + all.err);
  assert.match(all.err, /B waits on A/);
  assert.doesNotMatch(all.err, /A waits on/);
  const wave = run('scaffold.mjs', ['--lane-map', map, '--repo', repo, '--task-list', tl, '--lanes', 'A', '--skip-smoke'], { home: d });
  assert.equal(wave.code, 0, wave.out + wave.err);
  assert.match(wave.out, /\| A \| lane\/demo-a \|/);
  assert.doesNotMatch(wave.out, /\| B \|/);
  // the Module status table counts too: every row of the lane merged
  const tl2 = write(join(d, 'tl2.md'), plan(['| C0 | contracts | — | 1 | ✅ |', '| A | M1 | C0 | 2 | 🔎 |']).replace(
    '| Module | Lane | Status | Verify (sweeps) | UI parity | Commits | Notes |\n|---|---|---|---|---|---|---|',
    '| Module | Lane | Status | Verify (sweeps) | UI parity | Commits | Notes |\n|---|---|---|---|---|---|---|\n| M0 | C0 | ✅ MERGED (abc) | 1 | — | 3 | |\n| M1 | A | ✅ MERGED (def) | 1 | — | 2 | |',
  ));
  assert.equal(run('scaffold.mjs', ['--lane-map', map, '--repo', repo, '--task-list', tl2, '--skip-smoke'], { home: d }).code, 0);
  assert.equal(run('scaffold.mjs', ['--lane-map', map, '--repo', repo, '--lanes', 'Z'], { home: d }).code, 2);
});

test('scaffold --apply: concurrent scaffolds never hand out one port twice (the registry is locked)', async (t) => {
  const { d, repo } = fixture(t);
  const { runAsync } = await import('./helpers.mjs');
  const maps = ['s1', 's2', 's3'].map((set) =>
    write(join(d, `${set}.json`), { set, base: 'main', worktree_root: `../wt-${set}`, lanes: [{ lane: 'A', ports: ['api', 'web'] }, { lane: 'B', ports: ['api'] }] }),
  );
  const rs = await Promise.all(maps.map((m) => runAsync('scaffold.mjs', ['--lane-map', m, '--repo', repo, '--apply', '--skip-db', '--skip-smoke'], { home: d }).done));
  for (const r of rs) assert.equal(r.code, 0, r.out + r.err);
  const reg = JSON.parse(readFileSync(join(repo, '.claude', 'ports.json'), 'utf8'));
  const mine = Object.entries(reg.allocations).filter(([, a]) => a.set);
  assert.equal(mine.length, 9, 'three sets x three ports, each recorded once');
  const used = rs.flatMap((r) => [...r.out.matchAll(/(?:api|web) (\d{4})/g)].map((m) => m[1]));
  assert.equal(new Set(used).size, used.length, `no port printed twice: ${used.join(' ')}`);
  assert.ok(!existsSync(join(repo, '.claude', 'ports.json.lock')), 'lock released');
});
