#!/usr/bin/env node
// Watch the running lanes of a batch; exit 3 with a report when one stalls.

import { readFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, die, git, abs, pidAlive, nowStamp, expandHome, defaultProfilePath } from './lib/common.mjs';
import { frontmatter, readTable, col, stripCode } from './lib/tasklist.mjs';
import { loadProfile } from './lib/profile.mjs';

const USAGE = `watchdog.mjs — exit when a running lane stalls

Usage:
  node watchdog.mjs --task-list <path> [--stall-minutes <n>] [--interval <s>] [--once]
                    [--profile <path>] [--lock-dir <dir>]… [--json]

Reads the Agents table of the task list (templates/batch-progress.md format) every interval
(default 300 s) and, for each row whose State is "running", takes the newest of:
  - the last commit in its worktree,
  - the mtime of <worktree>/.lane/progress.md (and any other file in .lane/),
  - the newest file under <worktree>/<logs_dir> (profile logs_dir, default "logs"),
  - the Launched time, or the worktree's creation, for a lane with no work yet.
A lane that holds a heavy-job slot (a live pid in <lock-dir>/slot-<i>/pid or <lock-dir>/<i>/pid
whose cwd is inside the worktree, or whose holder names the lane) is active, however old its other
signals.

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

function slotHolders(lockDirs) {
  const out = [];
  for (const dir of lockDirs) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      // slot.sh writes slot-<i>/; older scripts sharing a lock dir use a bare <i>/.
      if (!/^(slot-)?\d+$/.test(name)) continue;
      const d = join(dir, name);
      const read = (f) => {
        try {
          return readFileSync(join(d, f), 'utf8').trim();
        } catch {
          return '';
        }
      };
      const pid = read('pid');
      if (!pidAlive(pid)) continue;
      out.push({ slot: `${dir.split(sep).pop()}/${name}`, pid, holder: read('holder'), cwd: read('cwd') });
    }
  }
  return out;
}

function parseLaunched(s) {
  const t = stripCode(s).replace(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/, '$1T$2');
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : 0;
}

export function check({ taskList, stallMinutes, profilePath, lockDirs = [] }) {
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
  for (const [job, j] of Object.entries(profile?.heavy_jobs || {}))
    dirs.push(j?.lock_dir ? abs(j.lock_dir) : join(tmp, 'workflow-slots', job));
  const holders = slotHolders([...new Set(dirs)]);

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
    s.log = logsDir.startsWith('/') ? 0 : newestIn(join(wt, logsDir));
    s.launched = parseLaunched(cLaunch >= 0 ? c[cLaunch] : '') || mtime(join(wt, '.git'));
    const rwt = real(wt);
    const slot = holders.find(
      (x) => (x.cwd && (real(x.cwd) === rwt || real(x.cwd).startsWith(rwt + sep))) || (lane && x.holder === lane) || x.holder === wt,
    );
    const last = Math.max(...Object.values(s));
    info.last = last;
    info.idleMinutes = last ? Math.round((now - last) / 60000) : null;
    if (slot) {
      info.slot = slot.slot;
      info.stalled = false;
      info.reason = `holds slot ${slot.slot} (pid ${slot.pid})`;
    } else {
      info.stalled = !last || now - last > stall * 60000;
      info.reason = info.stalled ? `no activity for ${info.idleMinutes ?? '?'} min` : 'active';
    }
    lanes.push(info);
  }
  return { at: nowStamp(), stallMinutes: stall, running: lanes.length, stalled: lanes.filter((l) => l.stalled).length, lanes };
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
