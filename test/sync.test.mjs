// Fails when the plugin's copies of core/ or core-node/ drift from the source (run `npm run sync-core`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expected, TARGETS } from '../scripts/sync-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('plugin copies of core/ and core-node/ match the source', () => {
  const want = expected();
  for (const [rel, content] of want) {
    const file = path.join(root, rel);
    assert.ok(fs.existsSync(file), `${rel} is missing — run npm run sync-core`);
    assert.equal(fs.readFileSync(file, 'utf8'), content, `${rel} differs from its source — run npm run sync-core`);
  }
  for (const t of TARGETS) {
    for (const f of fs.readdirSync(path.join(root, t.to)).filter((x) => x.endsWith('.ts'))) {
      assert.ok(want.has(path.join(t.to, f)), `${t.to}/${f} has no source — run npm run sync-core`);
    }
  }
});
