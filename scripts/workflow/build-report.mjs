#!/usr/bin/env node
// Per-agent cost and effort of a build, from the session transcripts. Writes a Markdown report.

import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { args, die, abs, readJson, nowStamp, projectRoot, git } from './lib/common.mjs';
import { frontmatter, readTable, col, stripCode } from './lib/tasklist.mjs';

const USAGE = `build-report.mjs — tokens, cost and time per agent of a build, from the transcripts

Usage:
  node build-report.mjs (--session <id>… | --all) [--since <time>] [--until <time>]
                        [--project <dir> | --slug <slug>] [--projects-root <dir>]
                        [--prices <file>] [--roles <file>]
                        [--out <file> | --set <set> [--profile <path>]] [--json <file>]
                        [--breaches] [--critical-path --task-list <path>] [--budget <tokens>]

Reads ~/.claude/projects/<slug>/<session>.jsonl (the orchestrator) and
<session>/subagents/*.jsonl with their .meta.json (every agent it launched).

  --session <id>       a session id; repeatable, or comma-separated
  --all                every session in the project dir (with --since: those modified on or after it)
  --since <time>       ISO time (2026-11-25T09:30, or a date: local midnight); with --until, the
  --until <time>       window: only transcript lines timestamped inside it count, so an agent with
                       no line in it drops out and one running across an edge counts its part
                       inside (use the task list's started time and its last checkpoint)
  --project <dir>      project root whose slug to read (default: the nearest project root of the
                       current directory; inside a git worktree, the main checkout, found with
                       git rev-parse --git-common-dir, since the orchestrator runs there; the
                       worktree's own slug is the fallback); the slug is the absolute path with
                       every non-alphanumeric character replaced by "-"
  --slug <slug>        the slug itself; a value starting with "-" is fine (--slug -Users-me-my-app)
  --projects-root <d>  default ~/.claude/projects
  --prices <file>      JSON price table, USD per "per" tokens (default 1,000,000):
                         { "per": 1000000, "default": "<key>",
                           "models": { "<model id or prefix>": { "input": n, "cache_write": n,
                             "cache_write_1h": n, "cache_read": n, "output": n } } }
                       a model is priced by its exact id, else the longest matching prefix, else
                       "default"; without --prices the Cost column is omitted
  --roles <file>       JSON role patterns, matched in order against each agent's description:
                         { "main": "orchestrator", "default": "other",
                           "roles": [ { "role": "lane build", "pattern": "\\\\blane\\\\b" } ] }
                       patterns are case-insensitive regexes; without --roles the role is the
                       agent type from .meta.json
  --out <file>         write the Markdown here (default stdout)
  --set <set>          with no --out, write <logs_dir>/build-report-<set>.md, where logs_dir comes
                       from the profile (default "logs"), relative to the project root; this is
                       how /implement-batch and /workflow-sync call it
  --json <file>        also write the per-agent numbers as JSON
  --breaches           count rule breaches and print them as a table (also added to the report):
                         - a vitest command with no test path inside a lane worktree (a cwd or
                           "cd <dir>" under a task-list Worktree, or a "-wt/" path);
                         - typecheck:clean or tsc --build --force run by a lane;
                         - a rehearsal command (a profile gate of kind "rehearsal") run by a lane
                           or a verifier;
                         - a turn whose context is above limits.context_budget_tokens;
                         - the orchestrator's average context above 1.5 x that budget (restart it)
                       A lane is an agent whose description or role says "lane" (not a
                       verifier); a verifier, one that says "verif".
  --critical-path      with --task-list: the batch's elapsed time split into building (lanes,
                       integration fixes, and a verifier's fix work: from its first edit to its
                       commit), checking (verifiers; the orchestrator's test, typecheck, lint and
                       build runs), documents (design, blueprint and doc agents), other agents,
                       and waiting (nothing above running). Roles come from the task list's
                       Agents rows (Role, matched by Agent id to the transcript file), else the
                       description. Also the orchestrator's average context, and the time to
                       owner acceptance (task-list fields started and accepted_on_beta).
  --task-list <path>   the batch's task list (Agents rows, Worktree paths, started)
  --budget <tokens>    the context budget (default: the profile's limits.context_budget_tokens,
                       else 200000)

Per agent: turns (API responses, deduplicated by message id + request id), tokens (input,
cache write, cache read, output), cost, active minutes (the sum of gaps of at most 10 minutes
between timestamped lines), wall minutes, tool calls and calls per turn (tool_use blocks,
deduplicated by id), maximum context (input + cache write + cache read of one response), tool
errors and Bash commands by category (test, typecheck, lint, build, git, db, browser/http, wait,
read/search, other). Synthetic messages are skipped.

Exit: 0 written · 1 nothing found · 2 usage.`;

const GAP_S = 600;

export function bashCategory(c) {
  if (/test-select|vitest|jest|mocha|pytest|node --test|(npm|pnpm|yarn)( --filter \S+| -r)? test\b|run-flow|playwright|test:e2e|shard/.test(c)) return 'test';
  if (/\btsc\b|typecheck/.test(c)) return 'typecheck';
  if (/eslint|prettier|\blint/.test(c)) return 'lint';
  if (/(npm|pnpm|yarn) (-r |--filter \S+ )?(run )?build|turbo build|\bmake\b/.test(c)) return 'build';
  if (/^\s*(cd [^&;]+(&&|;)\s*)?git /.test(c) || c.slice(0, 80).includes('git ')) return 'git';
  if (/psql|docker|pg_|createdb|dropdb|db:migrate|mysql|redis-cli/.test(c)) return 'db';
  if (/curl|wget|agent-browser|chrom|screenshot|playwright-cli/.test(c)) return 'browser/http';
  if (/\bsleep\b|until |while /.test(c)) return 'wait';
  if (/^\s*(cat|sed|head|tail|grep|rg|ls|find|wc|awk|jq)\b/.test(c) || /(&&|;|\|)\s*(cat|sed|grep|rg)\b/.test(c)) return 'read/search';
  return 'other';
}

const TOKEN_KEYS = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'];

export function priceFor(prices, model) {
  if (!prices?.models) return null;
  if (prices.models[model]) return prices.models[model];
  const keys = Object.keys(prices.models).filter((k) => model && model.startsWith(k)).sort((a, b) => b.length - a.length);
  if (keys.length) return prices.models[keys[0]];
  return prices.default ? prices.models[prices.default] || null : null;
}

export function messageCost(prices, model, u) {
  const p = priceFor(prices, model);
  if (!p) return null;
  const per = prices.per || 1e6;
  const cw = u.cache_creation_input_tokens || 0;
  const cw1h = p.cache_write_1h !== undefined ? u.cache_creation?.ephemeral_1h_input_tokens || 0 : 0;
  return (
    ((u.input_tokens || 0) * (p.input || 0) +
      (cw - cw1h) * (p.cache_write || 0) +
      cw1h * (p.cache_write_1h || 0) +
      (u.cache_read_input_tokens || 0) * (p.cache_read || 0) +
      (u.output_tokens || 0) * (p.output || 0)) /
    per
  );
}

/** Parse --since/--until: an ISO time, or a bare date as local midnight. NaN when unparseable. */
export function parseTime(s) {
  if (!s) return null;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s;
  return Date.parse(t);
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const CHECK_CATS = new Set(['test', 'typecheck', 'lint', 'build']);

export function analyzeTranscript(path, prices, { since = null, until = null, budget = null } = {}) {
  const windowed = since !== null || until !== null;
  const inside = (t) => (since === null || t >= since) && (until === null || t <= until);
  let inWin = since === null;
  const seenMsg = new Set();
  const seenTool = new Set();
  const usage = Object.fromEntries(TOKEN_KEYS.map((k) => [k, 0]));
  const tools = {};
  const bash = {};
  const models = {};
  const times = [];
  let turns = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let maxCtx = 0;
  let cost = prices ? 0 : null;
  let unpriced = 0;
  let ctxSum = 0;
  let overBudget = 0;
  const commands = [];
  const marks = []; // { t, edit, commit, check, doc } per timestamped line, for --critical-path
  const pending = new Map(); // tool_use id -> { name, cat, path }
  let lastT = null;
  let cwd = '';
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof d.cwd === 'string') cwd = d.cwd;
    let mark = null;
    if (d.timestamp) {
      const t = Date.parse(d.timestamp);
      if (Number.isFinite(t)) {
        // A line without a timestamp belongs to the window of the last one that had one.
        inWin = !windowed || inside(t);
        if (inWin) {
          times.push(t);
          mark = { t };
          marks.push(mark);
          lastT = t;
        }
      }
    }
    if (!inWin) continue;
    const m = d.message;
    if (d.type === 'user' && Array.isArray(m?.content))
      for (const x of m.content) {
        if (x?.type !== 'tool_result') continue;
        if (x.is_error) toolErrors++;
        const p = pending.get(x.tool_use_id);
        if (p && mark) {
          if (p.name === 'Bash' && CHECK_CATS.has(p.cat)) mark.check = true;
          if (EDIT_TOOLS.has(p.name) && /\.md$/i.test(p.path || '')) mark.doc = true;
        }
      }
    if (d.type !== 'assistant' || !m) continue;
    for (const x of Array.isArray(m.content) ? m.content : []) {
      if (x?.type !== 'tool_use') continue;
      const id = x.id || `${m.id}:${toolCalls}`;
      if (seenTool.has(id)) continue;
      seenTool.add(id);
      toolCalls++;
      tools[x.name] = (tools[x.name] || 0) + 1;
      const info = { name: x.name, path: x.input?.file_path || x.input?.notebook_path || '' };
      if (x.name === 'Bash') {
        const command = String(x.input?.command || '');
        const c = bashCategory(command);
        bash[c] = (bash[c] || 0) + 1;
        info.cat = c;
        commands.push({ cmd: command, cwd, t: lastT });
        if (mark && /\bgit\b[^|;&]*\bcommit\b/.test(command)) mark.commit = true;
      }
      if (mark && EDIT_TOOLS.has(x.name)) mark.edit = true;
      pending.set(id, info);
    }
    const key = `${m.id}|${d.requestId}`;
    if (seenMsg.has(key)) continue;
    seenMsg.add(key);
    if (m.model === '<synthetic>') continue;
    const u = m.usage || {};
    turns++;
    models[m.model] = (models[m.model] || 0) + 1;
    for (const k of TOKEN_KEYS) usage[k] += u[k] || 0;
    const ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    maxCtx = Math.max(maxCtx, ctx);
    ctxSum += ctx;
    if (budget && ctx > budget) overBudget++;
    if (prices) {
      const c = messageCost(prices, m.model, u);
      if (c === null) unpriced++;
      else cost += c;
    }
  }
  times.sort((a, b) => a - b);
  let active = 0;
  for (let i = 1; i < times.length; i++) {
    const g = (times[i] - times[i - 1]) / 1000;
    if (g <= GAP_S) active += g;
  }
  const model = Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return {
    path,
    first: times.length ? new Date(times[0]).toISOString() : null,
    last: times.length ? new Date(times.at(-1)).toISOString() : null,
    activeMin: Math.round((active / 60) * 10) / 10,
    wallMin: times.length ? Math.round(((times.at(-1) - times[0]) / 60000) * 10) / 10 : 0,
    turns,
    usage,
    toolCalls,
    callsPerTurn: turns ? Math.round((toolCalls / turns) * 100) / 100 : 0,
    tools,
    bash,
    toolErrors,
    maxCtx,
    avgCtx: turns ? Math.round(ctxSum / turns) : 0,
    overBudget,
    model,
    models,
    cost,
    unpriced,
    commands,
    marks,
  };
}

export function roleOf(rolesCfg, agent) {
  if (agent.kind === 'main') return rolesCfg?.main || 'orchestrator';
  if (!rolesCfg?.roles) return agent.agentType || 'subagent';
  const text = agent.description || '';
  for (const r of rolesCfg.roles) if (new RegExp(r.pattern, 'i').test(text)) return r.role;
  return rolesCfg.default || 'other';
}

export const slugOf = (dir) => resolve(dir).replace(/[^A-Za-z0-9]/g, '-');

/** The project root whose transcripts to read: inside a linked worktree, the main checkout. */
export function mainCheckout(dir) {
  const r = git(dir, 'rev-parse', '--git-common-dir');
  const g = git(dir, 'rev-parse', '--git-dir');
  if (r.code !== 0 || g.code !== 0) return null;
  const common = resolve(dir, r.out);
  if (common === resolve(dir, g.out) || basename(common) !== '.git') return null;
  return dirname(common);
}

const hasActivity = (a) => a.turns > 0 || a.toolCalls > 0;

export function collect({ projectDir, sessions, prices, roles, window = {}, budget = null }) {
  const windowed = window.since != null || window.until != null;
  const agents = [];
  for (const s of sessions) {
    const main = join(projectDir, `${s}.jsonl`);
    if (existsSync(main)) agents.push({ kind: 'main', session: s, description: `main ${s.slice(0, 8)}`, ...analyzeTranscript(main, prices, { ...window, budget }) });
    const subDir = join(projectDir, s, 'subagents');
    let files = [];
    try {
      files = readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).sort();
    } catch {}
    for (const f of files) {
      const p = join(subDir, f);
      let meta = {};
      const mp = p.replace(/\.jsonl$/, '.meta.json');
      if (existsSync(mp))
        try {
          meta = JSON.parse(readFileSync(mp, 'utf8'));
        } catch {}
      agents.push({
        kind: 'sub',
        session: s,
        description: meta.description || basename(f, '.jsonl'),
        agentType: meta.agentType || '',
        file: basename(f, '.jsonl'),
        ...analyzeTranscript(p, prices, { ...window, budget }),
      });
    }
  }
  const kept = windowed ? agents.filter(hasActivity) : agents;
  for (const a of kept) a.role = roleOf(roles, a);
  return kept;
}

const n = (x) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${Math.round(x / 1e3)}k` : String(x));
const usd = (x) => (x === null || x === undefined ? '—' : `$${x.toFixed(2)}`);
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const top = (o, k = 3) =>
  Object.entries(o)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([c, v]) => `${c} ${v}`)
    .join(', ') || '—';

export function renderMarkdown(agents, { slug, sessions, pricesPath, rolesPath, sinceRaw, untilRaw }) {
  const priced = agents.some((a) => a.cost !== null);
  const L = [];
  L.push(`# Build report — ${sessions.length} session(s)`, '');
  L.push(`Generated ${nowStamp()} from \`${slug}\`. Prices: ${pricesPath || 'none'}. Roles: ${rolesPath || 'agent type'}.`);
  if (sinceRaw || untilRaw) L.push(`Window: ${sinceRaw || 'start'} to ${untilRaw || 'end'}; only transcript lines inside it count.`);
  L.push('Active minutes count gaps of at most 10 minutes. Turns are API responses, deduplicated.', '');

  const byRole = new Map();
  for (const a of agents) {
    const r = byRole.get(a.role) || { agents: 0, turns: 0, tools: 0, active: 0, in: 0, cw: 0, cr: 0, out: 0, cost: 0 };
    r.agents++;
    r.turns += a.turns;
    r.tools += a.toolCalls;
    r.active += a.activeMin;
    r.in += a.usage.input_tokens;
    r.cw += a.usage.cache_creation_input_tokens;
    r.cr += a.usage.cache_read_input_tokens;
    r.out += a.usage.output_tokens;
    r.cost += a.cost || 0;
    byRole.set(a.role, r);
  }
  const roleRows = [...byRole.entries()].sort((x, y) => (priced ? y[1].cost - x[1].cost : y[1].turns - x[1].turns));
  L.push('## By role', '');
  L.push(`| Role | Agents | Turns | Tool calls | Active min | Input | Cache write | Cache read | Output${priced ? ' | Cost' : ''} |`);
  L.push(`|---|---:|---:|---:|---:|---:|---:|---:|---:${priced ? '|---:' : ''}|`);
  const tot = { agents: 0, turns: 0, tools: 0, active: 0, in: 0, cw: 0, cr: 0, out: 0, cost: 0 };
  for (const [role, r] of roleRows) {
    for (const k of Object.keys(tot)) tot[k] += r[k];
    L.push(`| ${esc(role)} | ${r.agents} | ${r.turns} | ${r.tools} | ${r.active.toFixed(1)} | ${n(r.in)} | ${n(r.cw)} | ${n(r.cr)} | ${n(r.out)}${priced ? ` | ${usd(r.cost)}` : ''} |`);
  }
  L.push(`| **Total** | ${tot.agents} | ${tot.turns} | ${tot.tools} | ${tot.active.toFixed(1)} | ${n(tot.in)} | ${n(tot.cw)} | ${n(tot.cr)} | ${n(tot.out)}${priced ? ` | ${usd(tot.cost)}` : ''} |`, '');

  L.push('## By agent', '');
  L.push(`| Agent | Role | Model | Turns | Tool calls | Calls/turn | Max context | Active min | Wall min | Tool errors | Bash (top 3)${priced ? ' | Cost' : ''} |`);
  L.push(`|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|${priced ? '---:|' : ''}`);
  const sorted = [...agents].sort((x, y) => (priced ? (y.cost || 0) - (x.cost || 0) : y.turns - x.turns));
  for (const a of sorted)
    L.push(
      `| ${esc(a.description.slice(0, 60))} | ${esc(a.role)} | ${esc(a.model || '—')} | ${a.turns} | ${a.toolCalls} | ${a.callsPerTurn} | ${n(a.maxCtx)} | ${a.activeMin} | ${a.wallMin} | ${a.toolErrors} | ${esc(top(a.bash))}${priced ? ` | ${usd(a.cost)}${a.unpriced ? ` (${a.unpriced} unpriced)` : ''}` : ''} |`,
    );
  L.push('');
  return L.join('\n');
}

// ---------- rule breaches (--breaches) ----------

const isLane = (a) => a.kind === 'sub' && /\blane\b/i.test(`${a.description} ${a.role}`) && !/verif/i.test(`${a.description} ${a.role}`);
const isVerifier = (a) => a.kind === 'sub' && /verif/i.test(`${a.description} ${a.role}`);

const VITEST_VALUE_FLAGS = new Set(['--project', '--config', '-c', '--root', '-r', '--dir', '--reporter', '--shard', '--pool', '--environment', '-t', '--testNamePattern', '--outputFile']);

/** A vitest invocation in the command that names no test path (a whole-project run). */
export function vitestWithoutPath(cmd) {
  for (const seg of String(cmd).split(/&&|\|\||[;|\n]/)) {
    const toks = seg.trim().split(/\s+/);
    const i = toks.findIndex((x) => /(^|\/)vitest$/.test(x));
    if (i < 0) continue;
    let pathGiven = false;
    for (let j = i + 1; j < toks.length; j++) {
      const x = toks[j].replace(/^['"]|['"]$/g, '');
      if (['run', 'related', 'watch', 'bench', 'dev'].includes(x) && j === i + 1) continue;
      if (x.startsWith('-')) {
        if (VITEST_VALUE_FLAGS.has(x)) j++;
        continue;
      }
      if (x.includes('/') || /\.(test|spec)\.|\.[cm]?[jt]sx?$/.test(x)) pathGiven = true;
    }
    if (!pathGiven) return true;
  }
  return false;
}

/** The directory a command runs in: a leading "cd <dir> &&", else the line's cwd. */
const effectiveCwd = (c) => {
  const m = String(c.cmd).match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(&&|;)/);
  return m ? m[1].replace(/^['"]|['"]$/g, '') : c.cwd || '';
};

export function findBreaches(agents, { worktrees = [], rehearsals = [], budget = 200000 } = {}) {
  const inLaneWt = (dir) => !!dir && (worktrees.some((w) => dir === w || dir.startsWith(`${w}/`)) || /-wt\//.test(`${dir}/`));
  const rows = [
    { id: 'vitest-no-path', breach: 'vitest with no test path inside a lane worktree', hits: [] },
    { id: 'clean-typecheck', breach: 'typecheck:clean or tsc --build --force run by a lane', hits: [] },
    { id: 'rehearsal', breach: 'rehearsal command run by a lane or verifier', hits: [] },
    { id: 'over-budget', breach: `turn above the context budget (${n(budget)})`, hits: [] },
    { id: 'orchestrator-context', breach: `orchestrator average context above 1.5 x budget (${n(budget * 1.5)}): restart it`, hits: [] },
  ];
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  for (const a of agents) {
    for (const c of a.commands || []) {
      if (vitestWithoutPath(c.cmd) && (inLaneWt(effectiveCwd(c)) || isLane(a))) by['vitest-no-path'].hits.push(a.description);
      if (isLane(a) && /typecheck:clean|\btsc\b[^|;&]*(--build|\s-b\b)[^|;&]*--force/.test(c.cmd)) by['clean-typecheck'].hits.push(a.description);
      if ((isLane(a) || isVerifier(a)) && rehearsals.some((r) => r && c.cmd.includes(r))) by.rehearsal.hits.push(a.description);
    }
    for (let i = 0; i < (a.overBudget || 0); i++) by['over-budget'].hits.push(a.description);
    if (a.kind === 'main' && a.avgCtx > budget * 1.5) by['orchestrator-context'].hits.push(`${a.description} (avg ${n(a.avgCtx)})`);
  }
  return rows.map((r) => ({ id: r.id, breach: r.breach, count: r.hits.length, agents: [...new Set(r.hits)] }));
}

export function breachTable(rows) {
  const L = ['## Rule breaches', '', '| Breach | Count | Agents |', '|---|---:|---|'];
  for (const r of rows) L.push(`| ${esc(r.breach)} | ${r.count} | ${esc(r.agents.slice(0, 3).join('; ') + (r.agents.length > 3 ? ` +${r.agents.length - 3}` : '')) || '—'} |`);
  return L.join('\n');
}

// ---------- critical path (--critical-path) ----------

/** Role -> part: building, checking, documents, other; the orchestrator is "main". */
export function partOf(a, rowRole) {
  if (a.kind === 'main') return 'main';
  const r = String(rowRole || '').toLowerCase();
  if (/integration-fix|^lane|\bfix\b/.test(r)) return 'building';
  if (/verif/.test(r)) return 'checking';
  if (/design|doc|blueprint/.test(r)) return 'documents';
  const t = `${a.description} ${a.role || ''}`.toLowerCase();
  if (/verif|review|audit/.test(t)) return 'checking';
  if (/\blane\b|\bfix\b|implement|\bbuild/.test(t)) return 'building';
  if (/design|blueprint|wirefram|mockup|\bdocs?\b|\bplan\b|spec/.test(t)) return 'documents';
  return 'other';
}

/** An agent's active segments [start, end, part], gaps over 10 minutes dropped. */
export function segmentsOf(a, part) {
  const ms = (a.marks || []).slice().sort((x, y) => x.t - y.t);
  const out = [];
  let fixFrom = null; // a verifier's fix work: from its first edit after a commit to the next commit
  const fixWindows = [];
  for (const mk of ms) {
    if (mk.edit && fixFrom === null) fixFrom = mk.t;
    if (mk.commit && fixFrom !== null) {
      fixWindows.push([fixFrom, mk.t]);
      fixFrom = null;
    }
  }
  const inFix = (t0, t1) => fixWindows.some(([f, c]) => t0 >= f && t1 <= c);
  for (let i = 1; i < ms.length; i++) {
    const [t0, t1] = [ms[i - 1].t, ms[i].t];
    if (t1 - t0 > GAP_S * 1000 || t1 <= t0) continue;
    let p = part;
    if (part === 'checking' && inFix(t0, t1)) p = 'building';
    if (part === 'main') p = ms[i].check ? 'checking' : ms[i].doc ? 'documents' : null;
    if (p) out.push([t0, t1, p]);
  }
  return out;
}

const mergeIntervals = (xs) => {
  const s = xs.slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of s) {
    if (out.length && a <= out.at(-1)[1]) out.at(-1)[1] = Math.max(out.at(-1)[1], b);
    else out.push([a, b]);
  }
  return out;
};
const total = (xs) => xs.reduce((t, [a, b]) => t + (b - a), 0);

export const PARTS = ['building', 'checking', 'documents', 'other'];

/** Elapsed split by priority: time covered by building, then checking, documents, other; the rest is waiting. */
export function criticalPath(agents, rowRoles = new Map(), { start = null, end = null } = {}) {
  const segs = [];
  for (const a of agents) segs.push(...segmentsOf(a, partOf(a, rowRoles.get(a))));
  const all = agents.flatMap((a) => (a.marks || []).map((m) => m.t));
  const t0 = start ?? (all.length ? Math.min(...all) : 0);
  const t1 = end ?? (all.length ? Math.max(...all) : 0);
  const clip = (xs) => xs.map(([a, b]) => [Math.max(a, t0), Math.min(b, t1)]).filter(([a, b]) => b > a);
  const res = {};
  let covered = [];
  for (const p of PARTS) {
    const next = mergeIntervals([...covered, ...clip(segs.filter((x) => x[2] === p))]);
    res[p] = total(next) - total(covered);
    covered = next;
  }
  const elapsed = Math.max(0, t1 - t0);
  res.waiting = Math.max(0, elapsed - total(covered));
  res.elapsed = elapsed;
  return res;
}

/** Hours between the task list's started and accepted_on_beta, or null. */
export function acceptanceHours(fm) {
  const a = parseTime(stripCode(fm.accepted_on_beta || ''));
  const s = parseTime(stripCode(fm.started || ''));
  if (!Number.isFinite(a) || !Number.isFinite(s) || a === null || s === null) return null;
  return Math.round(((a - s) / 3600000) * 10) / 10;
}

export function criticalPathText(cp, { avgCtx, budget, acceptance }) {
  const min = (ms) => Math.round((ms / 60000) * 10) / 10;
  const share = (ms) => (cp.elapsed ? `${Math.round((ms / cp.elapsed) * 100)}%` : '—');
  const L = ['## Critical path', '', '| Part | Minutes | Share |', '|---|---:|---:|'];
  const label = { building: 'Building', checking: 'Checking', documents: 'Documents', other: 'Other agents', waiting: 'Waiting' };
  for (const p of [...PARTS, 'waiting']) L.push(`| ${label[p]} | ${min(cp[p])} | ${share(cp[p])} |`);
  L.push(`| **Elapsed** | ${min(cp.elapsed)} | 100% |`, '');
  const breach = avgCtx > budget * 1.5;
  L.push(`Orchestrator average context: ${n(avgCtx)} (budget ${n(budget)}; restart above ${n(budget * 1.5)})${breach ? ' — **BREACH: restart the orchestrator**' : ''}`);
  L.push(`Time to owner acceptance: ${acceptance === null ? 'not recorded (task list accepted_on_beta:)' : `${acceptance} h (started to accepted_on_beta)`}`);
  return L.join('\n');
}

/** Task-list Agents rows: Agent id -> Role, plus every Worktree path. */
export function readAgentsRows(text, base) {
  const t = readTable(text, 'Agents');
  const roles = new Map();
  const worktrees = [];
  if (!t) return { roles, worktrees };
  const cId = col(t.header, /agent id/i, /^id$/i);
  const cRole = col(t.header, /^role/i);
  const cWt = col(t.header, /worktree/i);
  for (const r of t.rows) {
    const id = stripCode(r._cells[cId] || '');
    if (id && cRole >= 0) roles.set(id, stripCode(r._cells[cRole] || ''));
    const wt = stripCode(r._cells[cWt] || '');
    if (wt) worktrees.push(resolve(base, wt.replace(/^~(?=\/)/, homedir())));
  }
  return { roles, worktrees };
}

/** The task-list role of each agent, matched by Agent id against its transcript file name. */
export function rolesByAgent(agents, idRoles) {
  const m = new Map();
  for (const a of agents) {
    if (a.kind !== 'sub') continue;
    for (const [id, role] of idRoles) {
      const f = a.file || '';
      if (f === id || f === `agent-${id}` || (id.length >= 6 && f.includes(id))) {
        m.set(a, role);
        break;
      }
    }
  }
  return m;
}

/** parseArgs refuses "--slug -x"; a slug always starts with "-", so join it as "--slug=-x". */
export function joinDashValues(argv, names = ['slug']) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (names.some((n) => a === `--${n}`) && i + 1 < argv.length && argv[i + 1].startsWith('-') && argv[i + 1] !== '--') out.push(`${a}=${argv[++i]}`);
    else out.push(a);
  }
  return out;
}

export function main(argv) {
  argv = joinDashValues(argv);
  const { flags } = args(
    {
      session: { type: 'string', multiple: true },
      all: { type: 'boolean' },
      since: { type: 'string' },
      until: { type: 'string' },
      project: { type: 'string' },
      slug: { type: 'string' },
      'projects-root': { type: 'string' },
      prices: { type: 'string' },
      roles: { type: 'string' },
      out: { type: 'string' },
      set: { type: 'string' },
      profile: { type: 'string' },
      json: { type: 'string' },
      breaches: { type: 'boolean' },
      'critical-path': { type: 'boolean' },
      'task-list': { type: 'string' },
      budget: { type: 'string' },
    },
    USAGE,
    argv,
  );
  if (flags['critical-path'] && !flags['task-list']) die('--critical-path needs --task-list <path>');
  const projectDirRoot = flags.project ? abs(flags.project) : projectRoot();
  const projectsRoot = abs(flags['projects-root'] || join(homedir(), '.claude', 'projects'));
  let slug = flags.slug;
  if (!slug) {
    const own = slugOf(projectDirRoot);
    const main = flags.project ? null : mainCheckout(projectDirRoot);
    slug = main && existsSync(join(projectsRoot, slugOf(main))) ? slugOf(main) : own;
  }
  const projectDir = join(projectsRoot, slug);
  if (!existsSync(projectDir)) die(`no transcripts at ${projectDir}`, 1);
  const since = parseTime(flags.since);
  const until = parseTime(flags.until);
  if (Number.isNaN(since)) die(`--since: not a time: ${flags.since}`);
  if (Number.isNaN(until)) die(`--until: not a time: ${flags.until}`);
  if (since !== null && until !== null && since > until) die('--since is after --until');
  let sessions = (flags.session || []).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  if (flags.all)
    sessions = readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl') && statSync(join(projectDir, f)).mtimeMs >= (since ?? 0))
      .map((f) => basename(f, '.jsonl'));
  if (!sessions.length) die(`give --session <id> or --all\n\n${USAGE}`);
  let prices = null;
  let roles = null;
  try {
    if (flags.prices) prices = readJson(abs(flags.prices), 'price table');
    if (flags.roles) roles = readJson(abs(flags.roles), 'roles file');
    for (const r of roles?.roles || []) new RegExp(r.pattern, 'i');
  } catch (e) {
    die(e.message);
  }
  const profilePath = flags.profile ? abs(flags.profile) : join(projectDirRoot, '.claude', 'workflow-profile.json');
  let profile = null;
  if (existsSync(profilePath))
    try {
      profile = readJson(profilePath, 'profile');
    } catch {}
  const budget = Number(flags.budget || profile?.limits?.context_budget_tokens || 200000);
  if (!Number.isFinite(budget) || budget <= 0) die(`--budget: not a token count: ${flags.budget}`);
  let tlText = null;
  if (flags['task-list']) {
    try {
      tlText = readFileSync(abs(flags['task-list']), 'utf8');
    } catch (e) {
      die(`cannot read task list ${flags['task-list']}: ${e.code || e.message}`);
    }
  }
  const agents = collect({ projectDir, sessions, prices, roles, window: { since, until }, budget });
  if (!agents.length)
    die(`no transcripts for ${sessions.join(', ')} in ${projectDir}${since !== null || until !== null ? ' inside the window' : ''}`, 1);
  let md = renderMarkdown(agents, { slug, sessions, pricesPath: flags.prices, rolesPath: flags.roles, sinceRaw: flags.since, untilRaw: flags.until });
  const tl = tlText ? readAgentsRows(tlText, dirname(abs(flags['task-list']))) : { roles: new Map(), worktrees: [] };
  let extra = '';
  if (flags.breaches) {
    const rehearsals = Object.entries(profile?.gates || {})
      .filter(([k, g]) => k !== 'notes' && g?.kind === 'rehearsal' && g.cmd)
      .map(([, g]) => g.cmd);
    const table = breachTable(findBreaches(agents, { worktrees: tl.worktrees, rehearsals, budget }));
    extra += `\n${table}\n`;
  }
  if (flags['critical-path']) {
    const cp = criticalPath(agents, rolesByAgent(agents, tl.roles), { start: since, end: until });
    const main = agents.find((a) => a.kind === 'main');
    const acceptance = acceptanceHours(frontmatter(tlText).fields);
    extra += `\n${criticalPathText(cp, { avgCtx: main?.avgCtx || 0, budget, acceptance })}\n`;
  }
  md += extra;

  let out = flags.out && abs(flags.out);
  if (!out && flags.set) out = resolve(projectDirRoot, profile?.logs_dir || 'logs', `build-report-${flags.set}.md`);
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${md}\n`);
    process.stderr.write(`build-report: ${agents.length} agent(s) → ${out}\n`);
    if (extra) process.stdout.write(`${extra.trim()}\n`);
  } else process.stdout.write(`${md}\n`);
  if (flags.json) {
    const j = abs(flags.json);
    mkdirSync(dirname(j), { recursive: true });
    writeFileSync(j, `${JSON.stringify(agents.map(({ commands, marks, ...a }) => a), null, 2)}\n`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
