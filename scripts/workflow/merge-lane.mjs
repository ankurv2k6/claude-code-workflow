#!/usr/bin/env node
// Merge one lane branch into the integration branch: --no-ff merge, migration renumber and check, tiers.merge.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, die, abs, git, fill, runShell, projectRoot } from './lib/common.mjs';
import { loadProfile, checkProfile, findSchema } from './lib/profile.mjs';
import { planTier, runSteps, tierLine } from './lib/tier.mjs';

const PH = ['name', 'url', 'port', 'set'];

const USAGE = `merge-lane.mjs — merge a lane into the integration branch (dry run unless --apply)

Usage:
  node merge-lane.mjs --lane <branch> [--into <branch>] [--repo <dir>] [--profile <path>]
                      [--verified-head <sha>] [--message <text>] [--keep-conflict] [--apply]
                      [--log-dir <dir>] [--holder <name>] [--json] [--name --url --port --set]

Steps (--apply; without it, each is printed and conflicts are predicted with git merge-tree):
  1. git merge --no-ff <lane> into --into (default: the branch checked out in --repo), which must
     be checked out with no tracked changes. A lane already contained in it is "already merged".
  2. A conflict is never resolved here: the conflicted files are listed, the merge is aborted
     (--keep-conflict leaves it in progress for a resolution by hand) and the exit is 2.
  3. merge.renumber, when the profile defines it, with {base} = the integration head before the
     merge: it puts the lane's colliding migrations after the integration head's. If it changes
     the tree, the change is committed ("chore(merge): renumber migrations from <lane>"). Then
     merge.check, when defined, verifies the journal.
  4. tiers.merge, through the tier runner (heavy gates through slot.sh unless self-locking; an
     agent gate is listed for the orchestrator to launch, never run). Skipped when
     --verified-head equals the lane head, that head contains the integration head, and the
     renumber changed nothing: the verifier ran the tier green on exactly what merged.
Placeholders in gates: {base} (integration head before the merge), {lane} (the lane branch's
last path segment), and --name --url --port --set (the integration test DB, ports, set).
Commands run as "bash -c '<shell_prefix> <cmd>'" in --repo; each gate's output goes to
<log-dir>/merge-<lane>-<gate>.log (default: the profile's logs_dir, else "logs").
Prints at most 10 lines.

Exit: 0 merged (or the dry run found nothing in the way) and green · 1 a red (renumber, check
or a merge gate; the merge commit stays) · 2 a conflict, or usage · 3 refused (wrong branch,
tracked changes, unknown lane) · 75 a merge gate's slot wait timed out.`;

const short = (s) => (s ? s.slice(0, 12) : '?');

/** Predict conflicts without touching the tree (git >= 2.38); null when unsupported. */
function predictConflicts(repo, into, lane) {
  const r = git(repo, 'merge-tree', '--write-tree', '--name-only', '--no-messages', into, lane);
  if (r.code === 0) return [];
  if (r.code === 1) return r.out.split('\n').slice(1).filter(Boolean);
  return null;
}

export async function main(argv) {
  const { flags } = args(
    {
      lane: { type: 'string' },
      into: { type: 'string' },
      repo: { type: 'string' },
      profile: { type: 'string' },
      'verified-head': { type: 'string' },
      message: { type: 'string' },
      'keep-conflict': { type: 'boolean' },
      apply: { type: 'boolean' },
      'log-dir': { type: 'string' },
      holder: { type: 'string' },
      json: { type: 'boolean' },
      ...Object.fromEntries(PH.map((k) => [k, { type: 'string' }])),
    },
    USAGE,
    argv,
  );
  if (!flags.lane) die(`--lane is required\n\n${USAGE}`);
  const repo = flags.repo ? abs(flags.repo) : projectRoot();
  const profilePath = flags.profile ? abs(flags.profile) : join(repo, '.claude', 'workflow-profile.json');
  let profile = null;
  try {
    profile = loadProfile(profilePath);
    if (profile) {
      const errs = checkProfile(profile, findSchema().schema);
      if (errs.length) die(`profile ${profilePath} is invalid:\n  ${errs.join('\n  ')}`, 1);
    }
  } catch (e) {
    die(e.message, 1);
  }
  const lines = [];
  const res = { lane: flags.lane, applied: !!flags.apply };
  const finish = (code, result) => {
    res.code = code;
    res.result = result;
    if (flags.json) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    else process.stdout.write(`${[...lines.slice(0, 9), `RESULT: ${result}`].join('\n')}\n`);
    return code;
  };
  const cur = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
  if (cur.code !== 0) die(`${repo} is not a git repo`, 3);
  const into = flags.into || cur.out;
  const laneHead = git(repo, 'rev-parse', '--verify', '--quiet', `${flags.lane}^{commit}`).out;
  const intoBefore = git(repo, 'rev-parse', '--verify', '--quiet', `${into}^{commit}`).out;
  lines.push(`merge-lane (${flags.apply ? 'apply' : 'dry run'}): ${flags.lane} (${short(laneHead)}) -> ${into} (${short(intoBefore)})`);
  Object.assign(res, { into, laneHead, intoBefore });
  if (!laneHead) return finish(3, `REFUSED: no branch or commit ${flags.lane}`);
  if (!intoBefore) return finish(3, `REFUSED: no branch ${into}`);
  if (git(repo, 'merge-base', '--is-ancestor', laneHead, intoBefore).code === 0) return finish(0, `GREEN: already merged (${into} contains ${short(laneHead)})`);

  const laneToken = flags.lane.split('/').pop();
  const values = { base: intoBefore, lane: laneToken, ...Object.fromEntries(PH.map((k) => [k, flags[k]])) };
  const prefix = profile?.shell_prefix || '';
  const logDir = flags['log-dir'] ? abs(flags['log-dir']) : join(repo, profile?.logs_dir || 'logs');
  const verified = flags['verified-head'] ? git(repo, 'rev-parse', '--verify', '--quiet', `${flags['verified-head']}^{commit}`).out : '';
  const containsInto = git(repo, 'merge-base', '--is-ancestor', intoBefore, laneHead).code === 0;
  const canSkip = !!verified && verified === laneHead && containsInto;
  const renumber = profile?.merge?.renumber;
  const check = profile?.merge?.check;
  res.skipTierEligible = canSkip;

  if (!flags.apply) {
    const conflicts = predictConflicts(repo, into, flags.lane);
    res.conflicts = conflicts;
    lines.push(`  merge: git merge --no-ff ${flags.lane}${conflicts === null ? ' (conflict prediction needs git >= 2.38)' : conflicts.length ? `: ${conflicts.length} conflict(s)` : ': no conflict predicted'}`);
    if (conflicts?.length) lines.push(`  conflicts: ${conflicts.slice(0, 6).join(', ')}${conflicts.length > 6 ? ` +${conflicts.length - 6} more` : ''}`);
    lines.push(`  renumber: ${renumber ? fill(renumber, values).cmd : 'none defined'} · check: ${check || 'none defined'}`);
    const steps = profile ? planTier(profile, 'merge', values) : null;
    lines.push(
      `  tiers.merge: ${!steps ? 'none (v1: by hand)' : canSkip ? `would skip if the renumber changes nothing (verifier green on ${short(laneHead)}, which contains ${short(intoBefore)})` : tierLine(steps.map((s) => ({ ...s, status: s.status === 'run' ? 'would-run' : s.status })))}`,
    );
    return conflicts?.length ? finish(2, `CONFLICT predicted (${conflicts.length} file(s)); nothing changed`) : finish(0, 'dry run: nothing changed (add --apply)');
  }

  if (cur.out !== into) return finish(3, `REFUSED: ${repo} is on ${cur.out}, not ${into}; check out ${into} first`);
  if (git(repo, 'status', '--porcelain', '--untracked-files=no').out) return finish(3, `REFUSED: ${repo} has tracked changes; commit or discard them first`);

  // 1-2. the merge
  const msg = flags.message || `merge: ${flags.lane} into ${into}`;
  const m = git(repo, 'merge', '--no-ff', '--no-edit', '-m', msg, flags.lane);
  if (m.code !== 0) {
    const conflicts = git(repo, 'diff', '--name-only', '--diff-filter=U').out.split('\n').filter(Boolean);
    res.conflicts = conflicts;
    if (!conflicts.length) {
      git(repo, 'merge', '--abort');
      return finish(1, `RED: git merge failed: ${(m.err || m.out).split('\n')[0]}`);
    }
    if (!flags['keep-conflict']) git(repo, 'merge', '--abort');
    lines.push(`  conflicts: ${conflicts.slice(0, 6).join(', ')}${conflicts.length > 6 ? ` +${conflicts.length - 6} more` : ''}`);
    return finish(2, `CONFLICT (${conflicts.length} file(s)); ${flags['keep-conflict'] ? 'merge left in progress: resolve by hand' : 'merge aborted, nothing changed'}`);
  }
  const mergeSha = git(repo, 'rev-parse', 'HEAD').out;
  res.merge = mergeSha;
  lines.push(`  merge: ${short(mergeSha)} (--no-ff)`);

  // 3. renumber and check
  let renumbered = false;
  if (renumber) {
    const f = fill(renumber, values);
    if (f.missing.length) return finish(1, `RED: merge.renumber needs {${f.missing.join('}, {')}}`);
    const r = runShell(f.cmd, { prefix, cwd: repo });
    if (r.code !== 0) {
      lines.push(`  renumber: FAIL exit ${r.code}: ${(r.stderr || r.stdout).trim().split('\n').pop() || ''}`);
      return finish(1, 'RED: merge.renumber (the merge commit stays)');
    }
    if (git(repo, 'status', '--porcelain').out) {
      git(repo, 'add', '-A');
      const c = git(repo, 'commit', '-q', '-m', `chore(merge): renumber migrations from ${flags.lane}`);
      if (c.code !== 0) return finish(1, `RED: committing the renumber failed: ${c.err.split('\n')[0]}`);
      renumbered = true;
      lines.push(`  renumber: changed the tree, committed ${short(git(repo, 'rev-parse', 'HEAD').out)}`);
    } else lines.push('  renumber: no change');
  }
  if (check) {
    const r = runShell(check, { prefix, cwd: repo });
    lines.push(`  check: ${r.code === 0 ? 'pass' : `FAIL exit ${r.code}`}`);
    if (r.code !== 0) return finish(1, 'RED: merge.check (the merge commit stays)');
  }

  // 4. tiers.merge
  if (!profile) return finish(0, 'GREEN: merged; no profile, so the v1 merge checks run by hand');
  if (canSkip && !renumbered) {
    lines.push(`  tiers.merge: skipped (verifier green on ${short(laneHead)}, which contains ${short(intoBefore)})`);
    return finish(0, `GREEN: merged at ${short(git(repo, 'rev-parse', 'HEAD').out)}`);
  }
  const steps = planTier(profile, 'merge', values, { holder: flags.holder });
  if (!steps) return finish(0, `GREEN: merged at ${short(mergeSha)}; the profile has no tiers.merge`);
  const safe = laneToken.replace(/[^A-Za-z0-9._-]+/g, '-');
  const { code } = await runSteps(steps, { prefix, cwd: repo, logDir, logPrefix: `merge-${safe}-` });
  res.steps = steps;
  lines.push(`  tiers.merge: ${tierLine(steps)}`);
  const agents = steps.filter((s) => s.agent && s.status === 'agent');
  if (agents.length) lines.push(`  agent gates to launch: ${agents.map((s) => `${s.name} (${s.verifier})`).join(', ')}`);
  const red = steps.find((s) => ['fail', 'unknown', 'unfilled'].includes(s.status));
  if (red) lines.push(`  log: ${red.log || red.reason || ''}`);
  const head = short(git(repo, 'rev-parse', 'HEAD').out);
  if (code === 75) return finish(75, `NOT RUN: a merge gate's slot wait timed out; merged at ${head}, re-run the tier`);
  return code ? finish(1, `RED: ${red?.name} (merged at ${head}; the merge commit stays)`) : finish(0, `GREEN: merged at ${head}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).then((c) => process.exit(c));
