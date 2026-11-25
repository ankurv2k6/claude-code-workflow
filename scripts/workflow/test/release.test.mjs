import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readlinkSync, readFileSync, mkdirSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, run, write, sh } from './helpers.mjs';

/** A temp HOME whose ~/.claude/commands is a symlink to a v1 checkout, and a temp clone of a
 *  synthetic workflow repo tagged v2.0.0 and v2.0.1. */
function fixture(t) {
  const d = tmp(t);
  const home = join(d, 'home');
  const src = join(d, 'src');
  mkdirSync(src, { recursive: true });
  write(join(src, '.claude', 'commands', 'plan.md'), 'v2.0.0 plan\n');
  write(join(src, '.claude', 'templates', 'batch-progress.md'), 'template\n');
  write(join(src, 'VERSION'), '2.0.0\n');
  sh(src, 'git init -q -b main . && git add . && git commit -qm v2.0.0 && git tag v2.0.0', home);
  write(join(src, '.claude', 'commands', 'plan.md'), 'v2.0.1 plan\n');
  write(join(src, 'VERSION'), '2.0.1\n');
  sh(src, 'git commit -qam v2.0.1 && git tag v2.0.1', home);
  const clone = join(d, 'clone');
  sh(d, `git clone -q ${src} ${clone}`, home);
  const v1 = join(d, 'v1-install', '.claude', 'commands');
  write(join(v1, 'plan.md'), 'v1 plan\n');
  mkdirSync(join(home, '.claude'), { recursive: true });
  sh(d, `ln -s ${v1} ${join(home, '.claude', 'commands')}`, home);
  return { d, home, clone, v1 };
}

const rel = (home, ...a) => run('release.sh', [...a], { home });

test('release.sh dry run prints the plan and changes nothing', (t) => {
  const { home, clone, v1 } = fixture(t);
  const r = rel(home, 'v2.0.0', '--repo', clone);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\(dry-run\): v2\.0\.0 = [0-9a-f]{12} \(VERSION 2\.0\.0\)/);
  assert.match(r.out, /would git -C .* worktree add --quiet --detach .*workflow-release/);
  assert.match(r.out, /would ln -s .*workflow-release\/\.claude\/commands .*\.claude\/commands/);
  assert.match(r.out, /dry run: nothing changed/);
  assert.ok(!existsSync(join(home, '.claude', 'workflow-release')));
  assert.equal(readlinkSync(join(home, '.claude', 'commands')), v1);
  assert.ok(!existsSync(join(home, '.claude', 'templates')));
});

test('release.sh --apply installs a tag, moves to the next, and rolls back', (t) => {
  const { home, clone } = fixture(t);
  const dest = join(home, '.claude', 'workflow-release');
  const r = rel(home, 'v2.0.0', '--repo', clone, '--apply');
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(readlinkSync(join(home, '.claude', 'commands')), join(dest, '.claude', 'commands'));
  assert.equal(readlinkSync(join(home, '.claude', 'templates')), join(dest, '.claude', 'templates'));
  assert.equal(readFileSync(join(home, '.claude', 'commands', 'plan.md'), 'utf8'), 'v2.0.0 plan\n');
  assert.equal(sh(dest, 'git rev-parse --abbrev-ref HEAD', home), 'HEAD', 'detached');

  const up = rel(home, 'v2.0.1', '--repo', clone, '--apply');
  assert.equal(up.code, 0, up.err);
  assert.match(up.out, /currently v2\.0\.0 \(rollback: release\.sh v2\.0\.0 --apply\)/);
  assert.equal(readFileSync(join(home, '.claude', 'commands', 'plan.md'), 'utf8'), 'v2.0.1 plan\n');
  assert.match(up.out, /keep  .*commands ->/);

  const back = rel(home, 'v2.0.0', '--repo', clone, '--apply');
  assert.equal(back.code, 0);
  assert.equal(readFileSync(join(home, '.claude', 'commands', 'plan.md'), 'utf8'), 'v2.0.0 plan\n');
});

test('release.sh never deletes a real directory, and refuses a dirty release or a bad tag', (t) => {
  const { home, clone } = fixture(t);
  write(join(home, '.claude', 'templates', 'mine.md'), 'local\n');
  const r = rel(home, 'v2.0.0', '--repo', clone, '--apply');
  assert.equal(r.code, 0, r.err);
  const kept = readdirSync(join(home, '.claude')).find((n) => n.startsWith('templates.pre-release-'));
  assert.ok(kept, 'moved aside');
  assert.equal(readFileSync(join(home, '.claude', kept, 'mine.md'), 'utf8'), 'local\n');
  assert.ok(lstatSync(join(home, '.claude', 'templates')).isSymbolicLink());

  write(join(home, '.claude', 'workflow-release', '.claude', 'commands', 'plan.md'), 'edited\n');
  const dirty = rel(home, 'v2.0.1', '--repo', clone, '--apply');
  assert.equal(dirty.code, 1);
  assert.match(dirty.err, /local changes/);
  assert.equal(rel(home, 'v9.9.9', '--repo', clone).code, 1);
  assert.equal(rel(home).code, 2);
});

test('release.sh refuses a destination that is not a detached, linked release worktree', (t) => {
  const { d, home, clone } = fixture(t);
  const head = () => sh(clone, 'git symbolic-ref --short HEAD', home);
  const before = head();
  for (const dest of [clone, join(clone, '.claude')]) {
    const r = rel(home, 'v2.0.0', '--repo', clone, '--dest', dest, '--apply');
    assert.equal(r.code, 1, `${dest}: ${r.out}${r.err}`);
    assert.match(r.err, /main working tree|inside the checkout/);
  }
  const lane = join(d, 'lane-wt');
  sh(clone, `git worktree add -q -b lane/x ${lane}`, home);
  const r = rel(home, 'v2.0.0', '--repo', clone, '--dest', lane, '--apply');
  assert.equal(r.code, 1);
  assert.match(r.err, /on branch lane\/x/);
  assert.equal(head(), before, 'the main checkout never left its branch');
  assert.equal(sh(lane, 'git symbolic-ref --short HEAD', home), 'lane/x');
});

test('release.sh keeps each real directory aside under a unique name, even twice in one second', (t) => {
  const { home, clone } = fixture(t);
  write(join(home, '.claude', 'templates', 'one.md'), '1\n');
  assert.equal(rel(home, 'v2.0.0', '--repo', clone, '--apply').code, 0);
  // put a real directory back and switch again at once
  sh(home, `rm ${join(home, '.claude', 'templates')} && mkdir ${join(home, '.claude', 'templates')} && echo 2 > ${join(home, '.claude', 'templates', 'two.md')}`, home);
  assert.equal(rel(home, 'v2.0.1', '--repo', clone, '--apply').code, 0);
  const kept = readdirSync(join(home, '.claude')).filter((n) => n.startsWith('templates.pre-release-'));
  assert.equal(kept.length, 2, kept.join(', '));
  assert.ok(kept.every((n) => /^templates\.pre-release-\d{8}-\d{6}-\d+(-\d+)?$/.test(n)), kept.join(', '));
});

test('release.sh --help gives the switch-over order: pin v1, merge and tag, then v2', () => {
  const r = run('release.sh', ['--help']);
  const i1 = r.out.indexOf('release.sh v1.0.0 --apply');
  const i2 = r.out.indexOf('merge the new version into main');
  const i3 = r.out.indexOf('release.sh v2.0.0 --apply');
  assert.ok(i1 > 0 && i1 < i2 && i2 < i3, r.out);
});
