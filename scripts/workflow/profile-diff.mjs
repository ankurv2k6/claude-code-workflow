#!/usr/bin/env node
// Classify the changes between two workflow profiles, mechanically.

import { pathToFileURL } from 'node:url';
import { args, die, readJson } from './lib/common.mjs';

const USAGE = `profile-diff.mjs — classify the changes between two profiles

Usage:
  node profile-diff.mjs <old.json> <new.json> [--summary | --json]

Each change gets one class:
  addition        an existing gate named in a tier, a new invariant suite, a new risk route
  command-change  a commands.* entry or shell_prefix added or changed, a gate's cmd changed,
                  a new gate in the registry (a new cmd is new code execution), and a tier
                  entry naming such a new gate
  removal         anything taken away (a tier gate, a gate, a suite, a route, a command, a key)
  test-db-change  anything under test_db
  limit-change    limits.*, agents.max_concurrent, heavy_jobs.*.slots
  other           everything else (a gate's kind/heavy/smoke, ports, docs, …)
"updated", "provenance" and every "notes" field (at any depth) are bookkeeping: they are never
classified, only listed as ignored, so a profile edit that also adds provenance still counts as
additions only.

Only "addition" may be auto-applied; every other class is an owner item.

Output: the JSON document on stdout and a summary on stderr (default); --summary prints only
the summary on stdout; --json prints only the JSON.
Exit: 0 compared (whatever changed) · 2 usage or unreadable input.`;

const IGNORED = new Set(['updated', 'provenance']);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const routeKey = (r) => JSON.stringify([...(r?.paths || [])].sort()) + '→' + (r?.verifier ?? '');

/** A copy without any "notes" key, at any depth: notes are prose, never a change to classify. */
export function stripNotes(v) {
  if (Array.isArray(v)) return v.map(stripNotes);
  if (!isObj(v)) return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'notes').map(([k, x]) => [k, stripNotes(x)]));
}

export function diffProfiles(rawA, rawB) {
  const changes = [];
  const ignored = [];
  const a = stripNotes(rawA);
  const b = stripNotes(rawB);
  if (notesDiffer(rawA, rawB)) ignored.push('notes');
  const add = (cls, path, oldV, newV) => changes.push({ class: cls, path, old: oldV, new: newV, auto_apply: cls === 'addition' });

  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const o = a?.[k];
    const n = b?.[k];
    if (same(o, n)) continue;
    if (IGNORED.has(k)) {
      ignored.push(k);
      continue;
    }
    switch (k) {
      case 'tiers':
        diffTiers(o || {}, n || {}, add, a?.gates || {});
        break;
      case 'gates':
        diffGates(o || {}, n || {}, add);
        break;
      case 'invariant_suites':
        diffList('invariant_suites', o || [], n || [], add);
        break;
      case 'risk_routing':
        diffRoutes(o || [], n || [], add);
        break;
      case 'commands':
        diffMap('commands', o || {}, n || {}, add, () => 'command-change');
        break;
      case 'shell_prefix':
        add(n === undefined ? 'removal' : 'command-change', k, o, n);
        break;
      case 'test_db':
        add('test-db-change', k, o, n);
        break;
      case 'limits':
        diffMap('limits', o || {}, n || {}, add, () => 'limit-change');
        break;
      case 'agents':
        diffMap('agents', o || {}, n || {}, add, (sub) => (sub === 'max_concurrent' ? 'limit-change' : 'other'));
        break;
      case 'heavy_jobs':
        diffHeavy(o || {}, n || {}, add);
        break;
      default:
        if (n === undefined) add('removal', k, o, n);
        else if (isObj(o) && isObj(n)) diffMap(k, o, n, add, () => 'other');
        else add('other', k, o, n);
    }
  }
  const summary = {};
  for (const c of changes) summary[c.class] = (summary[c.class] || 0) + 1;
  return {
    changes,
    ignored,
    summary,
    only_additions: changes.length > 0 && changes.every((c) => c.class === 'addition'),
    owner_items: changes.filter((c) => !c.auto_apply).length,
  };
}

function notesDiffer(x, y) {
  const collect = (v, path = '', out = {}) => {
    if (Array.isArray(v)) v.forEach((e, i) => collect(e, `${path}[${i}]`, out));
    else if (isObj(v)) for (const [k, e] of Object.entries(v)) k === 'notes' ? (out[`${path}.notes`] = e) : collect(e, `${path}.${k}`, out);
    return out;
  };
  return JSON.stringify(collect(x)) !== JSON.stringify(collect(y));
}

/** Key-by-key diff of a flat map; removed keys are removals, others take classify(sub). */
function diffMap(prefix, o, n, add, classify) {
  for (const k of new Set([...Object.keys(o), ...Object.keys(n)])) {
    if (same(o[k], n[k])) continue;
    if (n[k] === undefined) add('removal', `${prefix}.${k}`, o[k], undefined);
    else add(classify(k), `${prefix}.${k}`, o[k], n[k]);
  }
}

function diffList(path, o, n, add) {
  const os = o.map((x) => JSON.stringify(x));
  const ns = n.map((x) => JSON.stringify(x));
  n.forEach((x, i) => !os.includes(ns[i]) && add('addition', path, undefined, x));
  o.forEach((x, i) => !ns.includes(os[i]) && add('removal', path, x, undefined));
}

function diffTiers(o, n, add, oldGates) {
  for (const t of new Set([...Object.keys(o), ...Object.keys(n)])) {
    if (same(o[t], n[t])) continue;
    const ol = Array.isArray(o[t]) ? o[t] : [];
    const nl = Array.isArray(n[t]) ? n[t] : [];
    // Only a gate the old registry already had is a mechanical addition; a new gate brings a new cmd.
    for (const g of nl) if (!ol.includes(g)) add(g in oldGates ? 'addition' : 'command-change', `tiers.${t}`, undefined, g);
    for (const g of ol) if (!nl.includes(g)) add('removal', `tiers.${t}`, g, undefined);
    const common = nl.filter((g) => ol.includes(g));
    const oc = ol.filter((g) => nl.includes(g));
    if (!same(common, oc)) add('other', `tiers.${t}`, oc, common); // reordered
  }
}

function diffGates(o, n, add) {
  for (const g of new Set([...Object.keys(o), ...Object.keys(n)])) {
    if (same(o[g], n[g])) continue;
    if (o[g] === undefined) add('command-change', `gates.${g}`, undefined, n[g]);
    else if (n[g] === undefined) add('removal', `gates.${g}`, o[g], undefined);
    else
      for (const f of new Set([...Object.keys(o[g]), ...Object.keys(n[g])])) {
        if (same(o[g][f], n[g][f])) continue;
        const cls = n[g][f] === undefined ? 'removal' : f === 'cmd' ? 'command-change' : 'other';
        add(cls, `gates.${g}.${f}`, o[g][f], n[g][f]);
      }
  }
}

function diffRoutes(o, n, add) {
  const om = new Map(o.map((r) => [routeKey(r), r]));
  const nm = new Map(n.map((r) => [routeKey(r), r]));
  for (const [k, r] of nm) {
    if (!om.has(k)) add('addition', 'risk_routing', undefined, r);
    else if (!same(om.get(k), r)) add('other', 'risk_routing', om.get(k), r);
  }
  for (const [k, r] of om) if (!nm.has(k)) add('removal', 'risk_routing', r, undefined);
}

function diffHeavy(o, n, add) {
  for (const j of new Set([...Object.keys(o), ...Object.keys(n)])) {
    if (same(o[j], n[j])) continue;
    if (o[j] === undefined) add('other', `heavy_jobs.${j}`, undefined, n[j]);
    else if (n[j] === undefined) add('removal', `heavy_jobs.${j}`, o[j], undefined);
    else diffMap(`heavy_jobs.${j}`, o[j], n[j], add, (f) => (f === 'slots' ? 'limit-change' : 'other'));
  }
}

export function summaryText(d) {
  if (!d.changes.length) return `no changes${d.ignored.length ? ` (ignored: ${d.ignored.join(', ')})` : ''}`;
  const lines = [
    `${d.changes.length} change(s): ${Object.entries(d.summary)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')}`,
  ];
  for (const c of d.changes) {
    const what = c.new !== undefined ? JSON.stringify(c.new) : JSON.stringify(c.old);
    lines.push(`  ${c.auto_apply ? 'auto ' : 'owner'}  ${c.class.padEnd(14)} ${c.path}  ${what.length > 80 ? what.slice(0, 77) + '…' : what}`);
  }
  lines.push(d.only_additions ? 'all changes are mechanical additions' : `${d.owner_items} owner item(s)`);
  if (d.ignored.length) lines.push(`ignored: ${d.ignored.join(', ')}`);
  return lines.join('\n');
}

export function main(argv) {
  const { flags, pos } = args({ summary: { type: 'boolean' }, json: { type: 'boolean' } }, USAGE, argv);
  if (pos.length !== 2) die(`expected <old> <new>\n\n${USAGE}`);
  let a, b;
  try {
    a = readJson(pos[0], 'old profile');
    b = readJson(pos[1], 'new profile');
  } catch (e) {
    die(e.message);
  }
  const d = diffProfiles(a, b);
  if (flags.summary) process.stdout.write(`${summaryText(d)}\n`);
  else {
    process.stdout.write(`${JSON.stringify(d, null, 2)}\n`);
    if (!flags.json) process.stderr.write(`${summaryText(d)}\n`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
