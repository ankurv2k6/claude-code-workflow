'use strict';
// Helpers shared by every fleet command. Dependency-free.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, '.fleet'); // this iMac's own state: never in the (public) workflow repo
const FLEET_DIR = path.resolve(__dirname, '..');

const say = (msg) => process.stdout.write(`${msg}\n`);
const fail = (msg, code = 1) => {
  process.stderr.write(`fleet: ${msg}\n`);
  process.exit(code);
};
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const now = () => new Date().toISOString();
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function workers(only) {
  const file = path.join(STATE_DIR, 'workers');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return only && only.length ? fail(`no workers yet (${file}); add one with fleet add`) : [];
  }
  const all = text
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map((l) => {
      const [name, role, ...kv] = l.split(/\s+/);
      return { name, role, ...Object.fromEntries(kv.map((x) => x.split('='))) };
    });
  if (!only || only.length === 0) return all;
  const unknown = only.filter((n) => !all.some((w) => w.name === n));
  if (unknown.length) fail(`not in ${file}: ${unknown.join(', ')}`);
  return all.filter((w) => only.includes(w.name));
}

// Run a script on a worker in a login shell, so ~/.config/fleet/profile.sh puts claude, node and pnpm on the PATH.
// inherit: stream its output to this terminal (returns the exit status instead of stdout).
function remote(host, script, input, { timeout = 300000, inherit = false, check = true } = {}) {
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, `bash -lc ${shq(script)}`];
  if (inherit) {
    const r = spawnSync('ssh', args, { stdio: ['ignore', 'inherit', 'inherit'], timeout: 0 });
    return r.status;
  }
  const r = spawnSync('ssh', args, { input, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(r.error.message);
  if (check && r.status !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.status}`).trim().split('\n').pop());
  return r.stdout;
}

// Run a local command; fail loudly unless check is false.
function run(cmd, args, { cwd, check = true, input } = {}) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (check && r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')}: ${(r.stderr || r.stdout || `exit ${r.status}`).trim().split('\n').pop()}`);
  }
  return r;
}

// Flags: --key value, --key=value, and the boolean flags named in `booleans`. Returns { _: positional, key: value }.
function parseArgs(argv, booleans = []) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (eq > 0) out[key] = a.slice(eq + 1);
    else if (booleans.includes(key)) out[key] = true;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else fail(`--${key} needs a value`);
  }
  return out;
}

// A lock shared by every fleet process on this Mac, since several Claude windows may dispatch at once. It waits for a
// live holder and takes over from a dead one (fail() exits without running finally, so a crashed holder leaves its
// file behind).
function withFileLock(name, fn, waitMs = 120000) {
  const file = path.join(STATE_DIR, `${name}.lock`);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      break;
    } catch {
      let pid = 0;
      try {
        pid = Number(fs.readFileSync(file, 'utf8'));
      } catch {}
      let alive = false;
      try {
        if (pid) process.kill(pid, 0); // signal 0 only tests that the process exists
        alive = pid > 0;
      } catch {}
      if (!alive) {
        fs.rmSync(file, { force: true });
        continue;
      }
      if (Date.now() > deadline) fail(`waited ${waitMs / 1000} s for ${file} (held by pid ${pid})`);
      sleep(250);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(file, { force: true });
  }
}

module.exports = { HOME, STATE_DIR, FLEET_DIR, say, fail, shq, now, sleep, workers, remote, run, parseArgs, withFileLock };
