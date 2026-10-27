#!/usr/bin/env node
/**
 * Lint the shared commands and templates in this repo.
 *
 *   node scripts/check-skills.mjs
 *
 * Fails (exit 1) when:
 *   - a `_shared-*.md` or `~/.claude/templates/...` reference does not resolve;
 *   - a retired phrase survives in a command (rules the 2026-10-27 revision replaced);
 *   - a file carries a stray tool-call closing tag (`</content>`, `</invoke>`, `</parameter>`);
 *   - a shared protocol lacks frontmatter with a description and `disable-model-invocation: true`;
 *   - a workflow command that launches agents does not cite the effort budget.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS = join(ROOT, '.claude/commands');
const TEMPLATES = join(ROOT, '.claude/templates');

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const commandFiles = readdirSync(COMMANDS)
  .filter((f) => f.endsWith('.md'))
  .map((f) => join(COMMANDS, f));
const templateFiles = existsSync(TEMPLATES) ? walk(TEMPLATES) : [];

/** Commands the 2026-10-27 revision governs. Others predate it and are not held to its rules. */
const WORKFLOW = [
  'plan', 'analyze-plan', 'blueprint', 'design-ui', 'implement-plan', 'implement-batch',
  'verify-implementation', 'verify-ui', 'commit', 'e2e-validate',
];

const RETIRED = [
  ['Run `/compact`', 'an agent cannot run a slash command on itself; state lives on disk'],
  ['TaskOutput', 'completion comes by notification (_shared-agent-timeout.md)'],
  ['max_turns:', 'no turn caps; size the work instead (_shared-effort-budget.md)'],
  ['timeout: 1800000', 'no wall-clock ceilings on lanes'],
  ['exact colors as hex', 'theme tokens, not hex (_shared-ui-parity.md)'],
  ['zero Critical/High/Medium', 'only CRITICAL and HIGH block (_shared-triage.md)'],
  ['Max 2 Parallel', 'lanes up to max_lanes (implement-batch)'],
  ['Tailwind CDN', "use the project's own design-system sheet"],
  ['frontend-engineer', 'not an installed agent type'],
  ['/^M(1[0-3]|[1-9])$/', 'module ids are /^M\\d{1,3}[a-z]?$/'],
  ['--passWithNoTests', 'turns an empty selection into a false green'],
];

const STRAY_TAGS = ['</content>', '</invoke>', '</parameter>'];

const problems = [];
const rel = (p) => relative(ROOT, p);

for (const file of [...commandFiles, ...templateFiles]) {
  const text = readFileSync(file, 'utf8');
  const name = file.replace(/^.*\//, '').replace(/\.md$/, '');

  for (const tag of STRAY_TAGS) {
    if (text.split('\n').some((line) => line.trim() === tag)) problems.push(`${rel(file)}: stray "${tag}" line`);
  }

  for (const m of text.matchAll(/_shared-[a-z-]+\.md/g)) {
    if (!existsSync(join(COMMANDS, m[0]))) problems.push(`${rel(file)}: reference to missing ${m[0]}`);
  }
  for (const m of text.matchAll(/~\/\.claude\/templates\/([\w./-]+[\w-])/g)) {
    if (!existsSync(join(TEMPLATES, m[1]))) problems.push(`${rel(file)}: reference to missing template ${m[1]}`);
  }

  if (!file.startsWith(COMMANDS)) continue;

  if (WORKFLOW.includes(name) || name.startsWith('_shared-')) {
    for (const [phrase, why] of RETIRED) {
      if (text.includes(phrase)) problems.push(`${rel(file)}: retired phrase "${phrase}" (${why})`);
    }
  }

  if (name.startsWith('_shared-')) {
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm || !/description:/.test(fm[1]) || !/disable-model-invocation:\s*true/.test(fm[1])) {
      problems.push(`${rel(file)}: shared protocol needs frontmatter with description and disable-model-invocation: true`);
    }
  } else if (WORKFLOW.includes(name)) {
    if (!/^---\n[\s\S]*?description:[\s\S]*?\n---/.test(text)) problems.push(`${rel(file)}: missing frontmatter description`);
    const launchesAgents = /subagent_type|background agent|launch (one|the|\d)/i.test(text);
    if (launchesAgents && !text.includes('_shared-effort-budget')) {
      problems.push(`${rel(file)}: launches agents but does not cite _shared-effort-budget.md`);
    }
  }
}

if (problems.length) {
  console.error(`check-skills: ${problems.length} problem(s)\n` + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`check-skills: OK (${commandFiles.length} commands, ${templateFiles.length} templates)`);
