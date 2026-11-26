// Load, validate and read the project profile (<project>/.claude/workflow-profile.json).

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, placeholdersIn, quotedPlaceholders, CORE_PLACEHOLDERS, KEY_PLACEHOLDERS, fill } from './common.mjs';
import { validate } from './schema.mjs';
import { workflowHome } from './home.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_REL = join('.claude', 'templates', 'workflow-profile.schema.json');

/** Schema lookup: --schema, then this checkout's templates, then $WH's (lib/home.mjs). */
export function findSchema(explicit) {
  if (explicit) return { path: explicit, schema: readJson(explicit, 'schema') };
  const home = workflowHome().path;
  const tried = [];
  for (const base of [join(HERE, '..', '..', '..'), home].filter(Boolean)) {
    const p = join(base, SCHEMA_REL);
    tried.push(p);
    if (existsSync(p)) return { path: p, schema: readJson(p, 'schema') };
  }
  throw new Error(`no profile schema found (tried ${tried.join(', ')}); pass --schema`);
}

/** The entries of a name -> object map (gates, heavy_jobs), without its "notes" string. */
export const entriesOf = (m) => Object.entries(m || {}).filter(([k, v]) => !(k === 'notes' && typeof v === 'string') && v && typeof v === 'object');

/** A gate's registry entry, or undefined for an unknown name (and for "notes"). */
export const gateOf = (p, name) => (name === 'notes' && typeof p.gates?.notes === 'string' ? undefined : p.gates?.[name] ?? undefined);

/** Conventional gate names skills look for (_shared-project-profile.md). */
export const CONVENTIONAL_GATES = ['reach-walk', 'caller-list'];

/** Cross-field rules a JSON Schema cannot state. */
export function semanticErrors(p) {
  const errs = [];
  const gates = Object.fromEntries(entriesOf(p.gates));
  const heavy = Object.fromEntries(entriesOf(p.heavy_jobs));
  const full = typeof p.commands?.test_full === 'string' ? p.commands.test_full.trim() : '';
  for (const [tier, names] of Object.entries(p.tiers || {})) {
    if (tier === 'notes' || !Array.isArray(names)) continue;
    for (const n of names) {
      if (!(n in gates)) errs.push(`$.tiers.${tier}: names gate "${n}", which is not in gates`);
      // C5: the full run happens once, after the final's fixes; never as a tier gate.
      else if (full && typeof gates[n].cmd === 'string' && gates[n].cmd.trim() === full)
        errs.push(`$.tiers.${tier}: gate "${n}" runs commands.test_full; the full run is never a tier gate (it runs once, after the final's fixes)`);
    }
  }
  for (const [name, g] of Object.entries(gates)) {
    if (g.heavy && !(g.heavy in heavy)) errs.push(`$.gates.${name}.heavy: "${g.heavy}" is not a heavy_jobs slot`);
    // C1: an agent gate is judged by an agent; every other kind is a command.
    if (g.kind === 'agent') {
      if (!g.verifier) errs.push(`$.gates.${name}: an agent gate needs "verifier" (the agent type that returns PASS)`);
      if (typeof g.asks === 'string' && /\n/.test(g.asks)) errs.push(`$.gates.${name}.asks: one line only`);
      if (g.heavy) errs.push(`$.gates.${name}.heavy: an agent gate takes no slot`);
    } else {
      if (!g.cmd) errs.push(`$.gates.${name}: missing required "cmd" (only an agent gate may omit it)`);
      for (const f of ['verifier', 'asks']) if (f in g) errs.push(`$.gates.${name}.${f}: only an agent gate has "${f}"`);
    }
  }
  const cmds = [
    ...Object.entries(p.commands || {}).filter(([k]) => k !== 'notes').map(([k, v]) => [`$.commands.${k}`, v]),
    ...Object.entries(gates).map(([k, g]) => [`$.gates.${k}.cmd`, g?.cmd]),
    ['$.merge.renumber', p.merge?.renumber],
    ['$.merge.check', p.merge?.check],
    ['$.test_db.create', p.test_db?.create],
    ['$.test_db.bootstrap', p.test_db?.bootstrap],
  ];
  for (const [key, known] of Object.entries(KEY_PLACEHOLDERS)) {
    const [root, k] = key.split('.');
    cmds.push([`$.${key}`, p[root]?.[k], known]);
  }
  for (const [path, c, known = [...CORE_PLACEHOLDERS, 'host']] of cmds) {
    if (typeof c !== 'string') continue;
    for (const ph of placeholdersIn(c))
      if (!known.includes(ph))
        errs.push(`${path}: unknown placeholder {${ph}} (known: ${known.filter((x) => x !== 'host').join(', ')})`);
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

/** Advice that does not invalidate a profile: printed as WARNING lines, exit unchanged. */
export function semanticWarnings(p) {
  const warns = [];
  const gates = Object.fromEntries(entriesOf(p.gates));
  // C4: a profile with risk routes and no reach walk relies on reading the reach tables by eye.
  if (Array.isArray(p.risk_routing) && p.risk_routing.length && !('reach-walk' in gates))
    warns.push('$.gates: risk_routing is set but no "reach-walk" gate is registered; /blueprint falls back to reading the reach tables (v1)');
  for (const [job, j] of entriesOf(p.heavy_jobs))
    if (!j.lock_dir) warns.push(`$.heavy_jobs.${job}.lock_dir: unset; slots default to \${TMPDIR:-/tmp}/workflow-slots/${job}, which differs per user and session`);
  for (const [name, g] of Object.entries(gates))
    if (g.kind === 'agent' && g.smoke === true) warns.push(`$.gates.${name}.smoke: an agent gate is never smoke-run (skills launch it)`);
  return warns;
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

/** The commands a smoke run executes: smoke:true gates (never an agent gate), then every commands.* entry. */
export function smokeEntries(p, { includeCommands = true } = {}) {
  const out = [];
  for (const [name, g] of entriesOf(p.gates))
    if (g.smoke === true && g.kind !== 'agent') out.push({ id: `gates.${name}`, cmd: g.cmd });
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
