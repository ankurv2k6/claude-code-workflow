#!/usr/bin/env node
// Scaffold a batch's lanes from a lane map: worktrees, branches, ports, test DBs, health, smoke.

import { readFileSync, readdirSync, existsSync, mkdirSync, appendFileSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, die, abs, readJson, writeAtomic, withLock, fill, runShell, git, today, projectRoot } from './lib/common.mjs';
import { loadProfile, checkProfile, findSchema, dbUrl } from './lib/profile.mjs';

const USAGE = `scaffold.mjs — set up a batch's lanes from a lane map (dry run unless --apply)

Usage:
  node scaffold.mjs --lane-map <map.json> [--profile <path>] [--repo <dir>] [--apply]
                    [--briefs-dir <dir>]… [--smoke-commands <k1,k2>] [--skip-db] [--skip-smoke] [--json]

Lane map (JSON):
  { "set": "x", "base": "<ref the lanes branch from>", "worktree_root": "../my-app-wt",
    "lanes": [ { "lane": "A", "branch": "lane/x-a", "worktree": "<optional path>",
                 "ports": ["api", "web"], "test_db": true, "brief": "<optional path>",
                 "base": "<optional per-lane ref>" } ] }
  Defaults: branch lane/<set>-<lane>; worktree <worktree_root>/<set>-<lane>; worktree_root
  ../<repo name>-wt; test_db true when the profile has test_db.create.

Steps, in order:
  1. ports    allocate each lane's named ports from profile ports.range (default 4400–4999) via
              the registry (profile ports.registry, default .claude/ports.json). A missing
              registry is seeded by scanning brief files (context/batch-briefs/ and --briefs-dir)
              for port numbers in range, so ports already handed out are not reused.
              Re-running reuses a lane's existing ports.
  2. worktree git worktree add -b <branch> <path> <base> (or onto an existing branch); an existing
              worktree on the same branch is kept. .lane/ is added to info/exclude.
  3. test DB  profile test_db.create with {name} {url} {port}, then test_db.bootstrap; the name
              comes from test_db.name_pattern ({set}, {lane}); test_db.host must be in allow_hosts.
  4. health   every gate of kind "health", once, in the repo root.
  5. smoke    every "smoke": true gate in the first lane's worktree with that lane's
              placeholders; every commands.* entry is rendered with the lane's values and an
              unfilled placeholder other than {files} is a failure; --smoke-commands runs the
              named commands too.
Without --apply nothing is created, written or run: each step prints what it would do.

Exit: 0 ok · 1 a step failed · 2 usage.`;

const laneToken = (l) => String(l).toLowerCase().replace(/[^a-z0-9]+/g, '_');
const slug = (l) => String(l).toLowerCase().replace(/[^a-z0-9]+/g, '-');

function walkMd(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkMd(p, out);
    else if (/\.(md|txt)$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** Ports in range named on port-ish lines of the brief files. */
export function scanBriefPorts(dirs, [lo, hi], repo) {
  const found = {};
  for (const d of dirs)
    for (const f of walkMd(d)) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (!/port|localhost|127\.0\.0\.1|:\d{4,5}\b/i.test(line)) continue;
        for (const m of line.matchAll(/(?<![\d.])(\d{4,5})(?![\d.])/g)) {
          const n = Number(m[1]);
          if (n >= lo && n <= hi && !found[n]) found[n] = { seeded: true, source: relative(repo, f) };
        }
      }
    }
  return found;
}

export function allocatePorts(registry, lanes, set, [lo, hi]) {
  const alloc = registry.allocations;
  const taken = new Set(Object.keys(alloc).map(Number));
  const result = {};
  const added = [];
  for (const l of lanes) {
    result[l.lane] = {};
    for (const name of l.ports || []) {
      const hit = Object.entries(alloc).find(([, a]) => a.set === set && a.lane === l.lane && a.name === name);
      if (hit) {
        result[l.lane][name] = Number(hit[0]);
        continue;
      }
      let p = lo;
      while (p <= hi && taken.has(p)) p++;
      if (p > hi) throw new Error(`no free port left in ${lo}–${hi}`);
      taken.add(p);
      alloc[p] = { set, lane: l.lane, name, date: today() };
      added.push(p);
      result[l.lane][name] = p;
    }
  }
  return { ports: result, added };
}

export function plan({ map, profile, repo, briefsDirs = [], skipDb, skipSmoke, smokeCommands = [] }) {
  const set = map.set;
  if (!set) throw new Error('lane map needs "set"');
  if (!Array.isArray(map.lanes) || !map.lanes.length) throw new Error('lane map needs a non-empty "lanes" array');
  const root = map.worktree_root ? resolve(repo, map.worktree_root) : resolve(repo, '..', `${repo.split('/').pop()}-wt`);
  const db = profile?.test_db;
  const lanes = map.lanes.map((l) => {
    if (!l.lane) throw new Error('every lane needs "lane"');
    const base = l.base || map.base;
    if (!base) throw new Error(`lane ${l.lane}: no base (set "base" on the map or the lane)`);
    const out = {
      lane: l.lane,
      branch: l.branch || `lane/${slug(set)}-${slug(l.lane)}`,
      worktree: l.worktree ? resolve(repo, l.worktree) : join(root, `${slug(set)}-${slug(l.lane)}`),
      base,
      ports: l.ports || [],
      brief: l.brief,
    };
    const wantDb = l.test_db ?? !!db?.create;
    if (wantDb && db && !skipDb) {
      const name = fill(db.name_pattern || '{set}_{lane}_test', { set: laneToken(set), lane: laneToken(l.lane) }, { quote: false }).cmd;
      out.db = { name, url: dbUrl(db, name) };
    }
    return out;
  });

  // 1. ports
  const range = profile?.ports?.range || [4400, 4999];
  const regPath = resolve(repo, profile?.ports?.registry || '.claude/ports.json');
  let registry;
  let seeded = null;
  if (existsSync(regPath)) registry = readJson(regPath, 'port registry');
  else {
    const dirs = [join(repo, 'context', 'batch-briefs'), ...briefsDirs.map((d) => resolve(repo, d))];
    seeded = scanBriefPorts(dirs, range, repo);
    registry = { version: 1, range, allocations: { ...seeded } };
  }
  registry.allocations ||= {};
  const { ports, added } = allocatePorts(registry, lanes, set, range);
  for (const l of lanes) l.portMap = ports[l.lane];

  const steps = [];
  if (seeded) steps.push({ step: 'ports', what: `seed ${relative(repo, regPath)} with ${Object.keys(seeded).length} port(s) found in briefs: ${Object.keys(seeded).join(', ') || 'none'}` });
  if (added.length || seeded)
    steps.push({ step: 'ports', what: `write ${relative(repo, regPath)} (+${added.length}: ${added.join(', ') || 'none'})`, write: { path: regPath, registry } });

  // 2. worktrees
  for (const l of lanes) {
    if (existsSync(l.worktree)) {
      const b = git(l.worktree, 'rev-parse', '--abbrev-ref', 'HEAD');
      if (b.code === 0 && b.out === l.branch) steps.push({ step: 'worktree', lane: l.lane, what: `keep ${l.worktree} (on ${l.branch})`, skip: true });
      else steps.push({ step: 'worktree', lane: l.lane, what: `${l.worktree} exists but is not on ${l.branch}`, error: true });
      continue;
    }
    const hasBranch = git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${l.branch}`).code === 0;
    if (!hasBranch && git(repo, 'rev-parse', '--verify', '--quiet', `${l.base}^{commit}`).code !== 0) {
      steps.push({ step: 'worktree', lane: l.lane, what: `base ${l.base} is not a commit`, error: true });
      continue;
    }
    const argv = hasBranch ? ['worktree', 'add', l.worktree, l.branch] : ['worktree', 'add', '-b', l.branch, l.worktree, l.base];
    steps.push({ step: 'worktree', lane: l.lane, what: `git ${argv.join(' ')}`, git: argv, worktree: l.worktree });
  }

  // 3. test DBs
  if (db && !skipDb)
    for (const l of lanes.filter((x) => x.db)) {
      if (Array.isArray(db.allow_hosts) && !db.allow_hosts.includes(db.host || '127.0.0.1')) {
        steps.push({ step: 'test-db', lane: l.lane, what: `refused: test_db.host ${db.host} is not in allow_hosts`, error: true });
        continue;
      }
      const v = { name: l.db.name, url: l.db.url, port: db.port, lane: laneToken(l.lane), set: laneToken(set) };
      if (db.create) steps.push({ step: 'test-db', lane: l.lane, what: fill(db.create, v).cmd, run: fill(db.create, v).cmd, cwd: repo });
      if (db.bootstrap) steps.push({ step: 'test-db', lane: l.lane, what: fill(db.bootstrap, v).cmd, run: fill(db.bootstrap, v).cmd, cwd: repo });
    }

  // 4. health gates
  for (const [name, g] of Object.entries(profile?.gates || {}))
    if (g?.kind === 'health') steps.push({ step: 'health', what: `${name}: ${g.cmd}`, run: g.cmd, cwd: repo });

  // 5. smoke
  if (!skipSmoke && profile) {
    const l = lanes[0];
    const v = { lane: laneToken(l.lane), set: laneToken(set), base: l.base, port: Object.values(l.portMap)[0], name: l.db?.name, url: l.db?.url };
    for (const [name, g] of Object.entries(profile.gates || {})) {
      if (g?.smoke !== true) continue;
      const f = fill(g.cmd, v);
      if (f.missing.length) steps.push({ step: 'smoke', what: `gates.${name}: unfilled {${f.missing.join('}, {')}}`, error: true });
      else steps.push({ step: 'smoke', what: `gates.${name}: ${f.cmd}`, run: f.cmd, cwd: l.worktree });
    }
    for (const [k, c] of Object.entries(profile.commands || {})) {
      if (k === 'notes') continue;
      const f = fill(c, v);
      const missing = f.missing.filter((m) => m !== 'files');
      if (missing.length) steps.push({ step: 'smoke', what: `commands.${k}: unfilled {${missing.join('}, {')}}`, error: true });
      else if (smokeCommands.includes(k)) steps.push({ step: 'smoke', what: `commands.${k}: ${f.cmd}`, run: f.cmd, cwd: l.worktree });
      else steps.push({ step: 'smoke', what: `commands.${k}: renders`, skip: true });
    }
  }
  return { set, repo, lanes, steps };
}

function excludeLane(worktree) {
  const r = git(worktree, 'rev-parse', '--git-path', 'info/exclude');
  if (r.code !== 0) return;
  const p = resolve(worktree, r.out);
  mkdirSync(dirname(p), { recursive: true });
  const cur = existsSync(p) ? readFileSync(p, 'utf8') : '';
  if (!/^\.lane\/?$/m.test(cur)) appendFileSync(p, `${cur && !cur.endsWith('\n') ? '\n' : ''}.lane/\n`);
  mkdirSync(join(worktree, '.lane'), { recursive: true });
}

export function execute(p, profile) {
  let failed = false;
  for (const s of p.steps) {
    if (s.error || s.skip) {
      s.status = s.error ? 'fail' : 'skip';
      failed ||= !!s.error;
      continue;
    }
    if (s.write) {
      withLock(s.write.path, () => {
        mkdirSync(dirname(s.write.path), { recursive: true });
        // Merge with whatever another scaffold wrote since we read it.
        const cur = existsSync(s.write.path) ? readJson(s.write.path, 'port registry') : { allocations: {} };
        const merged = { ...s.write.registry, allocations: { ...s.write.registry.allocations, ...(cur.allocations || {}) } };
        writeAtomic(s.write.path, `${JSON.stringify(merged, null, 2)}\n`);
      });
      s.status = 'done';
    } else if (s.git) {
      const r = git(p.repo, ...s.git);
      s.status = r.code === 0 ? 'done' : 'fail';
      if (r.code === 0) excludeLane(s.worktree);
      else s.detail = r.err;
    } else if (s.run) {
      if (s.cwd && !existsSync(s.cwd)) {
        s.status = 'fail';
        s.detail = `no directory ${s.cwd}`;
      } else {
        const r = runShell(s.run, { prefix: profile?.shell_prefix, cwd: s.cwd });
        s.status = r.code === 0 ? 'done' : 'fail';
        s.exit = r.code;
        if (r.code) s.detail = (r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | ');
      }
    } else s.status = 'done';
    failed ||= s.status === 'fail';
  }
  return failed;
}

export function render(p, applied) {
  const lines = [`scaffold ${p.set} — ${applied ? 'APPLIED' : 'dry run (nothing created; --apply to run)'}`, ''];
  lines.push('| Lane | Branch | Worktree | Base | Ports | Test DB |', '|---|---|---|---|---|---|');
  for (const l of p.lanes)
    lines.push(`| ${l.lane} | ${l.branch} | ${l.worktree} | ${l.base} | ${Object.entries(l.portMap).map(([k, v]) => `${k} ${v}`).join(', ') || '—'} | ${l.db?.name || '—'} |`);
  lines.push('');
  for (const s of p.steps) {
    const tag = applied ? s.status : s.error ? 'fail' : s.skip ? 'skip' : 'would';
    lines.push(`[${tag}] ${s.step}${s.lane ? ` ${s.lane}` : ''}: ${s.what}${s.detail ? `  — ${s.detail}` : ''}`);
  }
  return lines.join('\n');
}

export function main(argv) {
  const { flags } = args(
    {
      'lane-map': { type: 'string' },
      profile: { type: 'string' },
      repo: { type: 'string' },
      apply: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'briefs-dir': { type: 'string', multiple: true },
      'smoke-commands': { type: 'string' },
      'skip-db': { type: 'boolean' },
      'skip-smoke': { type: 'boolean' },
      json: { type: 'boolean' },
    },
    USAGE,
    argv,
  );
  if (!flags['lane-map']) die(`--lane-map is required\n\n${USAGE}`);
  if (flags.apply && flags['dry-run']) die('--apply and --dry-run are exclusive');
  const repo = flags.repo ? abs(flags.repo) : projectRoot();
  const profilePath = flags.profile ? abs(flags.profile) : join(repo, '.claude', 'workflow-profile.json');
  let map, profile, p;
  try {
    map = readJson(abs(flags['lane-map']), 'lane map');
    profile = loadProfile(profilePath);
    if (profile) {
      const errs = checkProfile(profile, findSchema().schema);
      if (errs.length) die(`profile ${profilePath} is invalid:\n  ${errs.join('\n  ')}`, 1);
    }
    p = plan({
      map,
      profile,
      repo,
      briefsDirs: flags['briefs-dir'] || [],
      skipDb: flags['skip-db'],
      skipSmoke: flags['skip-smoke'],
      smokeCommands: (flags['smoke-commands'] || '').split(',').filter(Boolean),
    });
  } catch (e) {
    die(`scaffold: ${e.message}`, 1);
  }
  const failed = flags.apply ? execute(p, profile) : p.steps.some((s) => s.error);
  if (flags.json) {
    const clean = { ...p, steps: p.steps.map(({ write, ...s }) => s) };
    process.stdout.write(`${JSON.stringify({ applied: !!flags.apply, ...clean }, null, 2)}\n`);
  } else process.stdout.write(`${render(p, flags.apply)}\n`);
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
