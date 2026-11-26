#!/usr/bin/env node
/**
 * Lint the shared commands and templates in this repo.
 *
 *   node scripts/check-skills.mjs
 *
 * Fails (exit 1) when:
 *   - a `_shared-*.md`, `~/.claude/templates/...` or `$WH/.claude/templates/...` reference does not resolve;
 *   - a retired phrase survives in a command or a Markdown template (rules a revision replaced);
 *   - a file carries a stray tool-call closing tag (`</content>`, `</invoke>`, `</parameter>`);
 *   - a shared protocol lacks frontmatter with a description and `disable-model-invocation: true`;
 *   - a workflow command that launches agents does not cite the effort budget;
 *   - a command or shared file names a profile key (`commands.test_task`, `tiers.merge`, `limits.*`, …)
 *     that the profile schema does not define.
 *
 * A retired phrase is allowed in a sentence that forbids it ("never in `.lane/report.md`").
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS = join(ROOT, '.claude/commands');
const TEMPLATES = join(ROOT, '.claude/templates');
const SCHEMA = join(TEMPLATES, 'workflow-profile.schema.json');

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
  'verify-implementation', 'verify-ui', 'commit', 'e2e-validate', 'workflow-sync',
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
  ['1,000+ tool calls', 'size lanes by the context budget (_shared-effort-budget.md)'],
  ['`.lane/report.md`', 'the lane report goes in the final reply under fixed headings'],
  ['Lanes of 3–6 hours', 'size lanes by the context budget, not by hours'],
  ['gitleaks detect', 'scans the whole tree; scan the staged diff with `gitleaks protect --staged`'],
];

/** A sentence that forbids the phrase is not a use of it. */
const NEGATION = /\b(never|no|not|without)\b/i;
const retiredUses = (text, phrase) =>
  text.split('\n').filter((line) => {
    for (let i = line.indexOf(phrase); i !== -1; i = line.indexOf(phrase, i + 1)) {
      const before = line.slice(0, i);
      if (!NEGATION.test(before.split(/[.!?][*_`)\]]*\s+/).pop())) return true;
    }
    return false;
  }).length;

/** Profile keys a command may name, checked against the schema. */
const PROFILE_ROOTS = [
  'commands', 'tiers', 'gates', 'risk_routing', 'heavy_jobs', 'test_db', 'limits', 'agents', 'ports',
  'known_reds', 'logs_dir', 'invariant_suites', 'tests', 'release',
];
const PROFILE_KEY = new RegExp(`^\\.?(${PROFILE_ROOTS.join('|')})((?:\\.[\\w*-]+)*)$`);
const FILE_EXT = /\.(sh|mjs|cjs|js|ts|json|md|ya?ml|py|txt)$/;
const schema = existsSync(SCHEMA) ? JSON.parse(readFileSync(SCHEMA, 'utf8')) : null;

/** Walk a dotted path through the schema; `*` matches any defined key. */
const inSchema = (path) => {
  let node = schema;
  for (const seg of path) {
    if (node?.type === 'array') node = node.items;
    if (!node || node.type !== 'object') return false;
    if (seg === '*') return Boolean(node.properties || node.additionalProperties);
    node = node.properties?.[seg] ?? (typeof node.additionalProperties === 'object' ? node.additionalProperties : null);
    if (!node) return false;
  }
  return true;
};

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
  for (const m of text.matchAll(/(?:~|\$WH)\/\.claude\/templates\/([\w./-]+[\w-])/g)) {
    if (!existsSync(join(TEMPLATES, m[1]))) problems.push(`${rel(file)}: reference to missing template ${m[1]}`);
  }

  for (const m of file.endsWith('.md') ? text.matchAll(/`([^`\n]+)`/g) : []) {
    const key = m[1].match(PROFILE_KEY);
    if (!key) continue;
    // `release.sh`, `tests.mjs`: a file name, not a key under the 2.1 roots.
    if (['tests', 'release'].includes(key[1]) && FILE_EXT.test(m[1])) continue;
    if (!schema) {
      problems.push(`${rel(file)}: names profile key \`${m[1]}\` but ${rel(SCHEMA)} is missing`);
      break;
    }
    const path = [key[1], ...key[2].split('.').filter(Boolean)];
    if (!inSchema(path)) problems.push(`${rel(file)}: profile key \`${m[1]}\` is not in the schema`);
  }

  const governed = file.startsWith(COMMANDS) ? WORKFLOW.includes(name) || name.startsWith('_shared-') : file.endsWith('.md');
  if (governed) {
    for (const [phrase, why] of RETIRED) {
      if (retiredUses(text, phrase)) problems.push(`${rel(file)}: retired phrase "${phrase}" (${why})`);
    }
  }

  if (!file.startsWith(COMMANDS)) continue;

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
