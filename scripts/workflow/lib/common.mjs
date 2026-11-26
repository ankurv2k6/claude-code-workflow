// Shared helpers for the workflow scripts. Node >= 18 built-ins only.

import { readFileSync, writeFileSync, renameSync, mkdirSync, rmdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

/** Parse argv with node:util parseArgs; print usage and exit 2 on a bad flag. */
export function args(options, usage, argv = process.argv.slice(2)) {
  const opts = { help: { type: 'boolean', short: 'h' }, ...options };
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: opts, allowPositionals: true, strict: true });
  } catch (e) {
    process.stderr.write(`${e.message}\n\n${usage}\n`);
    process.exit(2);
  }
  if (parsed.values.help) {
    process.stdout.write(`${usage}\n`);
    process.exit(0);
  }
  return { flags: parsed.values, pos: parsed.positionals };
}

export function die(msg, code = 2) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

export const expandHome = (p) => (p && p.startsWith('~') ? join(homedir(), p.slice(1)) : p);

export function readJson(path, what = 'file') {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`cannot read ${what} ${path}: ${e.code || e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${what} ${path} is not valid JSON: ${e.message}`);
  }
}

/** Write a file atomically: temp file in the same directory, then rename. */
export function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** Run fn while holding a mkdir lock next to `path` (macOS has no flock). */
export function withLock(path, fn, { waitMs = 10000 } = {}) {
  const lock = `${path}.lock`;
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // A lock older than a minute belongs to a dead writer: these edits take milliseconds.
      try {
        if (Date.now() - statSync(lock).mtimeMs > 60000) rmdirSync(lock);
      } catch {}
      if (Date.now() > until) throw new Error(`lock held: ${lock}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return fn();
  } finally {
    try {
      rmdirSync(lock);
    } catch {}
  }
}

/** The directory holding `.claude/` above `start`, else `start`. */
export function projectRoot(start = process.cwd()) {
  let d = resolve(start);
  for (;;) {
    if (existsSync(join(d, '.claude', 'workflow-profile.json'))) return d;
    const up = dirname(d);
    if (up === d) return resolve(start);
    d = up;
  }
}

export function defaultProfilePath(cwd = process.cwd()) {
  return join(projectRoot(cwd), '.claude', 'workflow-profile.json');
}

/** Placeholders of commands.*, gates, merge.* and test_db.* commands. */
export const CORE_PLACEHOLDERS = ['files', 'base', 'name', 'url', 'port', 'lane', 'set'];

/** Placeholders each tests.* and release.* key may use (_shared-project-profile.md). */
export const KEY_PLACEHOLDERS = {
  'tests.heavy_lock': ['owner', 'cmd'],
  'tests.merge_delta': ['ours', 'theirs', 'url'],
  'release.hotfix_start': ['hotfix'],
  'release.hotfix_finish': ['hotfix', 'release_branch'],
  'release.package': ['bundle'],
  'release.deploy': ['bundle', 'description'],
};

export const PLACEHOLDERS = [...CORE_PLACEHOLDERS, 'owner', 'cmd', 'ours', 'theirs', 'hotfix', 'release_branch', 'bundle', 'description'];

/** Placeholders named in a command string. */
export const placeholdersIn = (cmd) => [...String(cmd).matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);

/** One shell word: a plain value is kept as is, anything else is single-quoted. */
export const shellWord = (v) => {
  const s = String(v);
  return /^[A-Za-z0-9_.\/:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
};

/**
 * Fill {placeholders}; returns { cmd, missing } where missing lists unfilled names.
 * Values are shell-quoted (quote: false for plain names such as test_db.name_pattern), so a
 * value can never inject shell: {files} is split on whitespace (or given as an array) and each
 * path becomes one quoted word; every other value, {cmd} and {description} included, becomes ONE
 * quoted word (a script given {cmd} runs it with bash -c).
 */
export function fill(cmd, values, { quote = true } = {}) {
  const missing = [];
  const word = (k, v) => {
    if (!quote) return String(v);
    const parts = Array.isArray(v) ? v.map(String) : k === 'files' ? String(v).split(/\s+/).filter(Boolean) : [String(v)];
    return parts.map(shellWord).join(' ');
  };
  const out = String(cmd).replace(/\{([a-z_]+)\}/g, (m, k) => {
    const v = values[k];
    if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) return word(k, v);
    if (PLACEHOLDERS.includes(k)) missing.push(k);
    return m;
  });
  return { cmd: out, missing: [...new Set(missing)] };
}

/** Placeholders that sit inside '…' or "…" in a command; fill() quotes values itself. */
export function quotedPlaceholders(cmd) {
  const s = String(cmd);
  const found = [];
  let q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q !== "'" && c === '\\') {
      i++;
      continue;
    }
    if (!q && (c === "'" || c === '"')) q = c;
    else if (q && c === q) q = '';
    else if (q && c === '{') {
      const m = s.slice(i).match(/^\{([a-z_]+)\}/);
      if (m) found.push(m[1]);
    }
  }
  return [...new Set(found)];
}

/** Run a shell command with the profile's shell prefix. */
export function runShell(cmd, { prefix = '', cwd, timeoutSec = 600, env } = {}) {
  const full = prefix ? `${prefix.trim()} ${cmd}` : cmd;
  const r = spawnSync('bash', ['-c', full], {
    cwd,
    env: env || process.env,
    encoding: 'utf8',
    timeout: timeoutSec * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: r.status === null ? (r.error && r.error.code === 'ETIMEDOUT' ? 124 : 128) : r.status,
    timedOut: !!(r.error && r.error.code === 'ETIMEDOUT') || r.signal === 'SIGTERM',
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

export function git(cwd, ...a) {
  const r = spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/** Local time from the system clock, `YYYY-MM-DD HH:MM`. */
export function nowStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const today = (d = new Date()) => nowStamp(d).slice(0, 10);

export const abs = (p, base = process.cwd()) => (isAbsolute(expandHome(p)) ? expandHome(p) : resolve(base, p));

/** Is a pid alive? EPERM means alive but owned by someone else. */
export function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}
