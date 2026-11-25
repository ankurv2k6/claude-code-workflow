#!/usr/bin/env node
// Validate a project's workflow profile; with --smoke, run its smoke-safe gates and commands.

import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, die, fill, runShell, defaultProfilePath, abs } from './lib/common.mjs';
import { findSchema, checkProfile, loadProfile, smokeEntries } from './lib/profile.mjs';

const USAGE = `profile-check.mjs — validate <project>/.claude/workflow-profile.json

Usage:
  node profile-check.mjs [--profile <path>] [--schema <path>] [--json]
  node profile-check.mjs --smoke [placeholder flags] [--only <id>]… [--print] [--timeout <s>]

Checks the profile against the schema (--schema, else .claude/templates/
workflow-profile.schema.json in this checkout, else in $WORKFLOW_HOME), then cross-field rules: every tier names a known gate, every "heavy" names a heavy_jobs slot,
placeholders are known, test_db.host is in allow_hosts.

--smoke runs every gate with "smoke": true and every commands.* entry, each through
"bash -c '<shell_prefix> <cmd>'" in the project root, and reports each exit code. Placeholders
come from flags; an entry whose placeholders are not all given is reported as skipped.

Placeholder flags: --files --base --name --url --port --lane --set
Options:
  --profile <path>  default: .claude/workflow-profile.json in the nearest project root
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
      print: { type: 'boolean' },
      json: { type: 'boolean' },
      only: { type: 'string', multiple: true },
      timeout: { type: 'string' },
      ...Object.fromEntries(PH.map((k) => [k, { type: 'string' }])),
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
  const result = { profile: path, schema: schema.path, valid: errors.length === 0, errors, smoke: [] };

  if (flags.smoke && result.valid) {
    const values = Object.fromEntries(PH.map((k) => [k, flags[k]]));
    let entries = smokeEntries(profile);
    if (flags.only?.length) entries = entries.filter((e) => flags.only.includes(e.id));
    for (const e of entries) {
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
    }
  }
  const failed = !result.valid || result.smoke.some((s) => s.status === 'fail');

  if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    const out = [`profile ${path}`, `schema  ${schema.path}`];
    out.push(result.valid ? 'valid' : `INVALID (${errors.length})`);
    for (const e of errors) out.push(`  - ${e}`);
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
