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

Lane map (JSON, context/batch-briefs/<set>/lane-map.json):
  { "set": "x", "base": "<ref the lanes branch from>", "worktree_root": "../my-app-wt",
    "lanes": [ { "lane": "A", "modules": ["M1"], "tasks": ["T1", "T2"], "waits_on": ["C0"],
                 "merge_order": 2, "branch": "feat/x-a", "worktree": "<optional path>",
                 "ports": ["api", "web"], "test_db": true, "brief": "<optional path>",
                 "base": "<optional per-lane ref>" } ] }
  lane        the lane id: a module id (M12, M12a) or a lane or cross-cutting id (C0, C0-UI, PERF)
  modules     the modules the lane builds
  tasks       optional: the subset of those modules' tasks this lane builds (a split module); absent
              means every task
  waits_on    lanes that must have merged (or whose stubs C0 provides) before this one launches; []
              means it may start beside C0 when it consumes no contract under review
  merge_order 1, 2, … the order the orchestrator merges in
  ports       port names to allocate; absent: profile ports.names (default ["api"]); [] for none
  The scaffold reads lane, branch, worktree, base, ports, test_db and brief; it ignores modules,
  tasks, waits_on and merge_order, which /implement-batch reads (the task list records them).
  Defaults: branch lane/<set>-<lane>; worktree <worktree_root>/<set>-<lane>; worktree_root
  ../<repo name>-wt; test_db true when the profile has test_db.create.

Steps, in order:
  1. ports    allocate each lane's named ports via the registry (profile ports.registry, default
              .claude/ports.json). Never handed out: the registry's "allocations" (port -> holder),
              "taken" (a list of numbers, or of records holding them) and "fixed" (name -> number).
              Without ports.step or ports.offsets each name takes the next free port of ports.range
              (default 4400–4999). With either, a lane takes a free base port at range start +
              k * step and each name sits at base + ports.offsets.<name> (a name without an offset
              takes the next free one of 0, 1, 2…), e.g. step 10, offsets {"web": 2000}: api 4400,
              web 6400; the next lane api 4410, web 6410. {port} is the first name's port.
              A missing registry is seeded by scanning brief files (context/batch-briefs/ and
              --briefs-dir) for port numbers in range, so ports already handed out are not reused.
              Re-running reuses a lane's existing ports.
  2. worktree git worktree add -b <branch> <path> <base> (or onto an existing branch); an existing
              worktree on the same branch is kept. .lane/ is added to info/exclude.
  3. test DB  profile test_db.create with {name} {url} {port}, then test_db.bootstrap; the name
              comes from test_db.name_pattern ({set}, {lane}), {url} from test_db.url (default
              postgresql://{host}:{port}/{name}); test_db.host must be in allow_hosts.
  4. health   every gate of kind "health", once, in the repo root.
  5. smoke    in the first lane's worktree, with that lane's placeholders: commands.install, then
              commands.build (each when defined; always in a worktree this run creates, else only
              when --smoke-commands names it), then every "smoke": true gate, then the other
              commands --smoke-commands names (e.g. typecheck,test_lane_end: the test DBs exist by
              now). A failed install or build skips the rest of the smoke run. Every commands.*
              entry is rendered with the lane's values; an unfilled placeholder other than {files}
              is a failure. A staged-file gate passes on an empty index: it proves the hook runs,
              not that its tools work.
Without --apply nothing is created, written, run or committed: each step prints what it would do.
--apply creates worktrees, branches, the registry and test DBs, and runs commands; it commits nothing.

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

/** Port numbers a registry reserves outside allocations: "taken" and "fixed", in any nesting. */
export function reservedPorts(registry) {
  const out = new Set();
  const visit = (v) => {
    if (typeof v === 'string' && /^\d{1,5}$/.test(v)) v = Number(v);
    if (Number.isInteger(v)) {
      if (v > 0 && v < 65536) out.add(v);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(registry?.taken);
  visit(registry?.fixed);
  return out;
}

/** Offset of each name from the lane's base port: ports.offsets, else the next free 0, 1, 2… */
export function laneOffsets(names, offsets = {}) {
  const out = {};
  const used = new Set();
  for (const n of names) if (Number.isInteger(offsets[n])) used.add((out[n] = offsets[n]));
  let next = 0;
  for (const n of names) {
    if (n in out) continue;
    while (used.has(next)) next++;
    used.add((out[n] = next));
  }
  return out;
}

/**
 * Allocate each lane's named ports. Ports in registry allocations, "taken" and "fixed" are never
 * handed out. Without step or offsets each name takes the next free port of the range; with either,
 * a lane takes a base port (range start + k * step) and each name sits at base + its offset.
 */
export function allocatePorts(registry, lanes, set, [lo, hi], { step = 1, offsets = {} } = {}) {
  const alloc = registry.allocations;
  const taken = new Set([...Object.keys(alloc).map(Number), ...reservedPorts(registry)]);
  const block = step > 1 || Object.keys(offsets).some((k) => k !== 'notes');
  const result = {};
  const added = [];
  const take = (l, name, p) => {
    taken.add(p);
    alloc[p] = { set, lane: l.lane, name, date: today() };
    added.push(p);
    result[l.lane][name] = p;
  };
  const hitOf = (l, name) => Object.entries(alloc).find(([, a]) => a.set === set && a.lane === l.lane && a.name === name);
  for (const l of lanes) {
    result[l.lane] = {};
    const names = l.ports || [];
    if (!block) {
      for (const name of names) {
        const hit = hitOf(l, name);
        if (hit) {
          result[l.lane][name] = Number(hit[0]);
          continue;
        }
        let p = lo;
        while (p <= hi && taken.has(p)) p++;
        if (p > hi) throw new Error(`no free port left in ${lo}–${hi}`);
        take(l, name, p);
      }
      continue;
    }
    const off = laneOffsets(names, offsets);
    const hits = names.map((n) => [n, hitOf(l, n)]).filter(([, h]) => h);
    for (const [n, h] of hits) result[l.lane][n] = Number(h[0]);
    const missing = names.filter((n) => !(n in result[l.lane]));
    if (!missing.length) continue;
    let base;
    if (hits.length) {
      base = Number(hits[0][1][0]) - off[hits[0][0]];
      for (const n of missing)
        if (taken.has(base + off[n])) throw new Error(`lane ${l.lane}: port ${base + off[n]} for "${n}" (base ${base} + ${off[n]}) is taken`);
    } else {
      const fits = (b) => missing.every((n) => b + off[n] < 65536 && !taken.has(b + off[n]));
      for (let b = lo; b <= hi; b += step)
        if (fits(b)) {
          base = b;
          break;
        }
      if (base === undefined) throw new Error(`no free base port left in ${lo}–${hi} (step ${step}) for lane ${l.lane}`);
    }
    for (const n of missing) take(l, n, base + off[n]);
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
      ports: l.ports || profile?.ports?.names || ['api'],
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
  const { ports, added } = allocatePorts(registry, lanes, set, range, { step: profile?.ports?.step || 1, offsets: profile?.ports?.offsets || {} });
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
    l.fresh = true;
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
  const healthRan = new Set();
  for (const [name, g] of Object.entries(profile?.gates || {}))
    if (g?.kind === 'health') {
      healthRan.add(name);
      steps.push({ step: 'health', what: `${name}: ${g.cmd}`, run: g.cmd, cwd: repo });
    }

  // 5. smoke: in a fresh worktree, install and build come first, so the gates see a built tree
  if (!skipSmoke && profile) {
    // Smoke in a lane that has a test DB, so commands needing {url} or {name} can render; else the first lane.
    const l = lanes.find((x) => x.db) || lanes[0];
    const v = { lane: laneToken(l.lane), set: laneToken(set), base: l.base, port: Object.values(l.portMap)[0], name: l.db?.name, url: l.db?.url };
    const cmds = Object.entries(profile.commands || {}).filter(([k, c]) => k !== 'notes' && typeof c === 'string');
    const smokeCmd = (k, c, prep) => {
      const f = fill(c, v);
      const missing = f.missing.filter((m) => m !== 'files');
      const needsDb = missing.every((m) => m === 'url' || m === 'name');
      if (missing.length && needsDb && !l.db && !smokeCommands.includes(k))
        steps.push({ step: 'smoke', what: `commands.${k}: needs a lane with a test DB; not smoke-run`, skip: true });
      else if (missing.length) steps.push({ step: 'smoke', what: `commands.${k}: unfilled {${missing.join('}, {')}}`, error: true });
      else if (prep || smokeCommands.includes(k)) steps.push({ step: 'smoke', what: `commands.${k}: ${f.cmd}`, run: f.cmd, cwd: l.worktree, prep: !!prep, after: !prep });
      else steps.push({ step: 'smoke', what: `commands.${k}: renders`, skip: true });
    };
    const PREP = ['install', 'build'];
    for (const k of PREP) {
      const c = profile.commands?.[k];
      if (typeof c === 'string') smokeCmd(k, c, l.fresh || smokeCommands.includes(k));
    }
    for (const [name, g] of Object.entries(profile.gates || {})) {
      if (g?.smoke !== true || healthRan.has(name)) continue; // a health gate already ran in step 4
      const f = fill(g.cmd, v);
      if (f.missing.length) steps.push({ step: 'smoke', what: `gates.${name}: unfilled {${f.missing.join('}, {')}}`, error: true });
      else steps.push({ step: 'smoke', what: `gates.${name}: ${f.cmd}`, run: f.cmd, cwd: l.worktree, after: true });
    }
    for (const [k, c] of cmds) if (!PREP.includes(k)) smokeCmd(k, c, false);
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
  let prepFailed = '';
  for (const s of p.steps) {
    if (s.error || s.skip) {
      s.status = s.error ? 'fail' : 'skip';
      failed ||= !!s.error;
      continue;
    }
    if (s.after && prepFailed) {
      // A gate cannot pass on a tree whose install or build failed; that failure is the one to fix.
      s.status = 'skip';
      s.detail = `not run: ${prepFailed} failed`;
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
    if (s.prep && s.status === 'fail') prepFailed ||= s.what.split(':')[0];
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
