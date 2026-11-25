import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { SCRIPTS, run } from './helpers.mjs';

const ALL = ['profile-check.mjs', 'profile-diff.mjs', 'slot.sh', 'watchdog.mjs', 'orch-event.mjs', 'scaffold.mjs', 'build-report.mjs', 'release.sh', 'merge-lane.mjs', 'run-tier.mjs'];

test('every deliverable exists and prints --help with exit 0', () => {
  const present = readdirSync(SCRIPTS);
  for (const s of ALL) {
    assert.ok(present.includes(s), `${s} missing`);
    const r = run(s, ['--help']);
    assert.equal(r.code, 0, `${s} --help: ${r.err}`);
    assert.match(r.out, /Usage:/, `${s} --help prints a usage`);
  }
});

test('bash -n passes for every .sh, under the bash on PATH and under /bin/bash (3.2 on macOS)', () => {
  for (const s of readdirSync(SCRIPTS).filter((f) => f.endsWith('.sh')))
    for (const sh of ['bash', '/bin/bash']) {
      const r = spawnSync(sh, ['-n', join(SCRIPTS, s)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${sh} ${s}: ${r.stderr}`);
    }
});

test('scripts call bash from PATH, never a fixed /bin/bash', () => {
  for (const s of readdirSync(SCRIPTS).filter((f) => /\.(sh|mjs)$/.test(f))) {
    const text = spawnSync('cat', [join(SCRIPTS, s)], { encoding: 'utf8' }).stdout;
    assert.doesNotMatch(text, /^#!\/bin\/bash|spawnSync\('\/bin\/bash'|spawn\('\/bin\/bash'/m, s);
  }
  for (const s of readdirSync(join(SCRIPTS, 'lib'))) {
    const text = spawnSync('cat', [join(SCRIPTS, 'lib', s)], { encoding: 'utf8' }).stdout;
    assert.doesNotMatch(text, /'\/bin\/bash'/, s);
  }
});

test('the shell scripts avoid bash 4 features', () => {
  for (const s of readdirSync(SCRIPTS).filter((f) => f.endsWith('.sh'))) {
    const text = spawnSync('cat', [join(SCRIPTS, s)], { encoding: 'utf8' }).stdout;
    assert.doesNotMatch(text, /declare -A|mapfile|readarray|\$\{[A-Za-z_]+(,,|\^\^)\}|(^|[;&|]\s*)(flock|pkill|killall)\s/m, s);
  }
});

test('a bad flag exits 2', () => {
  for (const s of ALL) assert.equal(run(s, ['--no-such-flag']).code, 2, s);
});
