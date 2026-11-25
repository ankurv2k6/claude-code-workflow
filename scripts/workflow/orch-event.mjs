#!/usr/bin/env node
// Record an orchestrator event in the living task list; times come from the system clock.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, die, abs, writeAtomic, withLock, nowStamp, git } from './lib/common.mjs';
import { findSection, findTable, splitRow, formatRow, col, stripCode } from './lib/tasklist.mjs';

const USAGE = `orch-event.mjs — write an event into the task list (templates/batch-progress.md format)

Usage:
  node orch-event.mjs <event> --task-list <path> [event flags] [--commit] [--dry-run]

Events:
  agent       upsert an Agents row, keyed by --id
              --lane --role (default lane) --id --worktree --branch --test-dbs --brief --effort
              --state (default running) --last-commit <sha>
              --relaunch-of <old id>: marks the old row "relaunched → <id>" and adds the new
              row, copying the old row's fields that are not given
  module      upsert a Module status row, keyed by --module
              --module --lane --status --verify --ui --commits --notes
  lane        set an Execution plan row's status: --lane --status
  decision    append to the Decision log: --module --decision --rationale
  correction  append to the Owner corrections log (created if absent):
              --text (the owner's words) --applied-to (what it changed) --beyond (yes/no/…)
  checkpoint  add a Checkpoint log line, newest first: --event

Status words: pending running verifying merged verify_failed blocked:<module> map to the
template's ⏳ 🔄 🔎 ✅ ⚠️ ⛔ forms; any other text is written as given.

Every event except checkpoint also adds a one-line Checkpoint log entry. The When/Launched cells
come from the clock (local time, YYYY-MM-DD HH:MM). The file is rewritten atomically under a
mkdir lock. --commit commits the task list alone ("chore(batch): <event>"). --dry-run prints
the new file and writes nothing.

Exit: 0 written · 1 the task list lacks the section or row · 2 usage.`;

const STATUS = {
  pending: '⏳ PENDING',
  running: '🔄 RUNNING',
  verifying: '🔎 VERIFYING',
  merged: '✅ MERGED',
  verify_failed: '⚠️ VERIFY_FAILED',
  'verify-failed': '⚠️ VERIFY_FAILED',
};
export const statusWord = (s) => {
  if (s === undefined) return undefined;
  const k = String(s).toLowerCase();
  if (STATUS[k]) return STATUS[k];
  const m = String(s).match(/^blocked(?::(.+))?$/i);
  if (m) return `⛔ BLOCKED(${m[1] || '?'})`;
  return s;
};

class Missing extends Error {}

/**
 * Edit the first table of a section. fn(header, rows) returns the new rows (arrays of cells).
 * When the section is absent and `create` is given ({ header, before }), it is inserted.
 */
function editTable(text, section, fn, create) {
  let lines = text.split('\n');
  let sec = findSection(lines, section);
  if (!sec) {
    if (!create) throw new Missing(`no "## ${section}" section`);
    const block = [`## ${section}`, '', formatRow(create.header), `|${create.header.map(() => '---').join('|')}|`, ''];
    const before = create.before && findSection(lines, create.before);
    const at = before ? before.start : lines.length;
    lines.splice(at, 0, ...block);
    sec = findSection(lines, section);
  }
  const t = findTable(lines, sec);
  if (!t) throw new Missing(`no table under "## ${section}"`);
  const rows = t.rows.map((i) => splitRow(lines[i]));
  const out = fn(t.header, rows).map((cells) => {
    const c = [...cells];
    while (c.length < t.header.length) c.push('');
    return formatRow(c.slice(0, Math.max(t.header.length, cells.length)));
  });
  lines.splice(t.sepIdx + 1, t.rows.length, ...out);
  return lines.join('\n');
}

/** Set cells by column pattern; undefined values leave the cell alone. */
function setCells(header, cells, pairs) {
  const c = [...cells];
  while (c.length < header.length) c.push('');
  for (const [patterns, v] of pairs) {
    if (v === undefined) continue;
    const i = col(header, ...patterns);
    if (i >= 0) c[i] = v;
  }
  return c;
}

const keyMatch = (cell, v) => stripCode(cell).toLowerCase() === String(v).toLowerCase();

export function applyEvent(text, ev, f, now = nowStamp()) {
  const need = (...ks) => {
    for (const k of ks) if (f[k] === undefined || f[k] === '') throw new UsageError(`${ev} needs --${k}`);
  };
  let summary;
  switch (ev) {
    case 'agent': {
      need('lane', 'id');
      summary = f['relaunch-of'] ? `relaunched ${f.lane} ${f['relaunch-of']} → ${f.id}` : `agent ${f.lane} ${f.id} ${f.state || 'running'}`;
      text = editTable(text, 'Agents', (h, rows) => {
        const cId = col(h, /agent id/i, /^id$/i);
        if (cId < 0) throw new Missing('the Agents table has no "Agent id" column');
        let old;
        if (f['relaunch-of']) {
          old = rows.find((r) => keyMatch(r[cId], f['relaunch-of']));
          if (!old) throw new Missing(`no Agents row with id ${f['relaunch-of']}`);
          const cState = col(h, /^state/i);
          if (cState >= 0) old[cState] = `relaunched → ${f.id}`;
        }
        const pairs = [
          [[/^lane/i], f.lane],
          [[/^role/i], f.role],
          [[/agent id/i, /^id$/i], f.id],
          [[/worktree/i], f.worktree],
          [[/branch/i], f.branch],
          [[/test db/i], f['test-dbs']],
          [[/brief/i], f.brief],
          [[/effort/i], f.effort],
          [[/last commit/i], f['last-commit']],
          [[/^state/i], f.state],
        ];
        const existing = rows.find((r) => keyMatch(r[cId], f.id));
        if (existing) {
          const i = rows.indexOf(existing);
          rows[i] = setCells(h, existing, pairs);
          return rows;
        }
        const seed = old ? [...old] : h.map(() => '');
        if (old && col(h, /last commit/i) >= 0) seed[col(h, /last commit/i)] = "";
        const row = setCells(h, seed, [
          ...pairs,
          [[/^role/i], f.role ?? (old ? undefined : 'lane')],
          [[/^state/i], f.state ?? 'running'],
          [[/launched/i], now],
        ]);
        rows.push(row);
        return rows;
      });
      break;
    }
    case 'module': {
      need('module');
      const st = statusWord(f.status);
      summary = `module ${f.module}${st ? ` ${st}` : ''}`;
      text = editTable(text, 'Module status', (h, rows) => {
        const cM = col(h, /^module/i);
        const pairs = [
          [[/^module/i], f.module],
          [[/^lane/i], f.lane],
          [[/^status/i], st],
          [[/^verify/i], f.verify],
          [[/ui parity/i, /^ui/i], f.ui],
          [[/commits/i], f.commits],
          [[/notes/i], f.notes],
        ];
        const i = rows.findIndex((r) => keyMatch(r[cM], f.module));
        if (i >= 0) rows[i] = setCells(h, rows[i], pairs);
        else rows.push(setCells(h, h.map(() => ''), pairs));
        return rows;
      });
      break;
    }
    case 'lane': {
      need('lane', 'status');
      const st = statusWord(f.status);
      summary = `lane ${f.lane} ${st}`;
      text = editTable(text, 'Execution plan', (h, rows) => {
        const cL = col(h, /^lane/i);
        const i = rows.findIndex((r) => keyMatch(r[cL], f.lane));
        if (i < 0) throw new Missing(`no Execution plan row for lane ${f.lane}`);
        rows[i] = setCells(h, rows[i], [[[/^status/i], st]]);
        return rows;
      });
      break;
    }
    case 'decision': {
      need('decision');
      summary = `decision${f.module ? ` ${f.module}` : ''}: ${f.decision}`;
      text = editTable(text, 'Decision log', (h, rows) => [
        ...rows,
        setCells(h, h.map(() => ''), [
          [[/^when/i, /date/i, /time/i], now],
          [[/^module/i], f.module ?? '—'],
          [[/^decision/i], f.decision],
          [[/rationale/i, /why/i, /reason/i], f.rationale ?? ''],
        ]),
      ]);
      break;
    }
    case 'correction': {
      need('text');
      summary = `owner correction: ${f.text}`;
      text = editTable(
        text,
        'Owner corrections',
        (h, rows) => [
          ...rows,
          setCells(h, h.map(() => ''), [
            [[/^when/i, /date/i, /time/i], now],
            [[/correction/i, /what/i, /said/i, /owner/i], f.text],
            [[/what it changed/i, /changed/i, /applied to/i, /action/i, /effect/i], f['applied-to'] ?? ''],
            [[/beyond/i], f.beyond],
          ]),
        ],
        {
          header: ['When', "Correction (owner's words)", 'What it changed', 'Applies beyond this batch?'],
          before: 'Deferred findings',
        },
      );
      break;
    }
    case 'checkpoint':
      need('event');
      summary = f.event;
      break;
    default:
      throw new UsageError(`unknown event "${ev}"`);
  }
  const line = ev === 'checkpoint' ? f.event : summary;
  text = editTable(text, 'Checkpoint log', (h, rows) => [
    setCells(h, h.map(() => ''), [
      [[/^when/i], now],
      [[/^event/i], line],
    ]),
    ...rows,
  ]);
  return { text, summary };
}

class UsageError extends Error {}

export function main(argv) {
  const s = { type: 'string' };
  const { flags, pos } = args(
    {
      'task-list': s,
      commit: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      ...Object.fromEntries(
        ['lane', 'role', 'id', 'worktree', 'branch', 'test-dbs', 'brief', 'effort', 'state', 'last-commit', 'relaunch-of',
          'module', 'status', 'verify', 'ui', 'commits', 'notes', 'decision', 'rationale', 'text', 'applied-to', 'beyond', 'event'].map((k) => [k, s]),
      ),
    },
    USAGE,
    argv,
  );
  if (pos.length !== 1) die(`expected one event\n\n${USAGE}`);
  if (!flags['task-list']) die(`--task-list is required\n\n${USAGE}`);
  const path = abs(flags['task-list']);
  if (!existsSync(path)) die(`no task list at ${path}`, 1);
  let summary;
  try {
    withLock(path, () => {
      const r = applyEvent(readFileSync(path, 'utf8'), pos[0], flags);
      summary = r.summary;
      if (flags['dry-run']) process.stdout.write(r.text);
      else writeAtomic(path, r.text);
    });
  } catch (e) {
    if (e instanceof UsageError) die(`${e.message}\n\n${USAGE}`);
    die(`orch-event: ${e.message}`, 1);
  }
  if (!flags['dry-run']) process.stdout.write(`${nowStamp()} ${summary}\n`);
  if (flags.commit && !flags['dry-run']) {
    const dir = dirname(path);
    const add = git(dir, 'add', '--', basename(path));
    const c = add.code === 0 ? git(dir, 'commit', '-q', '-m', `chore(batch): ${summary}`.slice(0, 120), '--', basename(path)) : add;
    if (c.code !== 0) die(`orch-event: commit failed: ${c.err || c.out}`, 1);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
