'use strict';
// fleet lanes: one unattended Claude Code session per lane, on a worker, in its own git worktree, with its
// own port block and whatever its project recipe sets up. Driven from the iMac; workers hold no GitHub credentials,
// so the iMac pushes the base commit to a worker over SSH and fetches the lane branch back.
//
// On a worker, per project:  ~/work/<project>/repo.git           bare repo the iMac pushes into
//                            ~/work/<project>/wt/<lane>          the lane's worktree (branch <lane branch>)
//                            ~/work/<project>/lanes/<lane>/      recipe copy, env, prompt, logs, exit code
// On the iMac:               ~/.fleet/projects                   "<name> <repo path>" per line
//                            ~/.fleet/lanes/<project>__<lane>.json
//                            ~/.fleet/lanes-archive/             logs of removed lanes
//
// Project recipe (in the project's repo, read from the iMac checkout at dispatch time):
//   .fleet/project.toml   name, memory_gb, …
//   .fleet/lane.sh        `lane.sh up` prepares the worktree (deps, databases, …) and may write KEY=VALUE lines to
//                         "$FLEET_LANE_DIR/env" for the session; `lane.sh down` undoes it. Both run in the worktree
//                         with FLEET_PROJECT, FLEET_LANE, FLEET_SLOT, FLEET_PORT_BASE (a block of 100), FLEET_MEM_GB,
//                         FLEET_LANE_DIR and FLEET_WORKTREE set.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { HOME, STATE_DIR, FLEET_DIR, say, fail, shq, now, sleep, workers, remote, run, parseArgs } = require('./common');

const PROJECTS_FILE = path.join(STATE_DIR, 'projects');
const LANES_DIR = path.join(STATE_DIR, 'lanes');
const ARCHIVE_DIR = path.join(STATE_DIR, 'lanes-archive');
const PORT_START = 20000; // full lanes: 20000, 20100, …
const RESEARCH_PORT_START = 25000; // research lanes: 25000, 25100, … (they rarely start anything)
const PORT_BLOCK = 100;
const NAME_SHAPE = /^[a-z0-9][a-z0-9-]{0,39}$/;

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

function project(name) {
  const repo = projects()[name];
  if (!repo) fail(`unknown project ${name}: add a line "${name} <repo path>" to ${PROJECTS_FILE}`);
  const toml = path.join(repo, '.fleet', 'project.toml');
  if (!fs.existsSync(toml)) fail(`${name} has no fleet recipe (${toml})`);
  if (!fs.existsSync(path.join(repo, '.fleet', 'lane.sh'))) fail(`${name} has no .fleet/lane.sh`);
  return { name, repo, cfg: parseToml(fs.readFileSync(toml, 'utf8')) };
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
  const [p, l] = String(id || '').split('/');
  if (!p || !l) fail('name the lane as <project>/<lane>');
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
  };
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
  for (const f of ['lane-settings.json', 'lane-settings.research.json']) {
    run('scp', ['-q', path.join(FLEET_DIR, f), `${host}:.config/fleet/${f}`]);
  }
}

// ---------- fleet lane ----------

function lane(argv, { claudeSync }) {
  const o = parseArgs(argv);
  const [proj, name] = o._;
  if (!proj || !name) fail('usage: fleet lane <project> <lane> --host <worker> --base <commit> --brief <path> [--branch <b>]');
  if (!NAME_SHAPE.test(name)) fail('a lane name is lowercase letters, digits and dashes');
  const P = project(proj);
  const host = o.host || fail('--host <worker> is required (the scheduler that places lanes comes after the MVP)');
  const [W] = workers([host]);
  if (fs.existsSync(laneFile(proj, name))) fail(`${proj}/${name} already exists: fleet remove ${proj}/${name} first`);
  const base = o.base || fail('--base <branch or commit> is required');
  const sha = run('git', ['-C', P.repo, 'rev-parse', '--verify', `${base}^{commit}`]).stdout.trim();
  const branch = o.branch || `lane/${name}`;
  const brief = o.brief || fail('--brief <path to the lane brief, relative to the repo> is required');
  const briefLocal = path.join(P.repo, brief);
  if (!fs.existsSync(briefLocal)) fail(`no brief at ${briefLocal}`);

  // Profiles: "research" lanes only read and write reports, so they are light: they get their own slot pool
  // (research_slots in ~/.fleet/workers), their own ports, and the read-only research settings. Every other profile
  // is a full lane, counted against slots.
  const profile = o.profile || 'build';
  if (!/^[a-z][a-z0-9-]*$/.test(profile)) fail('a profile name is lowercase letters, digits and dashes');
  const light = profile === 'research';
  const slots = Number(light ? W.research_slots || 4 : W.slots || 1);
  const used = allLanes()
    .filter((x) => x.host === host && (x.profile === 'research') === light)
    .map((x) => x.slot);
  const slot = [...Array(slots).keys()].find((s) => !used.includes(s));
  if (slot === undefined) {
    fail(`${host} has no free ${light ? 'research ' : ''}slot (${slots} in ~/.fleet/workers): wait for a lane or remove one`);
  }

  const R = remotePaths(proj, name);
  const L = {
    project: proj,
    lane: name,
    host,
    profile,
    settings: light ? 'lane-settings.research.json' : 'lane-settings.json',
    slot,
    portBase: (light ? RESEARCH_PORT_START : PORT_START) + slot * PORT_BLOCK,
    memGb: Number(P.cfg.memory_gb || 4),
    base,
    sha,
    branch,
    brief,
    effort: o.effort || P.cfg.effort || 'high',
    model: o.model || P.cfg.model || null, // project.toml may set model = "opus"; otherwise the plan's default
    session: sessionName(proj, name),
    created: now(),
    state: 'setting up',
  };

  say(`fleet lane ${proj}/${name} → ${host} (${profile}, slot ${slot}, ports ${L.portBase}–${L.portBase + PORT_BLOCK - 1})`);
  say('· Claude account and version');
  if (claudeSync({ only: [host], ifChanged: true, quiet: true }) !== 0) fail(`${host} is not on the iMac's Claude account: fleet claude status`);
  say('· workflow commands and lane settings');
  syncWorkflow(host);

  say(`· code: ${base} (${sha.slice(0, 9)}) → ${host}`);
  remote(host, `mkdir -p ~/${R.dir} ~/work/${proj}/wt && { [ -d ~/${R.bare} ] || git init -q --bare ~/${R.bare}; }`);
  const pushRef = `refs/fleet/base/${name}`; // a private ref, so pushing never moves a branch anyone works on
  run('git', ['-C', P.repo, 'push', '-q', '--force', `${host}:${R.bare}`, `${sha}:${pushRef}`]);
  remote(host, `git --git-dir=$HOME/${R.bare} worktree add -q -b ${shq(branch)} $HOME/${R.wt} ${sha}`);
  writeLane(L); // from here on, fleet remove can clean up

  say('· brief and recipe');
  remote(host, `mkdir -p "$(dirname $HOME/${R.wt}/${brief})"`);
  run('scp', ['-q', briefLocal, `${host}:${R.wt}/${brief}`]);
  run('rsync', ['-a', '--delete', `${path.join(P.repo, '.fleet')}/`, `${host}:${R.dir}/recipe/`]);
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

  // The lane's values go into the prompt itself: an unattended session refuses shell commands that expand most
  // environment variables ($FLEET_PORT_BASE, $TEST_DATABASE_URL …), so it must never need to read them that way.
  // The recipe's env file therefore holds lane settings only, never secrets.
  const recipeEnv = remote(host, `cat ~/${R.dir}/env 2>/dev/null || true`)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l));
  const remoteHome = remote(host, 'printf %s "$HOME"').trim();
  const facts = [
    `FLEET_PROJECT=${proj}`,
    `FLEET_LANE=${name}`,
    `FLEET_PORT_BASE=${L.portBase} (your ports: ${L.portBase}–${L.portBase + PORT_BLOCK - 1})`,
    `FLEET_WORKTREE=${remoteHome}/${R.wt}`,
    ...recipeEnv,
  ];
  const prompt =
    `Read ${brief} and follow it. You are fleet lane ${proj}/${name} on ${host}, running unattended: nobody can answer ` +
    `questions, so decide sensibly and record each decision in your report. Work on the current branch (${branch}) and ` +
    'commit your work there; never push.\n\n' +
    'Lane facts. These are already exported in your environment, so commands you run inherit them. When a command ' +
    'needs one of these values, write the value itself, not $NAME: this unattended session refuses shell commands ' +
    'that expand most environment variables.\n' +
    facts.map((f) => `- ${f}`).join('\n');
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
model=()
[ -n "\${FLEET_MODEL:-}" ] && model=(--model "$FLEET_MODEL")
claude -p "$(cat "$D/prompt")" \\
  --permission-mode dontAsk --settings "$FLEET_SETTINGS" \\
  --effort "$FLEET_EFFORT" "\${model[@]}" --output-format stream-json --verbose \\
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
      `printf "dirty=%s\\n" "$(git -C ~/${R.wt} status --porcelain 2>/dev/null | wc -l)"`,
      'printf "events=%s\\n" "$(wc -l < $d/session.jsonl 2>/dev/null)"',
    ].join('; '),
  );
  const kv = Object.fromEntries(
    out
      .trim()
      .split('\n')
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  let result = null;
  try {
    result = kv.result ? JSON.parse(kv.result) : null;
  } catch {}
  const state = kv.exit !== '' ? 'ended' : kv.tmux === 'yes' ? 'running' : 'gone';
  return { state, exit: kv.exit, result, commits: Number(kv.commits) || 0, dirty: Number(kv.dirty) || 0, events: Number(kv.events) || 0 };
}

function summarize(L, pr) {
  const r = pr.result;
  say(`${L.project}/${L.lane} on ${L.host}: ${pr.state}${pr.exit !== '' ? ` (exit ${pr.exit})` : ''}`);
  if (r) {
    const mins = r.duration_ms ? (r.duration_ms / 60000).toFixed(1) : '?';
    say(`  result: ${r.subtype}${r.is_error ? ' (error)' : ''}, ${r.num_turns} turns, ${mins} min`);
    const denials = r.permission_denials || [];
    say(`  refused tool calls: ${denials.length}`);
    for (const d of denials.slice(0, 20)) say(`    - ${d.tool_name}: ${JSON.stringify(d.tool_input).slice(0, 140)}`);
    if (r.result) say(`  last message:\n${String(r.result).split('\n').slice(-12).map((l) => `    ${l}`).join('\n')}`);
  }
  say(`  branch ${L.branch}: ${pr.commits} commit(s) on top of ${L.base}${pr.dirty ? `, ${pr.dirty} uncommitted change(s)` : ''}`);
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
  run('git', ['-C', P.repo, 'fetch', '-q', `${L.host}:${R.bare}`, `+refs/heads/${L.branch}:refs/heads/${L.branch}`]);
  const log = run('git', ['-C', P.repo, 'log', '--oneline', `${L.sha}..${L.branch}`]).stdout.trim();
  say(`${L.branch} fetched to ${P.repo}: ${log ? log.split('\n').length : 0} commit(s) on top of ${L.base}`);
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
  fs.rmSync(laneFile(L.project, L.lane), { force: true });
  say(`removed ${L.project}/${L.lane}${o['delete-branch'] ? '' : ` (branch ${L.branch} kept on ${L.host})`}`);
  return 0;
}

function status() {
  const lanesByHost = {};
  for (const L of allLanes()) (lanesByHost[L.host] = lanesByHost[L.host] || []).push(L);
  for (const W of workers()) {
    let out;
    try {
      out = remote(
        W.name,
        [
          'printf "load=%s\\n" "$(cut -d" " -f1-3 /proc/loadavg)"',
          'free -m | awk \'/^Mem:/{print "mem="$3"/"$2" MB"} /^Swap:/{print "swap="$3"/"$2" MB"}\'',
          'printf "disk=%s free\\n" "$(df -h --output=avail $HOME | tail -1 | tr -d " ")"',
          'printf "sessions=%s\\n" "$(tmux ls -F "#S" 2>/dev/null | tr "\\n" " ")"',
          'printf "containers=%s\\n" "$(docker ps --format "{{.Names}}" 2>/dev/null | tr "\\n" " ")"',
        ].join('; '),
        null,
        { timeout: 20000 },
      );
    } catch (e) {
      say(`${W.name} (${W.role}, ${W.slots || 1} slot(s)): unreachable (${e.message})`);
      continue;
    }
    const kv = Object.fromEntries(
      out
        .trim()
        .split('\n')
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
    say(`${W.name} (${W.role}, ${W.slots || 1} slot(s)): load ${kv.load}, memory ${kv.mem}, swap ${kv.swap}, disk ${kv.disk}`);
    say(`  containers: ${kv.containers.trim() || 'none'}`);
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
