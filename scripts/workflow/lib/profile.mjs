// Load, validate and read the project profile (<project>/.claude/workflow-profile.json).

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { readJson, placeholdersIn, quotedPlaceholders, PLACEHOLDERS, fill } from './common.mjs';
import { validate } from './schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_REL = join('.claude', 'templates', 'workflow-profile.schema.json');

/** Schema lookup: --schema, then this checkout's templates, then $WORKFLOW_HOME's. */
export function findSchema(explicit) {
  if (explicit) return { path: explicit, schema: readJson(explicit, 'schema') };
  const home = process.env.WORKFLOW_HOME || join(homedir(), '.claude', 'workflow-release');
  const tried = [];
  for (const base of [join(HERE, '..', '..', '..'), home]) {
    const p = join(base, SCHEMA_REL);
    tried.push(p);
    if (existsSync(p)) return { path: p, schema: readJson(p, 'schema') };
  }
  throw new Error(`no profile schema found (tried ${tried.join(', ')}); pass --schema`);
}

/** Cross-field rules a JSON Schema cannot state. */
export function semanticErrors(p) {
  const errs = [];
  const gates = p.gates || {};
  const heavy = p.heavy_jobs || {};
  for (const [tier, names] of Object.entries(p.tiers || {})) {
    if (tier === 'notes' || !Array.isArray(names)) continue;
    for (const n of names) if (!(n in gates)) errs.push(`$.tiers.${tier}: names gate "${n}", which is not in gates`);
  }
  for (const [name, g] of Object.entries(gates)) {
    if (g && g.heavy && !(g.heavy in heavy))
      errs.push(`$.gates.${name}.heavy: "${g.heavy}" is not a heavy_jobs slot`);
  }
  const cmds = [
    ...Object.entries(p.commands || {}).filter(([k]) => k !== 'notes').map(([k, v]) => [`$.commands.${k}`, v]),
    ...Object.entries(gates).map(([k, g]) => [`$.gates.${k}.cmd`, g?.cmd]),
    ['$.test_db.create', p.test_db?.create],
    ['$.test_db.bootstrap', p.test_db?.bootstrap],
  ];
  for (const [path, c] of cmds) {
    if (typeof c !== 'string') continue;
    for (const ph of placeholdersIn(c))
      if (!PLACEHOLDERS.includes(ph) && ph !== 'host')
        errs.push(`${path}: unknown placeholder {${ph}} (known: ${PLACEHOLDERS.join(', ')})`);
    for (const ph of quotedPlaceholders(c))
      errs.push(`${path}: placeholder {${ph}} is inside quotes; leave it bare, the scripts shell-quote every value`);
  }
  const url = p.test_db?.url;
  if (typeof url === 'string') {
    const phs = placeholdersIn(url);
    for (const ph of phs)
      if (!URL_PLACEHOLDERS.includes(ph)) errs.push(`$.test_db.url: unknown placeholder {${ph}} (known: ${URL_PLACEHOLDERS.join(', ')})`);
    // The host must come from test_db.host, so allow_hosts still guards it.
    for (const need of ['host', 'name'])
      if (!phs.includes(need)) errs.push(`$.test_db.url: needs {${need}}, so the URL follows test_db.host and the lane's DB name`);
  }
  const offs = Object.entries(p.ports?.offsets || {}).filter(([k]) => k !== 'notes');
  const seen = new Map();
  for (const [k, v] of offs) {
    if (seen.has(v)) errs.push(`$.ports.offsets.${k}: offset ${v} is also ${seen.get(v)}'s`);
    seen.set(v, k);
  }
  const r = p.ports?.range;
  if (Array.isArray(r) && r.length === 2 && r[0] > r[1]) errs.push('$.ports.range: start is above end');
  const db = p.test_db;
  if (db && db.host && Array.isArray(db.allow_hosts) && !db.allow_hosts.includes(db.host))
    errs.push(`$.test_db.host: "${db.host}" is not in allow_hosts`);
  return errs;
}

export function checkProfile(profile, schema) {
  const errors = validate(profile, schema);
  if (profile && typeof profile === 'object' && !Array.isArray(profile)) errors.push(...semanticErrors(profile));
  return errors;
}

/** Load a profile, or null when the file is absent (a project without a profile runs as v1). */
export function loadProfile(path) {
  if (!existsSync(path)) return null;
  return readJson(path, 'profile');
}

/** The commands a smoke run executes: smoke:true gates, then every commands.* entry. */
export function smokeEntries(p, { includeCommands = true } = {}) {
  const out = [];
  for (const [name, g] of Object.entries(p.gates || {}))
    if (g && g.smoke === true) out.push({ id: `gates.${name}`, cmd: g.cmd });
  if (includeCommands)
    for (const [k, v] of Object.entries(p.commands || {})) if (k !== 'notes' && typeof v === 'string') out.push({ id: `commands.${k}`, cmd: v });
  return out;
}

/** Placeholders a test_db.url template may use. */
export const URL_PLACEHOLDERS = ['host', 'port', 'name'];
export const DEFAULT_DB_URL = 'postgresql://{host}:{port}/{name}';

/**
 * The {url} placeholder for a lane's test DB: test_db.url (default postgresql://{host}:{port}/{name})
 * with {host} (default 127.0.0.1), {port} (default 5432) and {name} filled verbatim. The result is
 * shell-quoted when it is put into a command, like every other value.
 */
export const dbUrl = (db, name) =>
  fill(db?.url || DEFAULT_DB_URL, { host: db?.host || '127.0.0.1', port: db?.port || 5432, name }, { quote: false }).cmd;
