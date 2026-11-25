#!/usr/bin/env node
// Watch the running lanes of a batch; exit 3 with a report when one stalls.

import { readFileSync, readdirSync, statSync, existsSync, realpathSync, readlinkSync } from 'node:fs';
import { join, dirname, resolve, sep, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { args, die, git, abs, pidAlive, nowStamp, expandHome, defaultProfilePath } from './lib/common.mjs';
import { frontmatter, readTable, col, stripCode } from './lib/tasklist.mjs';
import { loadProfile, entriesOf } from './lib/profile.mjs';

const USAGE = `watchdog.mjs — exit when a running lane stalls

Usage:
  node watchdog.mjs --task-list <path> [--stall-minutes <n>] [--interval <s>] [--once]
                    [--profile <path>] [--lock-dir <dir>]… [--no-proc] [--json]

Reads the Agents table of the task list (templates/batch-progress.md format) every interval
(default 300 s) and, for each row whose State is "running", takes the newest of:
  - the last commit in its worktree,
  - the mtime of <worktree>/.lane/progress.md (and any other file in .lane/),
  - the newest file under <worktree>/<logs_dir> (profile logs_dir, default "logs"); an absolute
    logs_dir is shared, so there only files whose name has the lane id as a whole word count,
  - the Launched time, or the worktree's creation, for a lane with no work yet.
A lane is active, however old its other signals, when:
  - it holds a heavy-job slot: a live pid (or child pid) in <lock-dir>/slot-<i>/ or <lock-dir>/<i>/
    whose cwd is inside the worktree, or whose holder names the lane; for a self_locking job, any
    <lock-dir>/<name>/pid, <lock-dir>/pid or <lock-dir>/*.pid whose live process runs in it;
  - it waits for a slot: a live <lock-dir>/waiting/<pid> marker (slot.sh writes one) for it;
  - a live process has its cwd inside the worktree (lsof -a -d cwd on macOS, /proc/*/cwd on
    Linux), e.g. a long test run; --no-proc turns this check off. A dev server the lane left
    running also counts, so the report names the process.

The task list's front-matter "status:" comes first: anything but in_progress (completed, dry_run,
failed, …) means the batch is not running, and the watchdog exits 0 with "batch not running"
without reading the Agents table. A task list without a status line is read as in_progress.

Stall threshold: --stall-minutes, else the task list's stall_minutes, else the profile's
limits.stall_minutes, else 45. Slot lock dirs: --lock-dir, plus every heavy_jobs.*.lock_dir of
the profile (default ${'${TMPDIR:-/tmp}'}/workflow-slots/<job>).

Exit: 0 no lane is running, the batch is not running, or the task list has no Agents table · 3 a lane stalled (report on stdout) · 2 usage.
With --once it checks a single time and exits 4 when lanes are running and none is stalled.`;

const mtime = (p) => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};

/** Newest mtime of the files under dir, to the given depth. */
function newestIn(dir, depth = 2) {
  let best = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 0) best = Math.max(best, newestIn(p, depth - 1));
    } else best = Math.max(best, mtime(p));
  }
  return best;
}

/** realpath of the nearest existing ancestor, plus the rest (a slot's cwd may be gone). */
const real = (p) => {
  let head = resolve(p);
  let tail = '';
  for (;;) {
    try {
      return join(realpathSync(head), tail);
    } catch {
      const up = dirname(head);
      if (up === head) return resolve(p);
      tail = join(head.slice(up.length + (up.endsWith(sep) ? 0 : 1)), tail);
      head = up;
    }
  }
};

/** Live processes and their cwd: /proc on Linux, lsof elsewhere. [] when neither is available. */
export function processCwds() {
  const out = [];
  if (process.platform === 'linux' && existsSync('/proc')) {
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try {
        out.push({ pid: name, cwd: readlinkSync(`/proc/${name}/cwd`) });
      } catch {}
    }
    return out;
  }
  const r = spawnSync('lsof', ['-a', '-d', 'cwd', '-Fpn', '-w'], { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  let pid = '';
  for (const line of (r.stdout || '').split('\n')) {
    if (line.startsWith('p')) pid = line.slice(1);
    else if (line.startsWith('n') && pid) out.push({ pid, cwd: line.slice(1) });
  }
  return out;
}

let cwdCache = null;
const cwdOf = (pid) => {
  cwdCache ||= new Map(processCwds().map((x) => [String(x.pid), x.cwd]));
  return cwdCache.get(String(pid)) || '';
};

const readIn = (d, f) => {
  try {
    return readFileSync(join(d, f), 'utf8').trim();
  } catch {
    return '';
  }
};

/**
 * Live slot holders and queued waiters in the lock dirs. Each is { slot, pid, holder, cwd, waiting }.
 * selfLocking dirs are read more widely: any <name>/pid, a bare pid file, and *.pid files.
 */
export function slotHolders(lockDirs, selfLocking = new Set()) {
  const out = [];
  for (const dir of lockDirs) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const tag = (name) => `${dir.split(sep).pop()}/${name}`;
    const wide = selfLocking.has(dir);
    for (const e of entries) {
      const name = e.name;
      const d = join(dir, name);
      if (e.isDirectory() && name === 'waiting') {
        let ws = [];
        try {
          ws = readdirSync(d);
        } catch {}
        for (const w of ws) {
          if (!pidAlive(w)) continue;
          const [holder = '', cwd = ''] = readIn(d, w).split('\n');
          out.push({ slot: tag(`waiting/${w}`), pid: w, holder, cwd, waiting: true });
        }
        continue;
      }
      // slot.sh writes slot-<i>/; older scripts sharing a lock dir use a bare <i>/; a self-locking job any name.
      if (e.isDirectory() && (/^(slot-)?\d+$/.test(name) || (wide && !name.endsWith('.reclaim')))) {
        const pid = readIn(d, 'pid');
        const child = readIn(d, 'child');
        const live = pidAlive(pid) ? pid : pidAlive(child) ? child : '';
        if (!live) continue;
        out.push({ slot: tag(name), pid: live, holder: readIn(d, 'holder'), cwd: readIn(d, 'cwd') || cwdOf(live) });
      } else if (wide && e.isFile() && (name === 'pid' || name.endsWith('.pid'))) {
        const pid = readIn(dir, name).split(/\s+/)[0];
        if (pidAlive(pid)) out.push({ slot: tag(name), pid, holder: '', cwd: cwdOf(pid) });
      }
    }
  }
  return out;
}

function parseLaunched(s) {
  const t = stripCode(s).replace(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/, '$1T$2');
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : 0;
}

const tokens = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Do the lane id's tokens appear, in order and whole, among the file name's ("a" names a-test.log, not data.log)? */
export function namesLane(file, lane) {
  const f = tokens(file);
  const l = tokens(lane);
  if (!l.length) return false;
  for (let i = 0; i + l.length <= f.length; i++) if (l.every((x, k) => f[i + k] === x)) return true;
  return false;
}

/** Newest file directly in a shared (absolute) logs dir whose name names the lane. */
function newestNamed(dir, lane) {
  if (!lane) return 0;
  let best = 0;
  try {
    for (const f of readdirSync(dir)) if (namesLane(f, lane)) best = Math.max(best, mtime(join(dir, f)));
  } catch {}
  return best;
}

export function check({ taskList, stallMinutes, profilePath, lockDirs = [], procCheck = true }) {
  cwdCache = null;
  const text = readFileSync(taskList, 'utf8');
  const fm = frontmatter(text).fields;
  const status = stripCode(fm.status || '').toLowerCase();
  if (status && status !== 'in_progress')
    return { at: nowStamp(), batchStatus: status, notRunning: true, stallMinutes: null, running: 0, stalled: 0, lanes: [] };
  const profile = profilePath && existsSync(profilePath) ? loadProfile(profilePath) : null;
  const stall = Number(stallMinutes || fm.stall_minutes || profile?.limits?.stall_minutes || 45);
  const logsDir = profile?.logs_dir || 'logs';
  const dirs = [...lockDirs.map((d) => abs(d))];
  const tmp = (process.env.TMPDIR || '/tmp').replace(/\/$/, '');
  const selfLocking = new Set();
  for (const [job, j] of entriesOf(profile?.heavy_jobs)) {
    const d = j.lock_dir ? abs(j.lock_dir) : join(tmp, 'workflow-slots', job);
    dirs.push(d);
    if (j.self_locking === true) selfLocking.add(d);
  }
  const holders = slotHolders([...new Set(dirs)], selfLocking);

  const table = readTable(text, 'Agents');
  // No Agents table means no lane was ever recorded: nothing to watch, which is not a usage error.
  if (!table) return { at: nowStamp(), batchStatus: 'no Agents table', notRunning: true, stallMinutes: null, running: 0, stalled: 0, lanes: [] };
  const h = table.header;
  const cLane = col(h, /^lane/i);
  const cRole = col(h, /^role/i);
  const cWt = col(h, /worktree/i);
  const cState = col(h, /^state/i, /status/i);
  const cLaunch = col(h, /launched/i, /started/i);
  const cId = col(h, /agent id/i, /^id$/i);
  if (cWt < 0 || cState < 0) throw new Error('the Agents table needs Worktree and State columns');

  const base = (() => {
    const r = git(dirname(taskList), 'rev-parse', '--show-toplevel');
    return r.code === 0 ? r.out : dirname(taskList);
  })();
  const now = Date.now();
  const lanes = [];
  for (const row of table.rows) {
    const c = row._cells;
    if (!/\brunning\b/i.test(c[cState] || '')) continue;
    const lane = stripCode(c[cLane] || '');
    const wtRaw = stripCode(c[cWt] || '');
    const wt = wtRaw ? abs(expandHome(wtRaw), base) : '';
    const info = { lane, role: stripCode(c[cRole] || ''), agent: stripCode(c[cId] || ''), worktree: wt, signals: {} };
    if (!wt || !existsSync(wt)) {
      info.stalled = true;
      info.reason = wt ? 'worktree missing' : 'no worktree recorded';
      lanes.push(info);
      continue;
    }
    const lc = git(wt, 'log', '-1', '--format=%ct');
    const s = info.signals;
    s.commit = lc.code === 0 && lc.out ? Number(lc.out) * 1000 : 0;
    s.progress = Math.max(mtime(join(wt, '.lane', 'progress.md')), newestIn(join(wt, '.lane'), 1));
    s.log = isAbsolute(logsDir) ? newestNamed(logsDir, lane) : newestIn(join(wt, logsDir));
    s.launched = parseLaunched(cLaunch >= 0 ? c[cLaunch] : '') || mtime(join(wt, '.git'));
    const rwt = real(wt);
    const slot = holders.find(
      (x) => (x.cwd && (real(x.cwd) === rwt || real(x.cwd).startsWith(rwt + sep))) || (lane && x.holder === lane) || x.holder === wt,
    );
    const last = Math.max(...Object.values(s));
    info.last = last;
    info.idleMinutes = last ? Math.round((now - last) / 60000) : null;
    const idle = !last || now - last > stall * 60000;
    // Only an otherwise idle lane pays for the process scan.
    const proc =
      !slot && idle && procCheck
        ? processCwdsCached().find((x) => x.pid !== String(process.pid) && (x.cwd === rwt || x.cwd.startsWith(rwt + sep))) // lsof and /proc report real paths
        : null;
    if (slot) {
      info.slot = slot.slot;
      info.stalled = false;
      info.reason = slot.waiting ? `waits for slot ${slot.slot.replace('/waiting/', ' (pid ')})` : `holds slot ${slot.slot} (pid ${slot.pid})`;
    } else if (proc) {
      info.stalled = false;
      info.process = proc.pid;
      info.reason = `live process ${proc.pid} runs in the worktree`;
    } else {
      info.stalled = idle;
      info.reason = info.stalled ? `no activity for ${info.idleMinutes ?? '?'} min` : 'active';
    }
    lanes.push(info);
  }
  return { at: nowStamp(), stallMinutes: stall, running: lanes.length, stalled: lanes.filter((l) => l.stalled).length, lanes };
}

function processCwdsCached() {
  cwdOf(0);
  return [...cwdCache.entries()].map(([pid, cwd]) => ({ pid, cwd }));
}

const ago = (ms, now) => (ms ? `${Math.round((now - ms) / 60000)}m` : '—');

export function report(r) {
  if (r.notRunning) return `watchdog ${r.at} · batch not running (status: ${r.batchStatus})`;
  const now = Date.now();
  const lines = [`watchdog ${r.at} · stall ${r.stallMinutes} min · ${r.running} running · ${r.stalled} stalled`];
  for (const l of r.lanes) {
    const s = l.signals;
    const sig = s.commit !== undefined ? ` (commit ${ago(s.commit, now)}, progress ${ago(s.progress, now)}, log ${ago(s.log, now)})` : '';
    lines.push(`${l.stalled ? 'STALLED' : 'ok     '} ${l.lane || '?'}${l.role ? ` ${l.role}` : ''}${l.agent ? ` [${l.agent}]` : ''} ${l.worktree || ''} — ${l.reason}${sig}`);
  }
  if (r.stalled) lines.push('Next: SendMessage the agent for a one-line status; no reply → the resume procedure.');
  return lines.join('\n');
}

export async function main(argv) {
  const { flags } = args(
    {
      'task-list': { type: 'string' },
      'stall-minutes': { type: 'string' },
      interval: { type: 'string' },
      once: { type: 'boolean' },
      profile: { type: 'string' },
      'lock-dir': { type: 'string', multiple: true },
      'no-proc': { type: 'boolean' },
      json: { type: 'boolean' },
    },
    USAGE,
    argv,
  );
  if (!flags['task-list']) die(`--task-list is required\n\n${USAGE}`);
  const taskList = abs(flags['task-list']);
  if (!existsSync(taskList)) die(`no task list at ${taskList}`);
  const opts = {
    taskList,
    stallMinutes: flags['stall-minutes'],
    profilePath: flags.profile ? abs(flags.profile) : defaultProfilePath(dirname(taskList)),
    lockDirs: flags['lock-dir'] || [],
    procCheck: !flags['no-proc'],
  };
  const interval = Number(flags.interval ?? 300) * 1000;
  const emit = (r) => process.stdout.write(`${flags.json ? JSON.stringify(r, null, 2) : report(r)}\n`);
  for (;;) {
    let r;
    try {
      r = check(opts);
    } catch (e) {
      die(`watchdog: ${e.message}`);
    }
    if (r.running === 0) {
      emit(r);
      return 0;
    }
    if (r.stalled > 0) {
      emit(r);
      return 3;
    }
    if (flags.once) {
      emit(r);
      return 4;
    }
    await new Promise((res) => setTimeout(res, interval));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).then((c) => process.exit(c));
