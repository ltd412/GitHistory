// watchTree: nested and new directories fire, noise does not, and running out of inotify watches (ENOSPC)
// degrades to polling instead of throwing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { watchTree } from '../core-node/watch-tree.ts';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'githistory-wt-')));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 4000) => {
  for (let t = 0; t < ms && !cond(); t += 25) await sleep(25);
  return cond();
};

test('fires for nested files and for files in directories created after watching started', async () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'a/b'), { recursive: true });
  let n = 0;
  const stop = watchTree(root, () => n++, { fingerprint: async () => '' });
  try {
    await sleep(100);
    fs.writeFileSync(path.join(root, 'a/b/f.txt'), '1');
    assert.ok(await waitFor(() => n > 0), 'nested file change');
    n = 0;
    fs.mkdirSync(path.join(root, 'new'));
    await sleep(200);
    n = 0;
    fs.writeFileSync(path.join(root, 'new/g.txt'), '1');
    assert.ok(await waitFor(() => n > 0), 'file in a directory created later');
  } finally {
    stop();
  }
});

test('node_modules, git objects and lock files are noise', async () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'node_modules/x'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git/objects'), { recursive: true });
  let n = 0;
  const stop = watchTree(root, () => n++, { fingerprint: async () => '' });
  try {
    await sleep(100);
    fs.writeFileSync(path.join(root, 'node_modules/x/i.js'), '1');
    fs.writeFileSync(path.join(root, '.git/objects/ab'), '1');
    fs.writeFileSync(path.join(root, '.git/index.lock'), '1');
    await sleep(500);
    assert.equal(n, 0);
  } finally {
    stop();
  }
});

test('ENOSPC while watching falls back to polling and does not throw', { skip: process.platform !== 'linux' }, async () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'sub'));
  const real = fs.watch;
  let calls = 0;
  // @ts-expect-error test double
  fs.watch = (...a: any[]) => {
    if (++calls > 1) throw Object.assign(new Error('ENOSPC: System limit for number of file watchers reached'), { code: 'ENOSPC' });
    return (real as any)(...a);
  };
  let fp = 'one';
  let n = 0;
  let stop = () => {};
  try {
    stop = watchTree(root, () => n++, { fingerprint: async () => fp });
    await sleep(2300); // first poll records the baseline
    fp = 'two';
    assert.ok(await waitFor(() => n > 0, 5000), 'polling noticed the change');
  } finally {
    fs.watch = real;
    stop();
  }
});
