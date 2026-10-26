// T04: the revision counter follows real file changes, the poll path spawns no git, idle watchers close
// and reopen with a bumped revision. Real repositories and real fs.watch.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { disposeAll, resolve } from "../server/registry";
import { DEBOUNCE_MS, IDLE_MS, ensureWatching, stopWatching, sweepIdle, type Watched } from "../server/watch";

const bases: string[] = [];
after(() => {
  disposeAll();
  bases.forEach((b) => fs.rmSync(b, { recursive: true, force: true }));
});

function makeRepo() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "githistory-watch-")));
  bases.push(base);
  const g = (...args: string[]) => execFileSync("git", args, { cwd: base, encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "T");
  fs.writeFileSync(path.join(base, "a.txt"), "one\n");
  g("add", "a.txt");
  g("commit", "-q", "-m", "first");
  return { repo: base, g };
}

const watched = (repo: string): Watched => ({ workspaceId: "ws_t", toplevel: repo, revision: 1, state: "clean", lastAccess: Date.now(), stop: null });

async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) return false;
    await sleep(50);
  }
  return true;
}

test("editing a working file bumps the revision within the 3 s budget, once per burst", async () => {
  const { repo } = makeRepo();
  const w = watched(repo);
  await ensureWatching(w);
  try {
    await sleep(100);
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) fs.appendFileSync(path.join(repo, "a.txt"), `x${i}\n`);
    assert.ok(await until(() => w.revision > 1), "revision did not change");
    assert.ok(Date.now() - t0 < 3000);
    await sleep(DEBOUNCE_MS * 2);
    assert.equal(w.revision, 2, "a burst of writes is one revision");
  } finally {
    stopWatching(w, "test");
  }
});

test("a commit made outside the plugin bumps the revision", async () => {
  const { repo, g } = makeRepo();
  const w = watched(repo);
  await ensureWatching(w);
  try {
    await sleep(100);
    g("commit", "-q", "--allow-empty", "-m", "outside");
    assert.ok(await until(() => w.revision > 1));
  } finally {
    stopWatching(w, "test");
  }
});

test("repo state is cached by the watcher (merging appears without a poll-time git call)", async () => {
  const { repo, g } = makeRepo();
  const w = watched(repo);
  await ensureWatching(w);
  try {
    assert.equal(w.state, "clean");
    fs.writeFileSync(path.join(repo, ".git", "MERGE_HEAD"), g("rev-parse", "HEAD"));
    assert.ok(await until(() => w.state === "merging"));
  } finally {
    stopWatching(w, "test");
  }
});

test("writes under .git/objects and *.lock alone do not bump", async () => {
  const { repo } = makeRepo();
  const w = watched(repo);
  await ensureWatching(w);
  try {
    await sleep(150);
    fs.mkdirSync(path.join(repo, ".git", "objects", "zz"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".git", "objects", "zz", "obj"), "x");
    fs.writeFileSync(path.join(repo, ".git", "index.lock"), "x");
    fs.rmSync(path.join(repo, ".git", "index.lock"));
    await sleep(DEBOUNCE_MS * 3);
    assert.equal(w.revision, 1);
  } finally {
    stopWatching(w, "test");
  }
});

test("idle sweep closes only watchers nobody polled for 10 minutes", async () => {
  const { repo } = makeRepo();
  const idle = watched(repo);
  const busy = { ...watched(repo), workspaceId: "ws_busy" };
  await ensureWatching(idle);
  await ensureWatching(busy);
  idle.lastAccess = Date.now() - IDLE_MS - 1;
  sweepIdle([idle, busy]);
  assert.equal(idle.stop, null);
  assert.notEqual(busy.stop, null);
  stopWatching(busy, "test");
});

test("registry: concurrent first polls share one handle; a poll after idle close reopens and bumps", async () => {
  const { repo } = makeRepo();
  let lookups = 0;
  const paseo = {
    workspaces: {
      list: async () => {
        lookups++;
        await sleep(20);
        return { entries: [{ id: "ws_reg", workspaceDirectory: repo, projectRootPath: repo }] };
      },
    },
  } as never;
  const [a, b] = await Promise.all([resolve(paseo, { kind: "workspace", id: "ws_reg" }), resolve(paseo, { kind: "workspace", id: "ws_reg" })]);
  assert.equal(a, b);
  assert.equal(lookups, 1);
  assert.equal(a.revision, 1);
  stopWatching(a as Watched, "idle");
  const again = await resolve(paseo, { kind: "workspace", id: "ws_reg" });
  assert.equal(again.revision, 2, "changes while closed were missed, so clients must reload");
  assert.notEqual(again.stop, null);
  await assert.rejects(resolve(paseo, { kind: "workspace", id: "ws_unknown" }), /Unknown workspace/);
});

test("registry: a picked directory opens without being a workspace; non-repos and relative paths are reported", async () => {
  const { repo } = makeRepo();
  const paseo = { workspaces: { list: async () => ({ entries: [] }) } } as never;
  const h = await resolve(paseo, { kind: "path", path: repo });
  assert.equal(h.toplevel, repo);
  const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "githistory-plain-")));
  bases.push(plain);
  assert.equal((await resolve(paseo, { kind: "path", path: plain })).toplevel, null);
  await assert.rejects(resolve(paseo, { kind: "path", path: "relative/dir" }), /absolute/);
});
