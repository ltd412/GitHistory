// Copies the shared sources into the Paseo plugin, whose compiler only sees files inside the plugin
// directory (plans/261026-paseo-plugin, Q5). The copies are generated — edit core/ and core-node/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const TARGETS = [
  { from: 'core', to: 'plugins/paseo/shared/core' },
  { from: 'core-node', to: 'plugins/paseo/server/core-node' },
];

export const header = (rel) => `// GENERATED from ${rel} by scripts/sync-core.mjs — do not edit; change ${rel} and run \`npm run sync-core\`.\n`;

export function expected() {
  const files = new Map();
  for (const t of TARGETS) {
    for (const name of fs.readdirSync(path.join(root, t.from)).filter((f) => f.endsWith('.ts')).sort()) {
      const rel = `${t.from}/${name}`;
      files.set(path.join(t.to, name), header(rel) + fs.readFileSync(path.join(root, rel), 'utf8'));
    }
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const want = expected();
  for (const t of TARGETS) {
    const dir = path.join(root, t.to);
    fs.mkdirSync(dir, { recursive: true });
    // Remove stale copies of files that no longer exist in the source.
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.ts') && !want.has(path.join(t.to, f))) fs.rmSync(path.join(dir, f));
  }
  for (const [rel, content] of want) fs.writeFileSync(path.join(root, rel), content);
  console.log(`sync-core: ${want.size} files`);
}
