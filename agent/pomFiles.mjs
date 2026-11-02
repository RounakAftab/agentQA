// The local files a spec needs: its page objects and whatever they import, followed through
// relative imports only. Saved with the run, so its test can be run again later (testRunner.mjs).
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_FILES = 40;
const MAX_BYTES = 200_000;
const EXTENSIONS = ['', '.ts', '.js', '.mjs', '.tsx', '/index.ts', '/index.js'];

// Relative module paths a source file imports or re-exports.
export const relativeImports = (source) =>
  [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]);

async function resolveFile(workspace, fromFile, spec) {
  const base = path.resolve(workspace, path.dirname(fromFile), spec);
  for (const ext of EXTENSIONS) {
    const full = base + ext;
    if (full !== workspace && !full.startsWith(workspace + path.sep)) return null;
    const stat = await fs.stat(full).catch(() => null);
    if (stat?.isFile()) return full;
  }
  return null;
}

// { 'tests/pages/LoginPage.ts': source, ... } for everything `specPath` imports locally.
export async function collectSpecFiles(workspace, specPath) {
  const files = {};
  const queue = [specPath];
  const seen = new Set([specPath]);
  while (queue.length && Object.keys(files).length < MAX_FILES) {
    const current = queue.shift();
    const source = await fs.readFile(path.join(workspace, current), 'utf8').catch(() => null);
    if (source == null) continue;
    if (current !== specPath) files[current] = source;
    for (const spec of relativeImports(source)) {
      const full = await resolveFile(workspace, current, spec);
      if (!full || full.split(path.sep).includes('node_modules')) continue;
      const rel = path.relative(workspace, full).split(path.sep).join('/');
      if (seen.has(rel)) continue;
      seen.add(rel);
      if ((await fs.stat(full)).size <= MAX_BYTES) queue.push(rel);
    }
  }
  return files;
}
