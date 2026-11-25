import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, realpathSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, run, write, gitRepo, sh } from './helpers.mjs';
import { bashCategory, slugOf } from '../build-report.mjs';

const T0 = Date.parse('2026-01-01T10:00:00Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\nnot json, skipped\n';

const asst = (min, id, req, usage, content = [], model = 'model-big-1') => ({
  type: 'assistant',
  timestamp: at(min),
  requestId: req,
  message: { id, model, role: 'assistant', usage, content },
});
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const u = (i, cw, cr, o) => ({ input_tokens: i, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: o });

/** A synthetic project dir: one orchestrator session with one subagent. */
function fixture(t) {
  const d = tmp(t);
  const project = join(d, 'my-app');
  const root = join(d, 'projects');
  const dir = join(root, slugOf(project));
  const S = 'sess-0001';
  write(
    join(dir, `${S}.jsonl`),
    jsonl([
      { type: 'user', timestamp: at(0), message: { role: 'user', content: 'go' } },
      // one response streamed as two lines (same message id + request id): counted once
      asst(1, 'm1', 'r1', u(10, 1000, 0, 50), [tool('t1', 'Bash', { command: 'git status' })]),
      asst(1, 'm1', 'r1', u(10, 1000, 0, 50), [tool('t2', 'Bash', { command: 'node --test x/' })]),
      { type: 'user', timestamp: at(2), message: { role: 'user', content: [{ type: 'tool_result', is_error: true }] } },
      asst(3, 'm2', 'r2', u(5, 0, 2000, 100), [tool('t3', 'Read', { file_path: '/x' })]),
      // a 30-minute gap is not active time
      asst(33, 'm3', 'r3', u(1, 0, 3000, 10)),
      asst(33, 'm4', 'r4', u(999, 999, 999, 999), [], '<synthetic>'),
    ]),
  );
  write(
    join(dir, S, 'subagents', 'agent-a.jsonl'),
    jsonl([
      asst(5, 'a1', 'q1', u(100, 0, 0, 1000), [tool('s1', 'Bash', { command: 'grep -r foo .' }), tool('s2', 'Edit', {})], 'model-small-2'),
      asst(7, 'a2', 'q2', u(100, 0, 0, 1000), [], 'model-small-2'),
    ]),
  );
  write(join(dir, S, 'subagents', 'agent-a.meta.json'), { agentType: 'general-purpose', description: 'Lane A build' });
  const prices = write(join(d, 'prices.json'), {
    per: 1000000,
    default: 'model-big',
    models: { 'model-big': { input: 10, cache_write: 20, cache_read: 1, output: 50 }, 'model-small': { input: 1, cache_write: 2, cache_read: 0.1, output: 5 } },
  });
  const roles = write(join(d, 'roles.json'), { main: 'orchestrator', default: 'other', roles: [{ role: 'lane build', pattern: '\\blane\\b' }] });
  return { d, project, root, S, prices, roles };
}

test('build-report: usage deduplicated, cost, active minutes, calls per turn, max context, bash categories, roles', (t) => {
  const f = fixture(t);
  const out = join(f.d, 'report.md');
  const js = join(f.d, 'report.json');
  const r = run('build-report.mjs', ['--session', f.S, '--project', f.project, '--projects-root', f.root, '--prices', f.prices, '--roles', f.roles, '--out', out, '--json', js]);
  assert.equal(r.code, 0, r.err);
  const agents = JSON.parse(readFileSync(js, 'utf8'));
  const main = agents.find((a) => a.kind === 'main');
  const sub = agents.find((a) => a.kind === 'sub');
  assert.equal(main.turns, 3, 'duplicate line and synthetic message not counted');
  assert.deepEqual(main.usage, { input_tokens: 16, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 160 });
  assert.equal(main.toolCalls, 3);
  assert.equal(main.callsPerTurn, 1);
  assert.equal(main.maxCtx, 3001);
  assert.equal(main.activeMin, 3, 'gaps over 10 minutes are excluded');
  assert.equal(main.wallMin, 33);
  assert.equal(main.toolErrors, 1);
  assert.deepEqual(main.bash, { git: 1, test: 1 });
  // (16*10 + 1000*20 + 5000*1 + 160*50) / 1e6
  assert.ok(Math.abs(main.cost - 0.033160) < 1e-9, String(main.cost));
  assert.equal(main.role, 'orchestrator');
  assert.equal(sub.role, 'lane build');
  assert.equal(sub.model, 'model-small-2');
  assert.ok(Math.abs(sub.cost - 0.0102) < 1e-9, 'priced by prefix');
  assert.deepEqual(sub.bash, { 'read/search': 1 });
  const md = readFileSync(out, 'utf8');
  assert.match(md, /## By role/);
  assert.match(md, /\| lane build \| 1 \| 2 \| 2 \|/);
  assert.match(md, /\| Lane A build \| lane build \| model-small-2 \|/);
  assert.match(md, /\$0\.03/);
  assert.match(md, /\| \*\*Total\*\* \| 2 \| 5 \|/);
});

test('build-report: --set writes <logs_dir>/build-report-<set>.md; without prices there is no cost column', (t) => {
  const f = fixture(t);
  write(join(f.project, '.claude', 'workflow-profile.json'), { version: 1, project: 'my-app', updated: '2026-11-25', logs_dir: 'out/logs' });
  const r = run('build-report.mjs', ['--all', '--project', f.project, '--projects-root', f.root, '--set', 'demo']);
  assert.equal(r.code, 0, r.err);
  const p = join(f.project, 'out', 'logs', 'build-report-demo.md');
  assert.ok(existsSync(p));
  const md = readFileSync(p, 'utf8');
  assert.doesNotMatch(md, /Cost/);
  assert.match(md, /\| general-purpose \|/, 'role falls back to the agent type');
});

test('build-report: missing input', (t) => {
  const f = fixture(t);
  assert.equal(run('build-report.mjs', ['--project', f.project, '--projects-root', f.root]).code, 2);
  assert.equal(run('build-report.mjs', ['--session', 'nope', '--project', f.project, '--projects-root', f.root]).code, 1);
  assert.equal(run('build-report.mjs', ['--session', 'x', '--project', join(f.d, 'elsewhere'), '--projects-root', f.root]).code, 1);
});

test('bash categories', () => {
  assert.equal(bashCategory('pnpm --filter @x/y test'), 'test');
  assert.equal(bashCategory('pnpm typecheck'), 'typecheck');
  assert.equal(bashCategory('npx eslint .'), 'lint');
  assert.equal(bashCategory('pnpm -r build'), 'build');
  assert.equal(bashCategory('cd /x && git log -1'), 'git');
  assert.equal(bashCategory('psql -c "select 1"'), 'db');
  assert.equal(bashCategory('curl -s localhost:4400/health'), 'browser/http');
  assert.equal(bashCategory('sleep 5'), 'wait');
  assert.equal(bashCategory('sed -n 1,5p f'), 'read/search');
  assert.equal(bashCategory('node scripts/x.mjs'), 'other');
});

test('build-report: --slug takes a value that starts with "-"', (t) => {
  const f = fixture(t);
  const slug = slugOf(f.project);
  assert.ok(slug.startsWith('-'));
  const r = run('build-report.mjs', ['--session', f.S, '--slug', slug, '--projects-root', f.root]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, new RegExp(`from \`${slug}\``));
});

test('build-report: inside a worktree the default slug is the main checkout\'s', (t) => {
  const f = fixture(t);
  const main = realpathSync(gitRepo(join(f.d, 'main-app'), { home: f.d }));
  const wt = join(realpathSync(f.d), 'main-app-wt');
  sh(main, `git worktree add -q -b lane/x ${wt}`, f.d);
  // the transcripts were written under the main checkout's slug
  cpSync(join(f.root, slugOf(f.project)), join(f.root, slugOf(main)), { recursive: true });
  const r = run('build-report.mjs', ['--session', f.S, '--projects-root', f.root], { cwd: wt, home: f.d });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, new RegExp(`from \`${slugOf(main)}\``));
});

test('build-report: --since/--until window the lines, so agents outside drop out and edges count in part', (t) => {
  const f = fixture(t);
  const js = join(f.d, 'w.json');
  const r = run('build-report.mjs', ['--session', f.S, '--project', f.project, '--projects-root', f.root, '--since', at(4), '--until', at(8), '--json', js]);
  assert.equal(r.code, 0, r.err);
  const agents = JSON.parse(readFileSync(js, 'utf8'));
  assert.deepEqual(agents.map((a) => a.kind), ['sub'], 'the orchestrator has no line inside the window');
  assert.match(r.out, /Window: .* to .*; only transcript lines inside it count/);
  const edge = run('build-report.mjs', ['--session', f.S, '--project', f.project, '--projects-root', f.root, '--since', at(2), '--json', js]);
  assert.equal(edge.code, 0, edge.err);
  const main = JSON.parse(readFileSync(js, 'utf8')).find((a) => a.kind === 'main');
  assert.equal(main.turns, 2, 'm1 falls before the window');
  assert.equal(main.toolErrors, 1);
  assert.equal(run('build-report.mjs', ['--session', f.S, '--project', f.project, '--projects-root', f.root, '--since', at(40)]).code, 1);
  assert.equal(run('build-report.mjs', ['--session', f.S, '--project', f.project, '--projects-root', f.root, '--since', 'soon']).code, 2);
});
