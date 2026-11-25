// Entry point for `node --test scripts/workflow/test/` (see package.json): imports every test file.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
for (const f of readdirSync(here).filter((x) => x.endsWith('.test.mjs')).sort()) await import(pathToFileURL(join(here, f)).href);
