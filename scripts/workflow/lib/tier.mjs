// Plan and run one tier of the profile's gates (run-tier.mjs, merge-lane.mjs). Node >= 18 built-ins.
//
// - An agent gate (kind "agent") is never run as a shell check: skills launch its verifier. Only its
//   optional read-only helper cmd runs, and its output is handed to that agent.
// - A heavy gate takes a slot through slot.sh, unless its heavy_jobs entry is self_locking.
// - The first red stops the tier; later gates are "not-run". --parallel runs consecutive plain
//   `check` gates (no heavy slot) at once.

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fill, shellWord } from './common.mjs';
import { gateOf } from './profile.mjs';

export const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The command a heavy gate runs: through slot.sh unless the job locks itself. */
export function wrapHeavy(profile, gate, cmd, { holder } = {}) {
  if (!gate.heavy) return { cmd, wrapped: false };
  const job = profile.heavy_jobs?.[gate.heavy] || {};
  if (job.self_locking === true) return { cmd, wrapped: false, selfLocking: true };
  const parts = ['bash', shellWord(join(SCRIPTS_DIR, 'slot.sh')), shellWord(gate.heavy), String(job.slots || 1)];
  if (job.lock_dir) parts.push('--lock-dir', shellWord(job.lock_dir));
  if (holder) parts.push('--holder', shellWord(holder));
  parts.push('--', 'bash', '-c', shellWord(cmd));
  return { cmd: parts.join(' '), wrapped: true };
}

/** One step per gate of the tier, in order, with its rendered command. */
export function planTier(profile, tier, values = {}, { holder } = {}) {
  const names = profile.tiers?.[tier];
  if (!Array.isArray(names)) return null;
  return names.map((name) => {
    const g = gateOf(profile, name);
    if (!g || typeof g !== 'object') return { name, status: 'unknown', reason: 'not in gates' };
    const step = { name, kind: g.kind, heavy: g.heavy || null };
    if (g.kind === 'agent') {
      Object.assign(step, { agent: true, verifier: g.verifier, asks: g.asks || '' });
      if (!g.cmd) return { ...step, status: 'agent' };
    }
    const f = fill(g.cmd, values);
    if (f.missing.length) return { ...step, status: 'unfilled', reason: `needs {${f.missing.join('}, {')}}`, cmd: f.cmd };
    if (step.agent) return { ...step, status: 'agent', helper: f.cmd };
    const w = wrapHeavy(profile, g, f.cmd, { holder });
    return { ...step, status: 'run', cmd: w.cmd, wrapped: w.wrapped, selfLocking: !!w.selfLocking, parallelOk: g.kind === 'check' && !g.heavy };
  });
}

/** Run one shell command asynchronously; output to a log file (when given) and a short tail. */
export function runAsync(cmd, { prefix = '', cwd, env, log, timeoutSec = 3600 } = {}) {
  const full = prefix ? `${prefix.trim()} ${cmd}` : cmd;
  return new Promise((res) => {
    const t0 = Date.now();
    let out = '';
    let stream = null;
    if (log) {
      mkdirSync(dirname(log), { recursive: true });
      stream = createWriteStream(log);
    }
    const child = spawn('bash', ['-c', full], { cwd, env: env || process.env, timeout: timeoutSec * 1000 });
    const take = (d) => {
      out = (out + d).slice(-8000);
      stream?.write(d);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => take(`${e.message}\n`));
    child.on('close', (code, signal) => {
      stream?.end();
      res({ code: code ?? (signal ? 124 : 128), seconds: Math.round((Date.now() - t0) / 100) / 10, tail: out.trim().split('\n').slice(-5).join('\n') });
    });
  });
}

/**
 * Run planned steps. Returns { steps, code }: code 0 green (agent gates are listed, not run),
 * 1 a red or an unfilled/unknown gate, 75 a slot wait timed out (the gate did not run).
 */
export async function runSteps(steps, { prefix, cwd, env, parallel = false, logDir, logPrefix = '', timeoutSec } = {}) {
  const logOf = (s, what = '') => (logDir ? join(logDir, `${logPrefix}${s.name}${what}.log`) : undefined);
  let stopped = '';
  const exec = async (s) => {
    const log = logOf(s);
    const r = await runAsync(s.cmd, { prefix, cwd, env, log, timeoutSec });
    s.exit = r.code;
    s.seconds = r.seconds;
    s.log = log;
    s.status = r.code === 0 ? 'pass' : r.code === 75 && s.wrapped ? 'slot-timeout' : 'fail';
    if (r.code !== 0) s.tail = r.tail;
  };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (stopped) {
      if (s.status === 'run' || s.status === 'agent') s.status = 'not-run';
      s.reason ||= `${stopped} was red`;
      continue;
    }
    if (s.status === 'unknown' || s.status === 'unfilled') {
      stopped = s.name;
      continue;
    }
    if (s.status === 'agent') {
      if (s.helper) {
        const log = logOf(s, '-helper');
        const r = await runAsync(s.helper, { prefix, cwd, env, log, timeoutSec });
        s.helperExit = r.code;
        s.helperLog = log;
        if (!log) s.helperTail = r.tail;
      }
      continue;
    }
    if (parallel && s.parallelOk) {
      const group = [s];
      while (i + 1 < steps.length && steps[i + 1].status === 'run' && steps[i + 1].parallelOk) group.push(steps[++i]);
      await Promise.all(group.map(exec));
      const red = group.find((x) => x.status !== 'pass');
      if (red) stopped = red.name;
      continue;
    }
    await exec(s);
    if (s.status !== 'pass') stopped = s.name;
  }
  const bad = steps.filter((s) => ['fail', 'unknown', 'unfilled'].includes(s.status));
  const code = bad.length ? 1 : steps.some((s) => s.status === 'slot-timeout') ? 75 : 0;
  return { steps, code };
}

/** One short line per step. */
export function stepLine(s) {
  const tag = s.status === 'fail' ? `FAIL exit ${s.exit}` : s.status;
  const extra =
    s.status === 'agent'
      ? ` → launch ${s.verifier}: ${s.asks}${s.helperLog ? ` (helper output ${s.helperLog})` : ''}`
      : `${s.seconds !== undefined ? ` (${s.seconds}s)` : ''}${s.selfLocking ? ' [self-locking]' : s.wrapped ? ' [slot]' : ''}${s.reason ? `  (${s.reason})` : ''}${s.log && s.status !== 'pass' ? `  log ${s.log}` : ''}`;
  return `[${tag}] ${s.name}${extra}`;
}

/** "typecheck pass · journal FAIL" — the tier in one line. */
export const tierLine = (steps) => steps.map((s) => `${s.name} ${s.status === 'fail' ? 'FAIL' : s.status}`).join(' · ') || 'empty';
