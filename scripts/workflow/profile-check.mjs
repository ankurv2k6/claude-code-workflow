#!/usr/bin/env node
// Validate a project's workflow profile; with --smoke, run its smoke-safe gates and commands.

import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, die, fill, runShell, defaultProfilePath, abs } from './lib/common.mjs';
import { findSchema, checkProfile, loadProfile, smokeEntries, semanticWarnings, entriesOf } from './lib/profile.mjs';

const USAGE = `profile-check.mjs — validate <project>/.claude/workflow-profile.json

Usage:
  node profile-check.mjs [--profile <path>] [--schema <path>] [--json]
  node profile-check.mjs --smoke [--install-first] [placeholder flags] [--only <id>]… [--print]
                         [--timeout <s>]

Checks the profile against the schema (--schema, else .claude/templates/
workflow-profile.schema.json in this checkout, else in $WH: $WORKFLOW_HOME, else
~/.claude/workflow-release, else the repo ~/.claude/commands points into), then cross-field rules:
every tier names a known gate, every "heavy" names a heavy_jobs slot, placeholders are known and
bare (never inside quotes), test_db.host is in allow_hosts, an agent gate (kind "agent") names its
"verifier" and every other gate has a "cmd", and no tier lists a gate whose cmd is
commands.test_full (the full run is never a tier gate).
Warnings (printed, exit unchanged): risk_routing without a "reach-walk" gate; a heavy_jobs entry
without lock_dir (the default is per-user ${'${TMPDIR:-/tmp}'}/workflow-slots/<job>).

--smoke runs every gate with "smoke": true (never an agent gate: skills launch those) and every
commands.* entry, each through
"bash -c '<shell_prefix> <cmd>'" in the project root, and reports each exit code. Placeholders
come from flags and are shell-quoted, so a value cannot inject shell: --files is split on
whitespace (or repeated) and each path becomes one quoted word. An entry whose placeholders are
not all given is reported as skipped.

Precondition: --smoke runs in a checkout whose dependencies are installed and built, as the gates
expect; it runs the gates first, then commands.*. In a fresh checkout or worktree pass
--install-first: commands.install, then commands.build (each when defined), run before everything
else (even when --only leaves them out), and if either fails the rest are skipped, not run red.
A staged-file gate (lint-staged, a pre-commit hook) passes vacuously on an empty index: it proves
the hook runs, not that its tools work.

Placeholder flags: --files --base --name --url --port --lane --set
Options:
  --profile <path>  default: .claude/workflow-profile.json in the nearest project root
  --install-first   run commands.install, then commands.build, before the other entries
  --only <id>       smoke only this entry (e.g. gates.lint-staged, commands.build); repeatable
  --print           list what --smoke would run, run nothing
  --timeout <s>     per command, default 600
  --json            machine-readable result

Exit: 0 valid (and every smoke entry that ran passed) · 1 invalid or a smoke failure · 2 usage.`;

const PH = ['files', 'base', 'name', 'url', 'port', 'lane', 'set'];

export function main(argv) {
  const { flags } = args(
    {
      profile: { type: 'string' },
      schema: { type: 'string' },
      smoke: { type: 'boolean' },
      'install-first': { type: 'boolean' },
      print: { type: 'boolean' },
      json: { type: 'boolean' },
      only: { type: 'string', multiple: true },
      timeout: { type: 'string' },
      ...Object.fromEntries(PH.map((k) => [k, k === 'files' ? { type: 'string', multiple: true } : { type: 'string' }])),
    },
    USAGE,
    argv,
  );
  const path = flags.profile ? abs(flags.profile) : defaultProfilePath();
  const root = resolve(dirname(path), '..');
  let profile, schema;
  try {
    profile = loadProfile(path);
    if (!profile) die(`no profile at ${path} (a project without one runs the v1 mechanics)`, 1);
    schema = findSchema(flags.schema && abs(flags.schema));
  } catch (e) {
    die(e.message, 1);
  }
  const errors = checkProfile(profile, schema.schema);
  const warnings = errors.length ? [] : semanticWarnings(profile);
  const result = { profile: path, schema: schema.path, valid: errors.length === 0, errors, warnings, smoke: [] };

  if (flags.smoke && result.valid) {
    const values = Object.fromEntries(PH.map((k) => [k, flags[k]]));
    if (values.files) values.files = values.files.flatMap((f) => f.split(/\s+/)).filter(Boolean);
    let entries = smokeEntries(profile);
    for (const [name, g] of entriesOf(profile.gates))
      if (g.kind === 'agent' && (g.smoke === true || flags.only?.includes(`gates.${name}`)))
        result.smoke.push({ id: `gates.${name}`, cmd: g.cmd || '', status: 'skipped', reason: `agent gate: launched by a skill (verifier ${g.verifier})` });
    if (flags.only?.length) entries = entries.filter((e) => flags.only.includes(e.id));
    const PREP = ['commands.install', 'commands.build'];
    let prep = [];
    if (flags['install-first']) {
      prep = PREP.filter((id) => typeof profile.commands?.[id.slice(9)] === 'string').map((id) => ({ id, cmd: profile.commands[id.slice(9)], prep: true }));
      entries = [...prep, ...entries.filter((e) => !PREP.includes(e.id))];
    }
    let prepFailed = '';
    for (const e of entries) {
      if (prepFailed) {
        result.smoke.push({ id: e.id, cmd: e.cmd, status: 'skipped', reason: `${prepFailed} failed` });
        continue;
      }
      const { cmd, missing } = fill(e.cmd, values);
      if (missing.length) {
        result.smoke.push({ id: e.id, cmd, status: 'skipped', reason: `needs ${missing.map((m) => `--${m}`).join(' ')}` });
        continue;
      }
      if (flags.print) {
        result.smoke.push({ id: e.id, cmd, status: 'would-run' });
        continue;
      }
      const r = runShell(cmd, { prefix: profile.shell_prefix, cwd: root, timeoutSec: Number(flags.timeout || 600) });
      result.smoke.push({
        id: e.id,
        cmd,
        status: r.code === 0 ? 'pass' : 'fail',
        exit: r.code,
        ...(r.code === 0 ? {} : { tail: (r.stderr || r.stdout).trim().split('\n').slice(-5).join('\n') }),
      });
      if (e.prep && r.code !== 0) prepFailed = e.id;
    }
  }
  const failed = !result.valid || result.smoke.some((s) => s.status === 'fail');

  if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    const out = [`profile ${path}`, `schema  ${schema.path}`];
    out.push(result.valid ? 'valid' : `INVALID (${errors.length})`);
    for (const e of errors) out.push(`  - ${e}`);
    for (const w of warnings) out.push(`WARNING: ${w}`);
    for (const s of result.smoke) {
      const tag = s.status === 'fail' ? `FAIL exit ${s.exit}` : s.status;
      out.push(`  [${tag}] ${s.id}: ${s.cmd}${s.reason ? `  (${s.reason})` : ''}`);
      if (s.tail) out.push(...s.tail.split('\n').map((l) => `      ${l}`));
    }
    process.stdout.write(`${out.join('\n')}\n`);
  }
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
