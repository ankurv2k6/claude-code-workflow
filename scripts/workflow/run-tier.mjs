#!/usr/bin/env node
// Run one tier of the profile's gates, in order, with the shell prefix; agent gates are listed for the skill to launch.

import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, die, abs, defaultProfilePath } from './lib/common.mjs';
import { loadProfile, checkProfile, findSchema } from './lib/profile.mjs';
import { planTier, runSteps, stepLine, tierLine } from './lib/tier.mjs';

const TIERS = ['per_commit', 'lane_end', 'merge', 'cut_end', 'track_merge'];
const PH = ['files', 'base', 'name', 'url', 'port', 'lane', 'set'];

const USAGE = `run-tier.mjs — run the gates of one profile tier

Usage:
  node run-tier.mjs <tier> [--profile <path>] [--cwd <dir>] [--parallel] [--holder <name>]
                    [--log-dir <dir>] [--timeout <s>] [--print] [--json] [placeholder flags]

  <tier>          one of ${TIERS.join(', ')}

Runs each gate the tier names, in order, as "bash -c '<shell_prefix> <cmd>'" in --cwd (default:
the project root of the profile). The first red stops the tier; the rest are "not-run".
  - kind "agent": never run as a check. Its read-only helper cmd (if any) runs and its output is
    saved for the agent; the gate is listed as "agent" with its verifier and asks, for the skill
    to launch. It passes only when that agent returns PASS: this script never decides it.
  - "heavy": through slot.sh <job> <slots> --lock-dir <lock_dir>, unless heavy_jobs.<job>.
    self_locking is true (the job takes its own lock and is run as is).
  - --parallel runs consecutive plain "check" gates (no heavy slot) at once: the lane-end and
    merge checks are usually independent.
Placeholder flags: --files (repeatable) --base --name --url --port --lane --set; values are
shell-quoted. A gate with an unfilled placeholder is not run and counts as red.
  --log-dir <dir>  each gate's output to <dir>/tier-<tier>-<gate>.log (default: the profile's
                   logs_dir under --cwd, else "logs")
  --holder <name>  recorded in the slot (default: $WORKFLOW_LANE, else the directory)
  --print          list what would run, run nothing
  --timeout <s>    per gate, default 3600

Exit: 0 green (agent gates pending are listed, not failed) · 1 a red, unfilled or unknown gate,
or an invalid profile · 75 a slot wait timed out (the gate did not run: neither green nor red) ·
2 usage or an unknown tier.`;

export async function main(argv) {
  const { flags, pos } = args(
    {
      profile: { type: 'string' },
      cwd: { type: 'string' },
      parallel: { type: 'boolean' },
      holder: { type: 'string' },
      'log-dir': { type: 'string' },
      timeout: { type: 'string' },
      print: { type: 'boolean' },
      json: { type: 'boolean' },
      ...Object.fromEntries(PH.map((k) => [k, k === 'files' ? { type: 'string', multiple: true } : { type: 'string' }])),
    },
    USAGE,
    argv,
  );
  const tier = pos[0];
  if (pos.length !== 1 || !TIERS.includes(tier)) die(`expected one tier (${TIERS.join(', ')})\n\n${USAGE}`);
  const path = flags.profile ? abs(flags.profile) : defaultProfilePath();
  let profile;
  try {
    profile = loadProfile(path);
    if (!profile) die(`no profile at ${path}: run the tier's v1 commands by hand`, 1);
    const errs = checkProfile(profile, findSchema().schema);
    if (errs.length) die(`profile ${path} is invalid:\n  ${errs.join('\n  ')}`, 1);
  } catch (e) {
    die(e.message, 1);
  }
  const cwd = flags.cwd ? abs(flags.cwd) : resolve(dirname(path), '..');
  const values = Object.fromEntries(PH.map((k) => [k, flags[k]]));
  if (values.files) values.files = values.files.flatMap((f) => f.split(/\s+/)).filter(Boolean);
  const steps = planTier(profile, tier, values, { holder: flags.holder });
  if (!steps) die(`the profile has no tiers.${tier}`, 1);
  const logDir = flags['log-dir'] ? abs(flags['log-dir']) : join(cwd, profile.logs_dir || 'logs');
  let code = 0;
  if (flags.print) for (const s of steps) if (s.status === 'run') s.status = 'would-run';
  if (!flags.print)
    ({ code } = await runSteps(steps, {
      prefix: profile.shell_prefix,
      cwd,
      parallel: !!flags.parallel,
      logDir,
      logPrefix: `tier-${tier}-`,
      timeoutSec: Number(flags.timeout || 3600),
    }));
  else if (steps.some((s) => s.status === 'unknown' || s.status === 'unfilled')) code = 1;
  const agents = steps.filter((s) => s.agent);
  if (flags.json) process.stdout.write(`${JSON.stringify({ tier, cwd, code, steps }, null, 2)}\n`);
  else {
    const out = [`tiers.${tier} in ${cwd}${flags.parallel ? ' (parallel checks)' : ''}`];
    for (const s of steps) {
      out.push(`  ${stepLine(s)}${s.status === 'would-run' ? `: ${s.cmd}` : ''}`);
      if (s.tail) out.push(...s.tail.split('\n').map((l) => `      ${l}`));
    }
    out.push(`${code === 0 ? (agents.length ? 'SCRIPTS GREEN, AGENT GATES PENDING' : 'GREEN') : code === 75 ? 'NOT RUN (slot timeout)' : 'RED'}: ${tierLine(steps)}${agents.length ? ` · ${agents.length} agent gate(s) to launch; the tier is green only when each returns PASS` : ''}`);
    process.stdout.write(`${out.join('\n')}\n`);
  }
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).then((c) => process.exit(c));
