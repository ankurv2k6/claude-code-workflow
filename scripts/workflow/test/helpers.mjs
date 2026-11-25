// Test helpers: temp dirs, script runner, synthetic git repos. Everything stays under os.tmpdir().
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const SCRIPTS = join(HERE, '..');
export const REPO_ROOT = join(SCRIPTS, '..', '..');
export const EXAMPLE_PROFILE = join(REPO_ROOT, '.claude', 'templates', 'workflow-profile.example.json');

export function tmp(t, prefix = 'wf-test-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

/** A clean environment: no AWS, a temp HOME, no global or system git config. */
export function env(home, extra = {}) {
  const e = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR || '/tmp', LANG: 'C' };
  return {
    ...e,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    ...extra,
  };
}

export function run(script, args, { cwd, home, extraEnv, input } = {}) {
  const file = join(SCRIPTS, script);
  const cmd = script.endsWith('.sh') ? 'bash' : process.execPath;
  const r = spawnSync(cmd, [file, ...args], {
    cwd: cwd || SCRIPTS,
    env: env(home || tmpdir(), extraEnv),
    encoding: 'utf8',
    input,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

export function runAsync(script, args, { cwd, home, extraEnv } = {}) {
  const file = join(SCRIPTS, script);
  const cmd = script.endsWith('.sh') ? 'bash' : process.execPath;
  const child = spawn(cmd, [file, ...args], { cwd: cwd || SCRIPTS, env: env(home || tmpdir(), extraEnv) });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  const done = new Promise((res) => child.on('close', (code) => res({ code, out, err })));
  return { child, done };
}

export function sh(cwd, cmd, home, extraEnv = {}) {
  const r = spawnSync('bash', ['-c', cmd], { cwd, env: env(home || cwd, extraEnv), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd}\n${r.stderr}`);
  return r.stdout.trim();
}

export function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof text === 'string' ? text : `${JSON.stringify(text, null, 2)}\n`);
  return path;
}

/** A git repo with one commit. dateIso sets the commit time. */
export function gitRepo(dir, { dateIso, home } = {}) {
  mkdirSync(dir, { recursive: true });
  const de = dateIso ? { GIT_AUTHOR_DATE: dateIso, GIT_COMMITTER_DATE: dateIso } : {};
  sh(dir, 'git init -q -b main . && echo x > README.md && git add . && git commit -q -m init', home || dir, de);
  return dir;
}
