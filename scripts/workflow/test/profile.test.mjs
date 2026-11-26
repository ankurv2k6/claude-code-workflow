import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, run, write, EXAMPLE_PROFILE } from './helpers.mjs';
import { diffProfiles } from '../profile-diff.mjs';
import { validate } from '../lib/schema.mjs';
import { checkProfile } from '../lib/profile.mjs';

const schema = () => JSON.parse(readFileSync(join(EXAMPLE_PROFILE, '..', 'workflow-profile.schema.json'), 'utf8'));

const example = () => JSON.parse(readFileSync(EXAMPLE_PROFILE, 'utf8'));

test('profile-check: the template example is valid against the real schema', () => {
  const r = run('profile-check.mjs', ['--profile', EXAMPLE_PROFILE, '--json']);
  assert.equal(r.code, 0, r.out + r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.valid, true);
  assert.match(j.schema, /\.claude\/templates\/workflow-profile\.schema\.json$/);
});

test('profile-check: an invalid profile is refused with each error', (t) => {
  const d = tmp(t);
  const p = example();
  p.version = 2; // enum
  delete p.updated; // required
  p.gates.typecheck.kind = 'lint'; // enum
  p.gates['lint-staged'].heavy = 'nosuchslot'; // cross-check: heavy names a slot
  p.tiers.merge.push('nosuchgate'); // cross-check: tier names a gate
  p.commands.deploy = 'x'; // additionalProperties false
  p.limits.stall_minutes = 0; // minimum
  p.updated_by = 'x'; // unknown top-level key
  const f = write(join(d, '.claude', 'workflow-profile.json'), p);
  const r = run('profile-check.mjs', ['--profile', f, '--json']);
  assert.equal(r.code, 1);
  const errs = JSON.parse(r.out).errors.join('\n');
  for (const want of [
    /\$\.version/,
    /missing required "updated"/,
    /\$\.gates\.typecheck\.kind/,
    /heavy: "nosuchslot" is not a heavy_jobs slot/,
    /names gate "nosuchgate"/,
    /\$\.commands\.deploy: unknown key/,
    /\$\.limits\.stall_minutes: below 1/,
    /\$\.updated_by: unknown key/,
  ])
    assert.match(errs, want);
});

test('profile-check --smoke runs smoke gates and commands, skips unfilled placeholders, reports failures', (t) => {
  const d = tmp(t);
  const f = write(join(d, '.claude', 'workflow-profile.json'), {
    version: 1,
    project: 'my-app',
    updated: '2026-11-25',
    shell_prefix: 'export SMOKE_PREFIX=1;',
    commands: { build: 'test "$SMOKE_PREFIX" = 1', test_task: 'echo {files}', test_lane_end: 'echo {base}' },
    gates: {
      ok: { cmd: 'echo ok-{lane}', kind: 'check', smoke: true },
      bad: { cmd: 'exit 3', kind: 'check', smoke: true },
      heavy: { cmd: 'exit 9', kind: 'test', smoke: false },
    },
    tiers: { merge: ['ok', 'bad'] },
  });
  const r = run('profile-check.mjs', ['--profile', f, '--smoke', '--lane', 'a', '--base', 'main', '--json']);
  assert.equal(r.code, 1);
  const s = Object.fromEntries(JSON.parse(r.out).smoke.map((x) => [x.id, x]));
  assert.equal(s['gates.ok'].status, 'pass');
  assert.equal(s['gates.ok'].cmd, 'echo ok-a');
  assert.equal(s['gates.bad'].status, 'fail');
  assert.equal(s['gates.bad'].exit, 3);
  assert.equal(s['gates.heavy'], undefined, 'smoke:false gates never run');
  assert.equal(s['commands.build'].status, 'pass', 'shell_prefix applied');
  assert.equal(s['commands.test_task'].status, 'skipped');
  assert.equal(s['commands.test_lane_end'].status, 'pass');
  const only = run('profile-check.mjs', ['--profile', f, '--smoke', '--only', 'gates.ok', '--lane', 'a']);
  assert.equal(only.code, 0, only.out);
});

test('the validator covers every keyword the schema description lists', () => {
  const s = (schema, v) => validate(v, schema).length;
  assert.ok(s({ type: 'integer' }, 1.5));
  assert.ok(s({ properties: { a: { type: 'string' } } }, { a: 1 }));
  assert.ok(s({ required: ['a'] }, {}));
  assert.ok(s({ additionalProperties: false }, { a: 1 }));
  assert.ok(s({ additionalProperties: { type: 'string' } }, { a: 1 }));
  assert.ok(s({ items: { type: 'string' } }, [1]));
  assert.ok(s({ enum: [1] }, 2));
  assert.ok(s({ minimum: 2 }, 1));
  assert.ok(s({ minLength: 2 }, 'a'));
  assert.ok(s({ minItems: 1 }, []));
  assert.ok(s({ maxItems: 1 }, [1, 2]));
  assert.ok(s({ pattern: '^a' }, 'b'));
  assert.equal(s({ type: 'object', properties: { a: { enum: [1] } }, required: ['a'] }, { a: 1 }), 0);
});

const classes = (a, b) => diffProfiles(a, b).changes.map((c) => `${c.class} ${c.path}`);

test('profile-diff: additions (existing gate in a tier, invariant suite, risk route) are auto-applicable', () => {
  const a = example();
  const b = example();
  b.tiers.lane_end.push('migration-journal');
  b.invariant_suites.push('tests/more-invariants');
  b.risk_routing.push({ paths: ['**/billing/**'], verifier: 'security-engineer', reason: 'money' });
  b.provenance.push({ path: 'tiers.lane_end', source: 'context/batch-report-y.md', date: '2026-11-26', change: 'added migration-journal' });
  b.updated = '2026-11-26';
  b.notes = 'changed prose';
  b.gates.typecheck.notes = 'new note';
  const d = diffProfiles(a, b);
  assert.deepEqual(d.changes.map((c) => c.class), ['addition', 'addition', 'addition']);
  assert.equal(d.only_additions, true, 'provenance, updated and notes never block the additions path');
  assert.equal(d.owner_items, 0);
  assert.deepEqual(d.ignored.sort(), ['notes', 'provenance', 'updated']);
});

test('profile-diff: a new registry gate is a new cmd, so an owner item, and so is a tier naming it', () => {
  const a = example();
  const b = example();
  b.gates['new-check'] = { cmd: 'node scripts/new-check.mjs', kind: 'check' };
  b.tiers.merge.push('new-check');
  b.invariant_suites.push('tests/more-invariants');
  const d = diffProfiles(a, b);
  assert.deepEqual(
    d.changes.map((c) => `${c.class} ${c.path}`).sort(),
    ['addition invariant_suites', 'command-change gates.new-check', 'command-change tiers.merge'],
  );
  assert.equal(d.only_additions, false, 'any new cmd needs the owner');
  assert.equal(d.owner_items, 2);
});

test('profile-diff: each other change class', () => {
  const a = example();
  const cases = [
    [(b) => (b.commands.build = 'pnpm build:all'), 'command-change commands.build'],
    [(b) => (b.shell_prefix = 'set -e;'), 'command-change shell_prefix'],
    [(b) => (b.gates.typecheck.cmd = 'pnpm tsc'), 'command-change gates.typecheck.cmd'],
    [(b) => b.tiers.merge.splice(b.tiers.merge.indexOf('migration-journal'), 1), 'removal tiers.merge'],
    [(b) => b.invariant_suites.pop(), 'removal invariant_suites'],
    [(b) => b.risk_routing.pop(), 'removal risk_routing'],
    [(b) => delete b.commands.typecheck_clean, 'removal commands.typecheck_clean'],
    [(b) => delete b.known_reds, 'removal known_reds'],
    [(b) => (b.test_db.port = 5499), 'test-db-change test_db'],
    [(b) => (b.limits.stall_minutes = 30), 'limit-change limits.stall_minutes'],
    [(b) => (b.agents.max_concurrent = 4), 'limit-change agents.max_concurrent'],
    [(b) => (b.heavy_jobs.rehearsal.slots = 2), 'limit-change heavy_jobs.rehearsal.slots'],
    [(b) => (b.gates.typecheck.smoke = false), 'other gates.typecheck.smoke'],
    [(b) => (b.ports.range = [5000, 5100]), 'other ports.range'],
    [(b) => (b.agents.verifier_model = 'sonnet'), 'other agents.verifier_model'],
    [(b) => (b.risk_routing[0].reason = 'changed'), 'other risk_routing'],
  ];
  for (const [mutate, want] of cases) {
    const b = example();
    mutate(b);
    const got = classes(a, b);
    assert.deepEqual(got, [want], `${want}: got ${got.join(', ')}`);
    assert.equal(diffProfiles(a, b).only_additions, false);
  }
  assert.deepEqual(diffProfiles(a, example()).changes, []);
});

test('profile-diff CLI prints JSON on stdout and a summary', (t) => {
  const d = tmp(t);
  const b = example();
  b.tiers.lane_end.push('migration-journal');
  b.limits.handback_lines = 20;
  const pa = write(join(d, 'a.json'), example());
  const pb = write(join(d, 'b.json'), b);
  const r = run('profile-diff.mjs', [pa, pb]);
  assert.equal(r.code, 0);
  const j = JSON.parse(r.out);
  assert.deepEqual(j.summary, { addition: 1, 'limit-change': 1 });
  assert.match(r.err, /2 change\(s\)/);
  assert.match(r.err, /1 owner item/);
  const s = run('profile-diff.mjs', [pa, pb, '--summary']);
  assert.match(s.out, /auto\s+addition\s+tiers\.lane_end/);
  assert.equal(run('profile-diff.mjs', [pa]).code, 2);
});

test('profile-check --smoke shell-quotes placeholder values, so a file name cannot inject shell', (t) => {
  const d = tmp(t);
  const marker = join(d, 'pwned');
  const p = example();
  p.shell_prefix = 'export SMOKE_PREFIX=1;';
  p.gates = { echo: { cmd: 'printf "<%s>" {lane}', kind: 'check', smoke: true } };
  p.tiers = {};
  p.commands = { test_task: 'printf "<%s>" {files}; test "$SMOKE_PREFIX" = 1', test_lane_end: 'printf "<%s>" {base}' };
  const f = write(join(d, '.claude', 'workflow-profile.json'), p);
  const r = run('profile-check.mjs', [
    '--profile', f, '--smoke', '--json',
    '--files', `a.ts b;touch ${marker}`, '--files', `$(touch ${marker})`,
    '--base', `x\`touch ${marker}\``, '--lane', `a'; touch ${marker}; '`,
  ]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(!existsSync(marker), 'no placeholder value ran as shell');
  const s = Object.fromEntries(JSON.parse(r.out).smoke.map((x) => [x.id, x]));
  assert.equal(s['commands.test_task'].status, 'pass', 'the prefix still applies');
  assert.match(s['commands.test_task'].cmd, /^printf "<%s>" a\.ts 'b;touch' \S+ '\$\(touch' '[^']*\)'; test/);
});

test('profile-check rejects a placeholder inside quotes', () => {
  const p = example();
  p.commands.test_task = 'node scripts/test-select.mjs --files "{files}"';
  p.test_db.bootstrap = "TEST_DATABASE_URL='{url}' pnpm test:bootstrap";
  const errs = checkProfile(p, schema());
  assert.ok(errs.some((e) => /commands\.test_task: placeholder \{files\} is inside quotes/.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => /test_db\.bootstrap: placeholder \{url\} is inside quotes/.test(e)), errs.join('\n'));
});

test('profile-check --smoke --install-first runs install, then build, before the gates; a failed install skips the rest', (t) => {
  const d = tmp(t);
  const prof = (install) => ({
    version: 1,
    project: 'my-app',
    updated: '2026-11-25',
    commands: { install: install, build: 'test -f installed && touch built', typecheck: 'test -f built' },
    gates: { needs: { cmd: 'test -f built', kind: 'check', smoke: true } },
  });
  const f = write(join(d, '.claude', 'workflow-profile.json'), prof('touch installed'));
  const before = run('profile-check.mjs', ['--profile', f, '--smoke', '--only', 'gates.needs', '--json']);
  assert.equal(before.code, 1, 'without --install-first the gate runs on an unbuilt tree');
  const r = run('profile-check.mjs', ['--profile', f, '--smoke', '--install-first', '--only', 'gates.needs', '--only', 'commands.typecheck', '--json']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(r.out).smoke.map((x) => `${x.id}:${x.status}`), ['commands.install:pass', 'commands.build:pass', 'gates.needs:pass', 'commands.typecheck:pass']);
  write(f, prof('exit 5'));
  const bad = run('profile-check.mjs', ['--profile', f, '--smoke', '--install-first', '--json']);
  assert.equal(bad.code, 1);
  const s = Object.fromEntries(JSON.parse(bad.out).smoke.map((x) => [x.id, x]));
  assert.equal(s['commands.install'].status, 'fail');
  assert.equal(s['gates.needs'].status, 'skipped');
  assert.match(s['gates.needs'].reason, /commands\.install failed/);
});

test('profile: test_db.url renders {url} with credentials; it must name {host} and {name}', async () => {
  const { dbUrl } = await import('../lib/profile.mjs');
  assert.equal(dbUrl({ host: 'localhost', port: 6543, url: 'postgresql://u:p@{host}:{port}/{name}' }, 'x_test'), 'postgresql://u:p@localhost:6543/x_test');
  assert.equal(dbUrl({}, 'x_test'), 'postgresql://127.0.0.1:5432/x_test', 'the default template');
  const p = example();
  p.test_db.url = 'postgresql://u:p@db.elsewhere:5432/{name}';
  assert.match(checkProfile(p, schema()).join('\n'), /test_db\.url: needs \{host\}/);
  p.test_db.url = 'postgresql://{host}:{port}/{name}?x={lane}';
  assert.match(checkProfile(p, schema()).join('\n'), /test_db\.url: unknown placeholder \{lane\}/);
  p.test_db.url = 'postgresql://u:p@{host}:{port}/{name}';
  p.ports.offsets = { web: 2000, site: 2000 };
  assert.match(checkProfile(p, schema()).join('\n'), /ports\.offsets\.site: offset 2000 is also web's/);
  p.ports.offsets = { web: 2000 };
  assert.deepEqual(checkProfile(p, schema()), []);
});

test('profile-check: tests.* and release.* placeholders are checked per key', () => {
  const p = example();
  assert.deepEqual(checkProfile(p, schema()), []);
  p.tests.heavy_lock = 'lock --owner {owner} -- {cmd} {files}'; // {files} is not a heavy_lock placeholder
  p.release.deploy = 'deploy --bundle {bundle} --description {description} --who {owner}';
  p.release.package = "pack --out '{bundle}'"; // quoted
  p.commands.test_task = 'run {cmd}'; // a release/tests placeholder in commands.*
  const errs = checkProfile(p, schema()).join('\n');
  assert.match(errs, /\$\.tests\.heavy_lock: unknown placeholder \{files\} \(known: owner, cmd\)/);
  assert.match(errs, /\$\.release\.deploy: unknown placeholder \{owner\}/);
  assert.match(errs, /\$\.release\.package: placeholder \{bundle\} is inside quotes/);
  assert.match(errs, /\$\.commands\.test_task: unknown placeholder \{cmd\}/);
  assert.doesNotMatch(errs, /release\.hotfix_finish|tests\.merge_delta/);
});
