// Read and edit the living task list (templates/batch-progress.md): a front-matter header plus
// Markdown sections holding one table each. Parsing is tolerant: sections are found by heading
// prefix, columns by header name, and unknown columns are kept as they are.

export function frontmatter(text) {
  const lines = text.split('\n');
  const fields = {};
  if (lines[0]?.trim() !== '---') return { fields, end: -1 };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return { fields, end: i };
    const m = lines[i].match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return { fields: {}, end: -1 };
}

export function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '\\|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

export const cell = (v) =>
  String(v ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/(?<!\\)\|/g, '\\|')
    .trim();

export const formatRow = (cells) => `| ${cells.map(cell).join(' | ')} |`;

const isSep = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
const isRow = (line) => /^\s*\|/.test(line);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Locate a `## <name…>` section: [heading index, end index (exclusive)]. */
export function findSection(lines, name) {
  const want = norm(name);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{2,3})\s+(.*)$/);
    if (!m) continue;
    if (start >= 0) return { start, end: i };
    if (norm(m[2]).startsWith(want)) start = i;
  }
  return start >= 0 ? { start, end: lines.length } : null;
}

/** The first table inside a section. */
export function findTable(lines, sec) {
  for (let i = sec.start + 1; i < sec.end - 1; i++) {
    if (isRow(lines[i]) && isSep(lines[i + 1])) {
      const header = splitRow(lines[i]);
      const rows = [];
      let j = i + 2;
      while (j < sec.end && isRow(lines[j])) rows.push(j++);
      return { headerIdx: i, sepIdx: i + 1, header, rows, endIdx: j };
    }
  }
  return null;
}

/** Column index whose header matches one of the patterns. */
export function col(header, ...patterns) {
  for (const p of patterns) {
    const i = header.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

/** Rows of a section's table as objects keyed by header text (plus `_cells`, `_idx`). */
export function readTable(text, section) {
  const lines = text.split('\n');
  const sec = findSection(lines, section);
  if (!sec) return null;
  const t = findTable(lines, sec);
  if (!t) return { header: [], rows: [] };
  const rows = t.rows.map((idx) => {
    const cells = splitRow(lines[idx]);
    const o = { _cells: cells, _idx: idx };
    t.header.forEach((h, k) => (o[h] = cells[k] ?? ''));
    return o;
  });
  return { header: t.header, rows };
}

export const stripCode = (s) => String(s || '').replace(/^`+|`+$/g, '').trim();
