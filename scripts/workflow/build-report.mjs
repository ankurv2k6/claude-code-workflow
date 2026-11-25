#!/usr/bin/env node
// Per-agent cost and effort of a build, from the session transcripts. Writes a Markdown report.

import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { args, die, abs, readJson, nowStamp, projectRoot } from './lib/common.mjs';

const USAGE = `build-report.mjs — tokens, cost and time per agent of a build, from the transcripts

Usage:
  node build-report.mjs (--session <id>… | --all [--since YYYY-MM-DD])
                        [--project <dir> | --slug <slug>] [--projects-root <dir>]
                        [--prices <file>] [--roles <file>]
                        [--out <file> | --set <set> [--profile <path>]] [--json <file>]

Reads ~/.claude/projects/<slug>/<session>.jsonl (the orchestrator) and
<session>/subagents/*.jsonl with their .meta.json (every agent it launched).

  --session <id>       a session id; repeatable, or comma-separated
  --all                every session in the project dir; --since keeps those modified on or after
  --project <dir>      project root whose slug to read (default: the nearest project root of the
                       current directory); the slug is the absolute path with every
                       non-alphanumeric character replaced by "-"
  --slug <slug>        the slug itself
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

export function analyzeTranscript(path, prices) {
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
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.timestamp) {
      const t = Date.parse(d.timestamp);
      if (Number.isFinite(t)) times.push(t);
    }
    const m = d.message;
    if (d.type === 'user' && Array.isArray(m?.content))
      for (const x of m.content) if (x?.type === 'tool_result' && x.is_error) toolErrors++;
    if (d.type !== 'assistant' || !m) continue;
    for (const x of Array.isArray(m.content) ? m.content : []) {
      if (x?.type !== 'tool_use') continue;
      const id = x.id || `${m.id}:${toolCalls}`;
      if (seenTool.has(id)) continue;
      seenTool.add(id);
      toolCalls++;
      tools[x.name] = (tools[x.name] || 0) + 1;
      if (x.name === 'Bash') {
        const c = bashCategory(String(x.input?.command || ''));
        bash[c] = (bash[c] || 0) + 1;
      }
    }
    const key = `${m.id}|${d.requestId}`;
    if (seenMsg.has(key)) continue;
    seenMsg.add(key);
    if (m.model === '<synthetic>') continue;
    const u = m.usage || {};
    turns++;
    models[m.model] = (models[m.model] || 0) + 1;
    for (const k of TOKEN_KEYS) usage[k] += u[k] || 0;
    maxCtx = Math.max(maxCtx, (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0));
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
    model,
    models,
    cost,
    unpriced,
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

export function collect({ projectDir, sessions, prices, roles }) {
  const agents = [];
  for (const s of sessions) {
    const main = join(projectDir, `${s}.jsonl`);
    if (existsSync(main)) agents.push({ kind: 'main', session: s, description: `main ${s.slice(0, 8)}`, ...analyzeTranscript(main, prices) });
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
        ...analyzeTranscript(p, prices),
      });
    }
  }
  for (const a of agents) a.role = roleOf(roles, a);
  return agents;
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

export function renderMarkdown(agents, { slug, sessions, pricesPath, rolesPath }) {
  const priced = agents.some((a) => a.cost !== null);
  const L = [];
  L.push(`# Build report — ${sessions.length} session(s)`, '');
  L.push(`Generated ${nowStamp()} from \`${slug}\`. Prices: ${pricesPath || 'none'}. Roles: ${rolesPath || 'agent type'}.`);
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

export function main(argv) {
  const { flags } = args(
    {
      session: { type: 'string', multiple: true },
      all: { type: 'boolean' },
      since: { type: 'string' },
      project: { type: 'string' },
      slug: { type: 'string' },
      'projects-root': { type: 'string' },
      prices: { type: 'string' },
      roles: { type: 'string' },
      out: { type: 'string' },
      set: { type: 'string' },
      profile: { type: 'string' },
      json: { type: 'string' },
    },
    USAGE,
    argv,
  );
  const projectDirRoot = flags.project ? abs(flags.project) : projectRoot();
  const slug = flags.slug || slugOf(projectDirRoot);
  const projectsRoot = abs(flags['projects-root'] || join(homedir(), '.claude', 'projects'));
  const projectDir = join(projectsRoot, slug);
  if (!existsSync(projectDir)) die(`no transcripts at ${projectDir}`, 1);
  let sessions = (flags.session || []).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  if (flags.all) {
    const since = flags.since ? Date.parse(`${flags.since}T00:00:00`) : 0;
    sessions = readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl') && statSync(join(projectDir, f)).mtimeMs >= since)
      .map((f) => basename(f, '.jsonl'));
  }
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
  const agents = collect({ projectDir, sessions, prices, roles });
  if (!agents.length) die(`no transcripts for ${sessions.join(', ')} in ${projectDir}`, 1);
  const md = renderMarkdown(agents, { slug, sessions, pricesPath: flags.prices, rolesPath: flags.roles });

  let out = flags.out && abs(flags.out);
  if (!out && flags.set) {
    const profilePath = flags.profile ? abs(flags.profile) : join(projectDirRoot, '.claude', 'workflow-profile.json');
    let logsDir = 'logs';
    if (existsSync(profilePath))
      try {
        logsDir = readJson(profilePath, 'profile').logs_dir || 'logs';
      } catch {}
    out = resolve(projectDirRoot, logsDir, `build-report-${flags.set}.md`);
  }
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${md}\n`);
    process.stderr.write(`build-report: ${agents.length} agent(s) → ${out}\n`);
  } else process.stdout.write(`${md}\n`);
  if (flags.json) {
    const j = abs(flags.json);
    mkdirSync(dirname(j), { recursive: true });
    writeFileSync(j, `${JSON.stringify(agents, null, 2)}\n`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
