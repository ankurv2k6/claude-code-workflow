'use strict';
// fleet lanes: one unattended Claude Code session per lane, on a worker, in its own git worktree, with its
// own port block and whatever its project recipe sets up. Driven from the iMac; workers hold no GitHub credentials,
// so the iMac pushes the base commit to a worker over SSH and fetches the lane branch back.
//
// On a worker, per project:  ~/work/<project>/repo.git           bare repo the iMac pushes into
//                            ~/work/<project>/wt/<lane>          the lane's worktree (branch <lane branch>)
//                            ~/work/<project>/lanes/<lane>/      recipe copy, env, prompt, logs, exit code
// On the iMac:               ~/.fleet/projects                   "<name> <repo path>" per line, written on first use
//                            ~/.fleet/lanes/<project>__<lane>.json
//                            ~/.fleet/lanes-archive/             logs of removed lanes
//
// Any git repo works with no setup: "fleet lane . <lane>" registers the repo it runs in under its folder name. A
// project recipe is optional (in the repo, read from the iMac checkout at dispatch time); without one, the default
// recipe in recipes/default/ gives the lane its worktree and nothing more:
//   .fleet/project.toml   memory_gb (a build lane's memory, default 4), effort, model
//   .fleet/lane.sh        `lane.sh up` prepares the worktree (deps, databases, …) and may write KEY=VALUE lines to
//                         "$FLEET_LANE_DIR/env" for the session; `lane.sh down` undoes it. Both run in the worktree
//                         with FLEET_PROJECT, FLEET_LANE, FLEET_SLOT, FLEET_PORT_BASE (a block of 100), FLEET_MEM_GB,
//                         FLEET_LANE_DIR and FLEET_WORKTREE set.
//
// Placement: each worker's line in ~/.fleet/workers caps its lanes (slots for build lanes, research_slots for research
// lanes) and may set mem_gb, the memory lanes may reserve (default: the worker's memory less 2 GB). A lane reserves
// memory_gb (research lanes: 1 GB). Without --host, a lane goes to the worker with the most unreserved memory that has
// a free slot and enough memory available right now; with none, fleet lane refuses rather than overload one.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { HOME, STATE_DIR, FLEET_DIR, say, fail, shq, now, sleep, workers, remote, run, parseArgs, withFileLock } = require('./common');

const PROJECTS_FILE = path.join(STATE_DIR, 'projects');
const LANES_DIR = path.join(STATE_DIR, 'lanes');
const ARCHIVE_DIR = path.join(STATE_DIR, 'lanes-archive');
const PORT_START = 20000; // full lanes: 20000, 20100, …
const RESEARCH_PORT_START = 25000; // research lanes: 25000, 25100, … (they rarely start anything)
const PORT_BLOCK = 100;
const NAME_SHAPE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RESEARCH_MEM_GB = 1; // a research lane is one claude process
const OS_RESERVE_GB = 2; // left for the worker's own system when inventory sets no mem_gb
const DEFAULT_RECIPE = path.join(FLEET_DIR, 'recipes', 'default');

// ---------- projects and lanes ----------

function parseToml(text) {
  // The subset project.toml needs: [table], key = "string" | number | true/false | ["a", "b"].
  const out = {};
  let table = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const t = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (t) {
      table = t[1];
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) throw new Error(`project.toml: cannot read "${raw.trim()}"`);
    let v = kv[2].trim();
    if (/^".*"$/.test(v)) v = v.slice(1, -1);
    else if (v === 'true' || v === 'false') v = v === 'true';
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    else if (/^\[.*\]$/.test(v)) v = JSON.parse(v);
    else throw new Error(`project.toml: unquoted value "${v}"`);
    out[table ? `${table}.${kv[1]}` : kv[1]] = v;
  }
  return out;
}

function projects() {
  let text = '';
  try {
    text = fs.readFileSync(PROJECTS_FILE, 'utf8');
  } catch {}
  const out = {};
  for (const l of text.split('\n')) {
    const line = l.replace(/#.*/, '').trim();
    if (!line) continue;
    const [name, ...rest] = line.split(/\s+/);
    out[name] = rest.join(' ').replace(/^~(?=\/)/, HOME);
  }
  return out;
}

const realOr = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

function register(repo) {
  return withFileLock('projects', () => {
    const known = projects(); // read again under the lock: another window may have registered it a moment ago
    const found = Object.keys(known).find((k) => realOr(known[k]) === realOr(repo));
    if (found) return found;
    const base = path.basename(repo).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'repo';
    let name = base;
    for (let i = 2; known[name]; i++) name = `${base}-${i}`;
    let text = '';
    try {
      text = fs.readFileSync(PROJECTS_FILE, 'utf8');
    } catch {}
    fs.writeFileSync(PROJECTS_FILE, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${name} ${repo}\n`);
    say(`registered project ${name} → ${repo} (${PROJECTS_FILE})`);
    return name;
  });
}

// A project is named one of three ways: a name from ~/.fleet/projects, "." for the git repo the command runs in, or
// a path to a repo. A repo used for the first time is registered under its folder name. A lane starts from the
// checkout it was started in (a linked worktree included: its base, brief and recipe come from there), and its branch
// comes back to the main repo, which every worktree of it shares.
function project(arg) {
  const known = projects();
  let checkout = known[arg];
  if (!checkout) {
    if (arg !== '.' && !/[/~]/.test(arg)) fail(`unknown project ${arg}: run fleet inside its repo and name it ".", or give the repo's path`);
    const dir = path.resolve(arg.replace(/^~(?=\/|$)/, HOME));
    const top = run('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { check: false });
    if (top.status !== 0) fail(`${dir} is not in a git repository`);
    checkout = top.stdout.trim();
  }
  const common = path.resolve(checkout, run('git', ['-C', checkout, 'rev-parse', '--git-common-dir']).stdout.trim());
  const repo = path.basename(common) === '.git' ? path.dirname(common) : common;
  const name = known[arg] ? arg : register(repo);
  const own = path.join(checkout, '.fleet');
  const toml = path.join(own, 'project.toml');
  const cfg = fs.existsSync(toml) ? parseToml(fs.readFileSync(toml, 'utf8')) : {};
  const ownRecipe = fs.existsSync(path.join(own, 'lane.sh'));
  return { name, repo, checkout, cfg, recipeDir: ownRecipe ? own : DEFAULT_RECIPE, ownRecipe };
}

const laneFile = (p, l) => path.join(LANES_DIR, `${p}__${l}.json`);
const sessionName = (p, l) => `${p}-${l}`;
const remotePaths = (p, l) => ({
  bare: `work/${p}/repo.git`,
  wt: `work/${p}/wt/${l}`,
  dir: `work/${p}/lanes/${l}`,
});

function allLanes() {
  let files = [];
  try {
    files = fs.readdirSync(LANES_DIR).filter((f) => f.endsWith('.json'));
  } catch {}
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(LANES_DIR, f), 'utf8')));
}

function readLane(id) {
  let [p, l] = String(id || '').split('/');
  if (!p || !l) fail('name the lane as <project>/<lane> (or ./<lane> inside the repo)');
  if (p === '.') p = project('.').name;
  const f = laneFile(p, l);
  if (!fs.existsSync(f)) fail(`no lane ${p}/${l} (fleet status lists them)`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function writeLane(L) {
  fs.mkdirSync(LANES_DIR, { recursive: true });
  fs.writeFileSync(laneFile(L.project, L.lane), `${JSON.stringify(L, null, 2)}\n`);
}

function laneEnv(L) {
  const R = remotePaths(L.project, L.lane);
  return {
    FLEET_PROJECT: L.project,
    FLEET_LANE: L.lane,
    FLEET_PROFILE: L.profile || 'build',
    FLEET_SETTINGS: `$HOME/.config/fleet/${L.settings || 'lane-settings.json'}`,
    FLEET_SLOT: String(L.slot),
    FLEET_PORT_BASE: String(L.portBase),
    FLEET_MEM_GB: String(L.memGb),
    FLEET_LANE_DIR: `$HOME/${R.dir}`,
    FLEET_WORKTREE: `$HOME/${R.wt}`,
    FLEET_EFFORT: L.effort,
    FLEET_MODEL: L.model || '',
    FLEET_AGENT: L.agent || '',
    LC_COLLATE: 'C', // sort as the Mac does (its LANG is unset); Ubuntu's C.UTF-8 orders differently
    ...(L.passEnv || {}),
  };
}

// Session settings from the iMac's shell that a lane should share. Never secrets.
const PASS_ENV = ['CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'MAX_THINKING_TOKENS'];

// ---------- the lane's files: the checkout as it is, not just its last commit ----------

const gitIn = (dir, args, { env, input } = {}) =>
  spawnSync('git', ['-C', dir, ...args], { env: env || process.env, input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// A snapshot commit on top of HEAD that holds the checkout's uncommitted and untracked (not ignored) files. It is
// built in a copy of the index, so the owner's own index and working tree are untouched. fetch replays the lane's
// commits onto HEAD, so the snapshot never reaches a branch the owner merges. Returns null when nothing is uncommitted.
function snapshot(checkout, head) {
  const idx = path.join(os.tmpdir(), `fleet-index-${process.pid}`);
  const real = gitIn(checkout, ['rev-parse', '--path-format=absolute', '--git-path', 'index']).stdout.trim();
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  const g = (args, input) => {
    const r = gitIn(checkout, args, { env, input });
    if (r.status !== 0) throw new Error(`git ${args[0]}: ${(r.stderr || '').trim().split('\n').pop()}`);
    return r.stdout.trim();
  };
  try {
    if (fs.existsSync(real)) fs.copyFileSync(real, idx); // keeps git's stat cache, so only changed files are hashed
    else g(['read-tree', head]);
    g(['add', '-A']);
    const tree = g(['write-tree']);
    if (tree === g(['rev-parse', `${head}^{tree}`])) return null;
    const count = g(['diff', '--cached', '--name-only', head]).split('\n').filter(Boolean).length;
    const sha = g(['commit-tree', '--no-gpg-sign', tree, '-p', head, '-m', `fleet snapshot: uncommitted work in ${checkout} at dispatch`]);
    return { sha, count };
  } finally {
    fs.rmSync(idx, { force: true });
  }
}

// Gitignored files (data, scratch notes, build output) reach a lane through a mirror of the checkout on the worker,
// kept current by rsync (only changes travel after the first copy) and hard-linked into each worktree. Left out:
// .git, and node_modules and .venv (built for macOS; a lane installs them if it needs them). A project can leave out
// more with sync_exclude = ["path/", …] in .fleet/project.toml.
const SYNC_EXCLUDES = ['.git', 'node_modules', '.venv', '.DS_Store'];

function syncFiles(host, P) {
  const key = `${path.basename(P.checkout).replace(/[^A-Za-z0-9._-]/g, '-')}-${require('crypto').createHash('sha1').update(P.checkout).digest('hex').slice(0, 8)}`;
  const mirror = `work/${P.name}/mirror/${key}`;
  const excludes = [...SYNC_EXCLUDES, ...(Array.isArray(P.cfg.sync_exclude) ? P.cfg.sync_exclude : [])];
  return withFileLock(
    `mirror-${host}-${P.name}-${key}`,
    () => {
      remote(host, `mkdir -p ~/${mirror}`);
      const t0 = Date.now();
      const r = run('rsync', ['-a', '--delete', '--stats', ...excludes.flatMap((e) => ['--exclude', e]), `${P.checkout}/`, `${host}:${mirror}/`]);
      const sent = Number((/Total transferred file size: ([\d,]+)/.exec(r.stdout) || [0, '0'])[1].replace(/,/g, ''));
      return { mirror, excludes, secs: Math.round((Date.now() - t0) / 1000), sentMb: Math.round(sent / 1048576) };
    },
    6 * 3600 * 1000, // a first copy of a large checkout can take a while; a second window waits for it
  );
}

// The iMac's project memory (keyed by the repo's path), copied for the lane. Claude keys a worker lane's memory by
// its bare repo. A read-only copy in effect: --delete drops whatever a lane wrote there.
function syncMemory(host, P, remoteHome) {
  const local = path.join(HOME, '.claude', 'projects', P.repo.replace(/[^A-Za-z0-9]/g, '-'), 'memory');
  if (!fs.existsSync(local)) return false;
  const key = `${remoteHome}/${remotePaths(P.name, 'x').bare}`.replace(/[^A-Za-z0-9]/g, '-');
  remote(host, `mkdir -p ~/.claude/projects/${key}/memory`);
  run('rsync', ['-a', '--delete', `${local}/`, `${host}:.claude/projects/${key}/memory/`]);
  return true;
}

// Replays a lane's commits (made on top of the snapshot) onto the owner's HEAD at dispatch, one by one, in a temporary
// index, so the snapshot's own changes stay out of the lane branch. Returns { sha } or { conflict }.
function replay(repo, from, to, onto) {
  const commits = run('git', ['-C', repo, 'rev-list', '--reverse', '--topo-order', `${from}..${to}`]).stdout.split('\n').filter(Boolean);
  const idx = path.join(os.tmpdir(), `fleet-replay-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  try {
    if (gitIn(repo, ['read-tree', onto], { env }).status !== 0) return { conflict: `cannot read ${onto}` };
    let parent = onto;
    for (const c of commits) {
      const short = c.slice(0, 9);
      if (run('git', ['-C', repo, 'rev-list', '--parents', '-n', '1', c]).stdout.trim().split(' ').length !== 2) {
        return { conflict: `${short} is a merge commit` };
      }
      const diff = gitIn(repo, ['diff', '--binary', '--full-index', `${c}^`, c]).stdout;
      if (diff) {
        const a = gitIn(repo, ['apply', '--cached', '--binary'], { env, input: diff });
        if (a.status !== 0) return { conflict: `${short} does not apply to HEAD: ${(a.stderr || '').trim().split('\n')[0]}` };
      }
      const tree = gitIn(repo, ['write-tree'], { env }).stdout.trim();
      const [an, ae, ad, cn, ce, cd] = run('git', ['-C', repo, 'log', '-1', '--format=%an%n%ae%n%aD%n%cn%n%ce%n%cD', c]).stdout.split('\n');
      const msg = run('git', ['-C', repo, 'log', '-1', '--format=%B', c]).stdout;
      const ids = { GIT_AUTHOR_NAME: an, GIT_AUTHOR_EMAIL: ae, GIT_AUTHOR_DATE: ad, GIT_COMMITTER_NAME: cn, GIT_COMMITTER_EMAIL: ce, GIT_COMMITTER_DATE: cd };
      const r = gitIn(repo, ['commit-tree', '--no-gpg-sign', tree, '-p', parent], { env: { ...process.env, ...ids }, input: msg });
      if (r.status !== 0) throw new Error(`git commit-tree: ${(r.stderr || '').trim()}`);
      parent = r.stdout.trim();
    }
    return { sha: parent };
  } finally {
    fs.rmSync(idx, { force: true });
  }
}

// "export K=V" lines; $HOME stays unquoted so the worker expands it.
const exportLines = (env) =>
  Object.entries(env)
    .map(([k, v]) => `export ${k}=${v.startsWith('$HOME/') ? `"${v}"` : shq(v)}`)
    .join('\n');

// ---------- the workflow commands on a worker ----------

function syncWorkflow(host) {
  // The workflow commands (/implement-plan and the rest) come from ~/claudeworkflow, linked into ~/.claude as on the
  // iMac. rsync makes it cheap to do before every lane.
  const src = path.join(HOME, 'claudeworkflow');
  run('rsync', ['-a', '--delete', '--exclude', '.git', '--exclude', 'node_modules', `${src}/`, `${host}:claudeworkflow/`]);
  remote(
    host,
    'mkdir -p ~/.claude && for d in commands _repo templates; do [ -e ~/claudeworkflow/.claude/$d ] && ln -sfn ~/claudeworkflow/.claude/$d ~/.claude/$d; done; true',
  );
  run('scp', ['-q', path.join(FLEET_DIR, 'lane-settings.json'), `${host}:.config/fleet/lane-settings.json`]);
  // The iMac's user skills (the claude.ai ones included), less fleet itself: a lane cannot dispatch lanes.
  const skills = path.join(HOME, '.claude', 'skills');
  if (fs.existsSync(skills)) {
    run('rsync', ['-a', '--delete', '--exclude', 'fleet', '--exclude', '.trash', `${skills}/`, `${host}:.claude/skills/`]);
  }
}

// ---------- placement: how many lanes a worker takes ----------

// One SSH round trip: the worker's memory, CPU, disk and which lane sessions are alive or ended.
const PROBE_SH = [
  `printf "mem=%s\\n" "$(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print t, a}' /proc/meminfo)"`,
  'printf "cores=%s\\n" "$(nproc)"',
  'printf "load=%s\\n" "$(cut -d" " -f1-3 /proc/loadavg)"',
  `printf "swap=%s\\n" "$(free -m | awk '/^Swap:/{print $3"/"$2" MB"}')"`,
  'printf "disk=%s\\n" "$(df -h --output=avail $HOME | tail -1 | tr -d " ")"',
  `printf "sessions=%s\\n" "$(tmux ls -F '#S' 2>/dev/null | tr '\\n' ' ')"`,
  `printf "containers=%s\\n" "$(docker ps --format '{{.Names}}' 2>/dev/null | tr '\\n' ' ')"`,
  `printf "ended=%s\\n" "$(cd ~/work 2>/dev/null && ls -d */lanes/*/exit 2>/dev/null | sed 's#/lanes/#/#; s#/exit$##' | tr '\\n' ' ')"`,
  // Mains power: 1 if any supply is online; empty on a machine without power-supply info (a desktop).
  `printf "power=%s %s\\n" "$(cat /sys/class/power_supply/*/online 2>/dev/null | sort -r | head -1)" "$(cat /sys/class/power_supply/BAT*/capacity 2>/dev/null | head -1)"`,
].join('; ');

function probe(W) {
  const out = remote(W.name, PROBE_SH, null, { timeout: 20000 });
  const kv = Object.fromEntries(
    out
      .trim()
      .split('\n')
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  const [totalKb, availKb] = String(kv.mem || '').split(' ').map(Number);
  if (!totalKb) throw new Error('could not read its memory (fleet places lanes on Linux workers only so far)');
  const list = (s) => String(s || '').split(' ').filter(Boolean);
  return {
    memTotalGb: totalKb / 1048576,
    memAvailGb: availKb / 1048576,
    cores: Number(kv.cores) || 1,
    load: kv.load,
    load1: parseFloat(kv.load) || 0,
    swap: kv.swap,
    disk: kv.disk,
    sessions: list(kv.sessions),
    containers: list(kv.containers),
    ended: new Set(list(kv.ended)),
    onBattery: String(kv.power || '').split(' ')[0] === '0',
    battery: String(kv.power || '').split(' ')[1] || '',
  };
}

// The lanes on a worker that hold a slot and their memory now. A research lane lets go when its session ends (it
// starts nothing); a build lane holds on until fleet remove, since its recipe may still have containers up.
function holding(L, pr) {
  if (L.state === 'setting up' || L.profile !== 'research') return true;
  return pr.sessions.includes(L.session) && !pr.ended.has(`${L.project}/${L.lane}`);
}

function capacity(W, pr, lanes) {
  const held = lanes.filter((L) => L.host === W.name && holding(L, pr));
  return {
    research: held.filter((L) => L.profile === 'research'),
    build: held.filter((L) => L.profile !== 'research'),
    researchSlots: Number(W.research_slots || 4),
    buildSlots: Number(W.slots || 1),
    budgetGb: Number(W.mem_gb) || Math.max(0, Math.floor(pr.memTotalGb) - OS_RESERVE_GB),
    reservedGb: held.reduce((s, L) => s + (Number(L.memGb) || 0), 0),
  };
}

// Pick the worker for a new lane (or check the one named): a free slot of the lane's kind, room in the memory lanes
// may reserve, and that much memory available right now. Among those, the most unreserved memory wins, then the
// lowest load per core, so lanes spread out instead of piling onto one laptop. Call it under the dispatch lock.
function place({ host, light, memGb }) {
  const lanes = allLanes();
  const candidates = host ? workers([host]) : workers().filter((W) => W.role === 'lanes');
  if (!candidates.length) fail('no workers with role "lanes" in ~/.fleet/workers');
  const kind = light ? 'research' : 'build';
  const why = [];
  let best = null;
  for (const W of candidates) {
    let pr;
    try {
      pr = probe(W);
    } catch (e) {
      why.push(`${W.name}: unreachable (${e.message})`);
      continue;
    }
    const c = capacity(W, pr, lanes);
    const n = light ? c.researchSlots : c.buildSlots;
    const used = (light ? c.research : c.build).map((L) => L.slot);
    const slot = [...Array(n).keys()].find((s) => !used.includes(s));
    // A laptop on battery powers off at 2% (worker-01 did, mid-lane, on 2026-11-21), so it takes no lanes.
    if (pr.onBattery) why.push(`${W.name}: on battery (${pr.battery || '?'}%): plug it in`);
    else if (slot === undefined) why.push(`${W.name}: all ${n} ${kind} slots in use`);
    else if (c.reservedGb + memGb > c.budgetGb) why.push(`${W.name}: lanes reserve ${c.reservedGb} of its ${c.budgetGb} GB; this one needs ${memGb}`);
    else if (pr.memAvailGb < memGb) why.push(`${W.name}: only ${pr.memAvailGb.toFixed(1)} GB available right now`);
    else {
      const free = c.budgetGb - c.reservedGb;
      const perCore = pr.load1 / pr.cores;
      if (!best || free > best.free || (free === best.free && perCore < best.perCore)) best = { W, slot, free, perCore };
    }
  }
  if (!best) {
    fail(`no worker can take a ${kind} lane now:\n  ${why.join('\n  ')}\nWait for a lane to end (fleet status), or do the work on the iMac.`);
  }
  return best;
}

// ---------- fleet lane ----------

function lane(argv, { claudeSync }) {
  const o = parseArgs(argv);
  const [projArg, name] = o._;
  if (!projArg || !name) fail('usage: fleet lane <project|.> <lane> --brief <path> [--profile research|build] [--host <worker>] [--base <commit>]');
  if (!NAME_SHAPE.test(name)) fail('a lane name is lowercase letters, digits and dashes');
  const P = project(projArg);
  const proj = P.name;
  const base = o.base || 'HEAD';
  const sha = run('git', ['-C', P.checkout, 'rev-parse', '--verify', `${base}^{commit}`]).stdout.trim();
  const branch = o.branch || `lane/${name}`;
  const brief = o.brief || fail('--brief <path to the lane brief, relative to the repo> is required');
  const briefLocal = path.join(P.checkout, brief);
  if (!fs.existsSync(briefLocal)) fail(`no brief at ${briefLocal}`);

  // Profiles: "research" lanes only read and write reports, so they are light: they get their own slot pool
  // (research_slots in ~/.fleet/workers), their own ports and 1 GB of memory. Every other profile is a full lane,
  // counted against slots and the project's memory_gb. Both run in auto mode with the same settings.
  const profile = o.profile || 'build';
  if (!/^[a-z][a-z0-9-]*$/.test(profile)) fail('a profile name is lowercase letters, digits and dashes');
  const light = profile === 'research';
  const memGb = light ? RESEARCH_MEM_GB : Number(P.cfg.memory_gb || 4);

  // Model and effort: the dispatching session picks them per task, from the model tiers in
  // ~/.claude/_repo/AGENT-INDEX.md (section 3) and the roles in _shared-effort-budget.md. An --agent lane runs as that
  // agent and takes the agent's own model unless --model is given. Without either, Opus at high effort.
  const agent = o.agent || null;
  if (agent && !/^[A-Za-z0-9_-]+$/.test(agent)) fail('an agent name is letters, digits, dashes and underscores');
  if (agent && ![path.join(P.checkout, '.claude', 'agents'), path.join(HOME, '.claude', 'agents')].some((d) => fs.existsSync(path.join(d, `${agent}.md`)))) {
    fail(`no agent ${agent} in ${P.checkout}/.claude/agents or ~/.claude/agents`);
  }
  const model = o.model || (agent ? null : P.cfg.model || 'opus');
  const effort = o.effort || P.cfg.effort || 'high';
  const why = o.model ? 'chosen for this lane' : agent ? `the ${agent} agent's own model` : P.cfg.model ? 'from project.toml' : 'the default; pass --model to choose per task';
  const passEnv = Object.fromEntries(PASS_ENV.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));

  // The lane's starting point: HEAD plus a snapshot of uncommitted work, unless a base commit is named.
  const head = sha;
  const snap = base === 'HEAD' ? snapshot(P.checkout, head) : null;

  // Several windows may dispatch at once: choosing the worker and slot and recording the lane happen under one lock,
  // so two lanes never take the same slot or the same name.
  const L = withFileLock('dispatch', () => {
    if (fs.existsSync(laneFile(proj, name))) fail(`${proj}/${name} already exists: fleet remove ${proj}/${name} first`);
    const { W, slot } = place({ host: o.host, light, memGb });
    const reserved = {
      project: proj,
      lane: name,
      host: W.name,
      profile,
      settings: 'lane-settings.json',
      slot,
      portBase: (light ? RESEARCH_PORT_START : PORT_START) + slot * PORT_BLOCK,
      memGb,
      base,
      head, // the owner's commit at dispatch: fetch replays the lane's commits onto it
      sha: snap ? snap.sha : head, // what the lane's worktree starts from
      branch,
      brief,
      effort,
      model,
      agent,
      passEnv,
      session: sessionName(proj, name),
      created: now(),
      state: 'setting up',
    };
    writeLane(reserved);
    return reserved;
  });
  const host = L.host;
  // If anything below fails, the lane stays recorded (so fleet remove can clean up) but no longer holds its slot.
  process.on('exit', () => {
    if (L.state === 'setting up') {
      L.state = 'setup failed';
      writeLane(L);
    }
  });
  const R = remotePaths(proj, name);

  say(`fleet lane ${proj}/${name} → ${host} (${profile}, slot ${L.slot}, ${memGb} GB, ports ${L.portBase}–${L.portBase + PORT_BLOCK - 1})`);
  say(`  model: ${model || `${agent}'s`}${agent ? `, as agent ${agent}` : ''}, effort ${effort} (${why}); permission mode auto`);
  say(
    snap
      ? `  files: ${head.slice(0, 9)} plus a snapshot of ${snap.count} uncommitted or untracked file(s), plus gitignored files`
      : `  files: ${base === 'HEAD' ? `${head.slice(0, 9)} (nothing uncommitted)` : `${base} (${head.slice(0, 9)})`}, plus gitignored files`,
  );
  say('· Claude account and version');
  if (claudeSync({ only: [host], ifChanged: true, quiet: true }) !== 0) fail(`${host} is not on the iMac's Claude account: fleet claude status`);
  say('· workflow commands and lane settings');
  withFileLock(`workflow-${host}`, () => syncWorkflow(host), 600000);

  say(`· code: ${L.sha.slice(0, 9)} → ${host}`);
  remote(host, `mkdir -p ~/${R.dir} ~/work/${proj}/wt && { [ -d ~/${R.bare} ] || git init -q --bare ~/${R.bare}; }`);
  const pushRef = `refs/fleet/base/${name}`; // a private ref, so pushing never moves a branch anyone works on
  run('git', ['-C', P.checkout, 'push', '-q', '--force', `${host}:${R.bare}`, `${L.sha}:${pushRef}`]);
  remote(host, `git --git-dir=$HOME/${R.bare} worktree add -q -b ${shq(branch)} $HOME/${R.wt} ${L.sha}`);

  say('· gitignored files (only changes travel after the first copy)');
  const files = syncFiles(host, P);
  say(`  mirror updated: ${files.sentMb} MB sent in ${files.secs} s`);
  remote(host, `rsync -a --ignore-existing --link-dest=$HOME/${files.mirror} $HOME/${files.mirror}/ $HOME/${R.wt}/`);
  const remoteHome = remote(host, 'printf %s "$HOME"').trim();
  if (syncMemory(host, P, remoteHome)) say('  project memory copied');

  say(`· brief and recipe (${P.ownRecipe ? "the repo's .fleet/" : 'the default: worktree only'})`);
  remote(host, `mkdir -p "$(dirname $HOME/${R.wt}/${brief})"`);
  run('scp', ['-q', briefLocal, `${host}:${R.wt}/${brief}`]);
  run('rsync', ['-a', '--delete', `${P.recipeDir}/`, `${host}:${R.dir}/recipe/`]);
  remote(host, `cat > ~/${R.dir}/fleet.env`, `${exportLines(laneEnv(L))}\n`);
  remote(host, `cat > ~/${R.dir}/run.sh && chmod +x ~/${R.dir}/run.sh`, RUN_SH);

  say(`· recipe: lane.sh up (log: ${host}:~/${R.dir}/setup.log)`);
  const up = remote(
    host,
    `set -o pipefail; . ~/${R.dir}/fleet.env; cd "$FLEET_WORKTREE" && bash "$FLEET_LANE_DIR/recipe/lane.sh" up 2>&1 | tee "$FLEET_LANE_DIR/setup.log"`,
    null,
    { inherit: true },
  );
  if (up !== 0) {
    L.state = 'setup failed';
    writeLane(L);
    fail(`lane.sh up failed (exit ${up}). Read it with fleet logs ${proj}/${name} --setup; clean up with fleet remove ${proj}/${name}`);
  }

  // The lane's values also go into the prompt, so the session knows them without looking. The recipe's env file holds
  // lane settings only, never secrets.
  const recipeEnv = remote(host, `cat ~/${R.dir}/env 2>/dev/null || true`)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l));
  const facts = [
    `FLEET_PROJECT=${proj}`,
    `FLEET_LANE=${name}`,
    `FLEET_PORT_BASE=${L.portBase} (your ports: ${L.portBase}–${L.portBase + PORT_BLOCK - 1})`,
    `FLEET_WORKTREE=${remoteHome}/${R.wt}`,
    ...recipeEnv,
  ];
  const wt = `${remoteHome}/${R.wt}`;
  const prompt = [
    `Read ${brief} and follow it. You are fleet lane ${proj}/${name} on ${host}, a Linux worker, running unattended: ` +
      'nobody can answer questions, so decide sensibly and record each decision in your report. ' +
      `Work on the current branch (${branch}). Commit as you go, at least after each finished section, so a worker ` +
      'restart loses little. Never push.',
    `Your worktree is a copy of the owner's checkout on their Mac (${P.checkout}) at dispatch: ` +
      (snap
        ? `its last commit, a snapshot commit (${snap.sha.slice(0, 9)}) of its ${snap.count} uncommitted or untracked file(s), `
        : base === 'HEAD' ? 'its last commit (nothing was uncommitted), ' : `commit ${base}, `) +
      `and its gitignored files, except ${files.excludes.join(', ')} (node_modules and .venv hold macOS builds: install ` +
      'them here if you need them). So a file missing here is missing on the Mac too, but `git ls-files` lists tracked ' +
      'files only: before you report something as missing, look on disk too (ls, find). ' +
      `Paths written for the Mac (${P.checkout}/…) mean this worktree (${wt}/…).`,
    (light ? 'This is a research lane: write only under context/research/. ' : '') +
      "Not available here: MCP servers and plugins (the Mac's connectors need its sign-ins), and anything that runs on " +
      'the Mac itself (its databases, containers and apps). If the task needs one, say so in your report instead of ' +
      'guessing. Project memory is a read-only copy: put findings in your report.',
    'Lane facts (also exported in your environment):\n' + facts.map((f) => `- ${f}`).join('\n'),
  ].join('\n\n');
  remote(host, `cat > ~/${R.dir}/prompt`, prompt);

  say('· session');
  remote(host, `tmux new-session -d -s ${shq(L.session)} -c "$HOME/${R.wt}" "bash -l $HOME/${R.dir}/run.sh"`);
  L.state = 'running';
  L.started = now();
  writeLane(L);
  say(`started ${proj}/${name}. Follow it with: fleet logs ${proj}/${name} --follow · wait for it with: fleet wait ${proj}/${name}`);
  return 0;
}

// The lane session: runs once, then records its exit code. Written to the lane folder by fleet lane.
const RUN_SH = `#!/usr/bin/env bash
# fleet lane session (written by fleet lane): one unattended claude -p run, then its exit code.
set -u
D="$(cd "$(dirname "$0")" && pwd)"
set -a
. "$D/fleet.env"
[ -f "$D/env" ] && . "$D/env"
set +a
cd "$FLEET_WORKTREE" || exit 1
date -Is >"$D/started"
args=(--permission-mode auto --settings "$FLEET_SETTINGS" --effort "$FLEET_EFFORT")
[ -n "\${FLEET_MODEL:-}" ] && args+=(--model "$FLEET_MODEL")
[ -n "\${FLEET_AGENT:-}" ] && args+=(--agent "$FLEET_AGENT")
claude -p "$(cat "$D/prompt")" "\${args[@]}" --output-format stream-json --verbose \\
  >"$D/session.jsonl" 2>"$D/session.err" </dev/null
echo $? >"$D/exit"
date -Is >"$D/ended"
`;

// ---------- reading a lane's session ----------

function laneProgress(L) {
  const R = remotePaths(L.project, L.lane);
  const out = remote(
    L.host,
    [
      `d=~/${R.dir}`,
      'printf "exit=%s\\n" "$(cat $d/exit 2>/dev/null)"',
      `printf "tmux=%s\\n" "$(tmux has-session -t ${shq(L.session)} 2>/dev/null && echo yes || echo no)"`,
      'printf "result=%s\\n" "$(grep -F \'"type":"result"\' $d/session.jsonl 2>/dev/null | tail -1)"',
      `printf "commits=%s\\n" "$(git -C ~/${R.wt} rev-list --count ${L.sha}..HEAD 2>/dev/null)"`,
      `printf "dirty=%s\\n" "$(git -C ~/${R.wt} status --porcelain -- . ${shq(`:(exclude)${L.brief}`)} 2>/dev/null | wc -l)"`, // the copied brief is not the lane's work
      'printf "events=%s\\n" "$(wc -l < $d/session.jsonl 2>/dev/null)"',
      `printf "init=%s\\n" "$(grep -m1 -F '"subtype":"init"' $d/session.jsonl 2>/dev/null | jq -c '{model, permissionMode}' 2>/dev/null)"`,
    ].join('; '),
  );
  const kv = Object.fromEntries(
    out
      .trim()
      .split('\n')
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  let result = null;
  let init = null;
  try {
    result = kv.result ? JSON.parse(kv.result) : null;
  } catch {}
  try {
    init = kv.init ? JSON.parse(kv.init) : null;
  } catch {}
  const state = kv.exit !== '' ? 'ended' : kv.tmux === 'yes' ? 'running' : 'gone';
  return { state, exit: kv.exit, result, init, commits: Number(kv.commits) || 0, dirty: Number(kv.dirty) || 0, events: Number(kv.events) || 0 };
}

const baseLabel = (L) =>
  L.head && L.head !== L.sha ? `${L.sha.slice(0, 9)} (a snapshot of uncommitted work on ${L.head.slice(0, 9)})` : L.base === 'HEAD' ? L.sha.slice(0, 9) : L.base;

function summarize(L, pr) {
  const r = pr.result;
  say(`${L.project}/${L.lane} on ${L.host}: ${pr.state}${pr.exit !== '' ? ` (exit ${pr.exit})` : ''}`);
  if (pr.init) say(`  model: ${pr.init.model}, permission mode ${pr.init.permissionMode}`);
  if (r) {
    const mins = r.duration_ms ? (r.duration_ms / 60000).toFixed(1) : '?';
    say(`  result: ${r.subtype}${r.is_error ? ' (error)' : ''}, ${r.num_turns} turns, ${mins} min`);
    const denials = r.permission_denials || [];
    say(`  refused tool calls: ${denials.length}`);
    for (const d of denials.slice(0, 20)) say(`    - ${d.tool_name}: ${JSON.stringify(d.tool_input).slice(0, 140)}`);
    if (r.result) say(`  last message:\n${String(r.result).split('\n').slice(-12).map((l) => `    ${l}`).join('\n')}`);
  }
  say(`  branch ${L.branch}: ${pr.commits} commit(s) on top of ${baseLabel(L)}${pr.dirty ? `, ${pr.dirty} uncommitted change(s)` : ''}`);
  if (pr.state === 'ended') say(`  next: fleet fetch ${L.project}/${L.lane} (then --push), and fleet remove ${L.project}/${L.lane}`);
}

function wait(argv) {
  const o = parseArgs(argv);
  const L = readLane(o._[0]);
  const deadline = o.timeout ? Date.now() + Number(o.timeout) * 60000 : Infinity;
  let pr;
  for (;;) {
    try {
      pr = laneProgress(L);
    } catch (e) {
      say(`${L.host} unreachable (${e.message}); trying again`);
      sleep(30000);
      continue;
    }
    if (pr.state !== 'running') break;
    if (Date.now() > deadline) {
      say(`still running after ${o.timeout} min`);
      return 3;
    }
    sleep(15000);
  }
  L.state = pr.state === 'ended' ? `ended (exit ${pr.exit})` : 'gone';
  writeLane(L);
  summarize(L, pr);
  return pr.state === 'ended' && pr.exit === '0' && !(pr.result && pr.result.is_error) ? 0 : 1;
}

function renderEvent(line, out) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  if (e.type === 'system' && e.subtype === 'init') out(`● session: ${e.model}, ${e.cwd}`);
  else if (e.type === 'assistant') {
    for (const c of e.message?.content || []) {
      if (c.type === 'text' && c.text.trim()) out(`▸ ${c.text.trim().split('\n').slice(0, 6).join('\n  ')}`);
      else if (c.type === 'tool_use') {
        const i = c.input || {};
        const what = i.command || i.file_path || i.pattern || i.description || i.prompt || JSON.stringify(i);
        out(`  ⚙ ${c.name}: ${String(what).replace(/\s+/g, ' ').slice(0, 160)}`);
      }
    }
  } else if (e.type === 'user') {
    for (const c of e.message?.content || []) {
      if (c.type === 'tool_result' && c.is_error) {
        const text = Array.isArray(c.content) ? c.content.map((x) => x.text || '').join(' ') : String(c.content || '');
        out(`  ✗ ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
      }
    }
  } else if (e.type === 'result') {
    out(`■ ${e.subtype}${e.is_error ? ' (error)' : ''}: ${e.num_turns} turns, ${(e.permission_denials || []).length} refused tool call(s)`);
  }
}

function logs(argv) {
  const o = parseArgs(argv, ['follow', 'setup', 'raw']);
  const L = readLane(o._[0]);
  const R = remotePaths(L.project, L.lane);
  if (o.setup) {
    process.stdout.write(remote(L.host, `cat ~/${R.dir}/setup.log 2>/dev/null; cat ~/${R.dir}/session.err 2>/dev/null`));
    return 0;
  }
  const file = `~/${R.dir}/session.jsonl`;
  if (!o.follow) {
    const text = remote(L.host, `cat ${file} 2>/dev/null`);
    for (const line of text.split('\n')) o.raw ? say(line) : renderEvent(line, say);
    return 0;
  }
  // --follow: stream until the session's result arrives.
  return new Promise((resolve) => {
    const child = spawn('ssh', ['-o', 'BatchMode=yes', L.host, `tail -n +1 -F ${file} 2>/dev/null`], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        o.raw ? say(line) : renderEvent(line, say);
        if (line.includes('"type":"result"')) child.kill();
      }
    });
    child.on('close', () => resolve(0));
  });
}

// ---------- fetch, remove, status ----------

function fetch(argv) {
  const o = parseArgs(argv, ['push']);
  const L = readLane(o._[0]);
  const P = project(L.project);
  const R = remotePaths(L.project, L.lane);
  const raw = `refs/fleet/raw/${L.lane}`; // the lane's commits as made, on top of its starting point
  const trees = run('git', ['-C', P.repo, 'worktree', 'list', '--porcelain']).stdout.split('\n');
  if (trees.includes(`branch refs/heads/${L.branch}`)) fail(`${L.branch} is checked out on the iMac: switch away from it, then fetch again`);
  run('git', ['-C', P.repo, 'fetch', '-q', `${L.host}:${R.bare}`, `+refs/heads/${L.branch}:${raw}`]);
  const onto = L.head || L.sha;
  let tip = run('git', ['-C', P.repo, 'rev-parse', raw]).stdout.trim();
  if (L.head && L.head !== L.sha) {
    // The lane started from a snapshot of uncommitted work: put its commits on the owner's HEAD without the snapshot.
    const r = replay(P.repo, L.sha, raw, L.head);
    if (r.conflict) {
      say(`${L.branch} not updated: ${r.conflict}. The lane's commits are kept as ${raw}, on top of the snapshot of`);
      say(`uncommitted work, so merging that ref would bring the snapshot too. Read files with: git show ${raw}:<path>`);
      return 1;
    }
    tip = r.sha;
  }
  run('git', ['-C', P.repo, 'update-ref', `refs/heads/${L.branch}`, tip]);
  const log = run('git', ['-C', P.repo, 'log', '--oneline', `${onto}..${L.branch}`]).stdout.trim();
  say(`${L.branch} fetched to ${P.repo}: ${log ? log.split('\n').length : 0} commit(s) on top of ${onto.slice(0, 9)}${L.head && L.head !== L.sha ? ' (replayed off the snapshot)' : ''}`);
  if (log) say(log.split('\n').slice(0, 15).map((l) => `  ${l}`).join('\n'));
  if (o.push) {
    run('git', ['-C', P.repo, 'push', '-q', 'origin', L.branch]);
    say(`pushed ${L.branch} to origin`);
  }
  return 0;
}

function remove(argv) {
  const o = parseArgs(argv, ['force', 'delete-branch']);
  const L = readLane(o._[0]);
  const R = remotePaths(L.project, L.lane);
  let pr = null;
  try {
    pr = laneProgress(L);
  } catch (e) {
    if (!o.force) fail(`${L.host} unreachable (${e.message}); --force forgets the lane anyway`);
  }
  if (pr && pr.state === 'running' && !o.force) fail(`${L.project}/${L.lane} is still running: fleet remove --force stops it`);

  if (pr) {
    // Keep the record of the run on the iMac before the lane folder goes.
    const keep = path.join(ARCHIVE_DIR, `${L.project}__${L.lane}-${now().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(keep, { recursive: true });
    spawnSync('rsync', ['-a', '--exclude', 'recipe', `${L.host}:${R.dir}/`, `${keep}/`]);
    fs.writeFileSync(path.join(keep, 'lane.json'), `${JSON.stringify(L, null, 2)}\n`);
    say(`logs kept in ${keep}`);
    const steps = [
      `tmux kill-session -t ${shq(L.session)} 2>/dev/null || true`,
      `if [ -f ~/${R.dir}/recipe/lane.sh ] && [ -d ~/${R.wt} ]; then ( . ~/${R.dir}/fleet.env; cd "$FLEET_WORKTREE" && bash "$FLEET_LANE_DIR/recipe/lane.sh" down ) || echo "lane.sh down failed (continuing)"; fi`,
      `git --git-dir=$HOME/${R.bare} worktree remove --force $HOME/${R.wt} 2>/dev/null || rm -rf ~/${R.wt}`,
      `git --git-dir=$HOME/${R.bare} worktree prune`,
      `git --git-dir=$HOME/${R.bare} update-ref -d refs/fleet/base/${L.lane} 2>/dev/null || true`,
      o['delete-branch'] ? `git --git-dir=$HOME/${R.bare} branch -D ${shq(L.branch)} 2>/dev/null || true` : 'true',
      `rm -rf ~/${R.dir}`,
    ];
    process.stdout.write(remote(L.host, steps.join('\n'), null, { timeout: 600000, check: false }));
  }
  if (o['delete-branch']) {
    // The iMac's copy too (from fleet fetch), unless it is checked out somewhere.
    const P = projects()[L.project] ? project(L.project) : null;
    if (P) {
      const trees = run('git', ['-C', P.repo, 'worktree', 'list', '--porcelain'], { check: false }).stdout.split('\n');
      if (trees.includes(`branch refs/heads/${L.branch}`)) say(`${L.branch} is checked out on the iMac, so it stays there`);
      else run('git', ['-C', P.repo, 'branch', '-D', L.branch], { check: false });
      run('git', ['-C', P.repo, 'update-ref', '-d', `refs/fleet/raw/${L.lane}`], { check: false });
    }
  }
  fs.rmSync(laneFile(L.project, L.lane), { force: true });
  say(`removed ${L.project}/${L.lane}${o['delete-branch'] ? ' and its branch, on the worker and the iMac' : ` (branch ${L.branch} kept on ${L.host} and the iMac)`}`);
  return 0;
}

function status() {
  const all = allLanes();
  const lanesByHost = {};
  for (const L of all) (lanesByHost[L.host] = lanesByHost[L.host] || []).push(L);
  for (const W of workers()) {
    let pr;
    try {
      pr = probe(W);
    } catch (e) {
      say(`${W.name} (${W.role}): unreachable (${e.message})`);
      continue;
    }
    const c = capacity(W, pr, all);
    say(
      `${W.name} (${W.role}): research lanes ${c.research.length}/${c.researchSlots}, build lanes ${c.build.length}/${c.buildSlots}, ` +
        `reserved ${c.reservedGb}/${c.budgetGb} GB`,
    );
    say(
      `  now: ${pr.memAvailGb.toFixed(1)} of ${pr.memTotalGb.toFixed(1)} GB memory available, load ${pr.load} on ${pr.cores} cores, ` +
        `swap ${pr.swap}, disk ${pr.disk} free, ${pr.onBattery ? `ON BATTERY (${pr.battery}%): takes no lanes` : `mains power${pr.battery ? ` (battery ${pr.battery}%)` : ''}`}; ` +
        `containers: ${pr.containers.join(' ') || 'none'}`,
    );
    for (const L of lanesByHost[W.name] || []) {
      let state = L.state;
      try {
        const pr = laneProgress(L);
        state = pr.state === 'ended' ? `ended (exit ${pr.exit})` : pr.state === 'running' ? `running, ${pr.events} events` : pr.state;
        state += `, ${pr.commits} commit(s)`;
      } catch {}
      say(`  lane ${L.project}/${L.lane} (${L.profile || 'build'}): ${state}, slot ${L.slot}, ports ${L.portBase}+, branch ${L.branch}`);
    }
  }
  return 0;
}

// ---------- fleet add: a new Linux worker ----------

const SSH_INCLUDE = path.join(STATE_DIR, 'ssh_config');

function ensureSshInclude() {
  // fleet writes host entries to ~/.fleet/ssh_config, included near the top of ~/.ssh/config, before any Host
  // block, so a worker's HostName wins over the worker-* wildcard's %h.local.
  const cfg = path.join(HOME, '.ssh', 'config');
  const line = `Include ${SSH_INCLUDE}`;
  if (!fs.existsSync(SSH_INCLUDE)) fs.writeFileSync(SSH_INCLUDE, '# fleet: worker addresses, written by fleet add\n');
  const text = fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : '';
  if (text.split('\n').includes(line)) return;
  const lines = text.split('\n');
  const firstHost = lines.findIndex((l) => /^\s*(Host|Match)\s/.test(l));
  const at = firstHost < 0 ? lines.length : firstHost;
  const next = [...lines.slice(0, at), '# fleet: worker addresses (fleet add)', line, '', ...lines.slice(at)].join('\n');
  fs.copyFileSync(cfg, `${cfg}.bak-fleet-${now().replace(/[:.]/g, '-')}`);
  fs.writeFileSync(`${cfg}.fleet-new`, next);
  run('ssh', ['-F', `${cfg}.fleet-new`, '-G', 'localhost']); // refuses to replace a config that does not parse
  fs.renameSync(`${cfg}.fleet-new`, cfg);
}

function setHostEntry(name, ip, user) {
  const text = fs.readFileSync(SSH_INCLUDE, 'utf8');
  const kept = text.replace(new RegExp(`\\nHost ${name}\\n(  .*\\n)*`, 'g'), '\n');
  fs.writeFileSync(SSH_INCLUDE, `${kept.trimEnd()}\nHost ${name}\n  HostName ${ip}\n  User ${user}\n`);
}

function addWorker(argv, { claudeSync }) {
  const o = parseArgs(argv);
  const ip = o._[0];
  const name = o.name;
  if (!ip || !name) fail('usage: fleet add <ip> --name worker-NN [--role lanes] [--slots 2] [--account <login>]');
  if (!NAME_SHAPE.test(name)) fail('a worker name is lowercase letters, digits and dashes');
  const role = o.role || 'lanes';
  const slots = o.slots || '2';
  const account = o.account || os.userInfo().username;
  const gitName = run('git', ['config', '--global', 'user.name'], { check: false }).stdout.trim();
  const gitEmail = run('git', ['config', '--global', 'user.email'], { check: false }).stdout.trim();
  if (!gitName || !gitEmail) fail('set git config --global user.name and user.email on the iMac first (lane commits use them)');

  ensureSshInclude();
  setHostEntry(name, ip, account);
  say(`1/4 SSH key → ${name} (${ip})`);
  const keyOk = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', name, 'true']).status === 0;
  if (!keyOk) {
    say('    the laptop password, once:');
    const r = spawnSync('ssh-copy-id', ['-i', path.join(HOME, '.ssh', 'fleet.pub'), name], { stdio: 'inherit' });
    if (r.status !== 0) fail('ssh-copy-id failed: is the SSH server on (sudo apt install openssh-server) and the address right?');
  }

  say('2/4 setup script');
  const recipe = path.join(FLEET_DIR, 'recipes', 'linux-worker.sh');
  remote(name, 'mkdir -p ~/fleet-setup');
  run('scp', ['-q', recipe, `${name}:fleet-setup/linux-worker.sh.new`]);
  remote(name, 'mv -f ~/fleet-setup/linux-worker.sh.new ~/fleet-setup/linux-worker.sh'); // new inode: a running copy is untouched

  say('3/4 setup, as a background job on the laptop (the sudo password, once)');
  const home = `/home/${account}`;
  const job =
    `sudo systemd-run --unit=fleet-setup --collect --quiet -p StandardOutput=truncate:${home}/fleet-setup/setup.log ` +
    `bash ${home}/fleet-setup/linux-worker.sh ${shq(name)} ${shq(account)} ${shq(gitName)} ${shq(gitEmail)}`;
  if (spawnSync('ssh', ['-t', name, job], { stdio: 'inherit' }).status !== 0) fail('could not start the setup job');
  let shown = 0;
  let verdict = null;
  for (let i = 0; i < 240 && !verdict; i++) {
    sleep(5000);
    let log = '';
    try {
      log = remote(name, 'cat ~/fleet-setup/setup.log 2>/dev/null', null, { timeout: 15000 });
    } catch {
      continue;
    }
    const lines = log.split('\n').filter((l) => /^(== |PASS|FAIL|Some checks failed)/.test(l));
    for (const l of lines.slice(shown)) say(`    ${l}`);
    shown = lines.length;
    if (/^PASS: /m.test(log)) verdict = 'pass';
    else if (/^Some checks failed/m.test(log)) verdict = 'fail';
    else {
      const active = spawnSync('ssh', ['-o', 'BatchMode=yes', name, 'systemctl is-active fleet-setup.service'], { encoding: 'utf8' }).stdout.trim();
      if (active && active !== 'active' && active !== 'activating') verdict = 'stopped';
    }
  }
  if (verdict !== 'pass') fail(`setup did not pass (${verdict || 'timed out'}): read ${name}:~/fleet-setup/setup.log, fix, run fleet add again`);

  say('4/4 inventory, reboot, Claude account');
  const inv = path.join(STATE_DIR, 'workers');
  const invText = fs.existsSync(inv) ? fs.readFileSync(inv, 'utf8') : '# fleet workers: name role [key=value ...]\n';
  const others = invText.split('\n').filter((l) => !l.trim().startsWith(`${name} `) && l !== '');
  fs.writeFileSync(inv, `${[...others, `${name}  ${role}  os=linux  slots=${slots}`].join('\n')}\n`);
  sleep(75000); // the setup reboots the laptop a minute after PASS
  for (let i = 0; i < 60; i++) {
    const up = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', name, 'cut -d. -f1 /proc/uptime'], { encoding: 'utf8' });
    if (up.status === 0 && Number(up.stdout) < 600) break;
    sleep(10000);
  }
  const synced = claudeSync({ only: [name] });
  say(synced === 0 ? `PASS: ${name} is a worker` : `${name} is set up, but its Claude sign-in is not: fleet claude status`);
  return synced;
}

module.exports = { lane, wait, logs, fetch, remove, status, addWorker };
