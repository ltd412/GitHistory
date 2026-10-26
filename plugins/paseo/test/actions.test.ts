// write/job/history behaviour against real repositories: idempotency by opId (flows.md F3), network ops as
// jobs (F5), undo/redo (F8).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { job, read, undoRedo, write } from "../server/actions";
import { disposeAll } from "../server/registry";

const bases: string[] = [];
after(() => {
  disposeAll();
  bases.forEach((b) => fs.rmSync(b, { recursive: true, force: true }));
});
const ctx = { paseo: { workspaces: { list: async () => ({ entries: [] }) } } } as never;

function makeRepo() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "githistory-actions-")));
  bases.push(base);
  const g = (...args: string[]) => execFileSync("git", args, { cwd: base, encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "T");
  fs.writeFileSync(path.join(base, "a.txt"), "one\n");
  g("add", "a.txt");
  g("commit", "-q", "-m", "first");
  return { repo: { kind: "path" as const, path: base }, dir: base, g };
}
const count = (g: (...a: string[]) => string) => Number(g("rev-list", "--count", "HEAD").trim());

test("the same opId twice makes one commit (sequential retry)", async () => {
  const { repo, dir, g } = makeRepo();
  fs.writeFileSync(path.join(dir, "b.txt"), "b\n");
  g("add", "b.txt");
  const call = { repo, opId: "op-commit-0001", op: "commit", args: { message: "second" } };
  await write(call, ctx);
  await write(call, ctx);
  assert.equal(count(g), 2);
});

test("the same opId twice concurrently also makes one commit", async () => {
  const { repo, dir, g } = makeRepo();
  fs.writeFileSync(path.join(dir, "b.txt"), "b\n");
  g("add", "b.txt");
  const call = { repo, opId: "op-commit-0002", op: "commit", args: { message: "second" } };
  await Promise.all([write(call, ctx), write(call, ctx)]);
  assert.equal(count(g), 2);
});

test("a failed op replays its error for the same opId and does not rerun", async () => {
  const { repo, g } = makeRepo();
  const call = { repo, opId: "op-commit-0003", op: "commit", args: { message: "nothing staged" } };
  await assert.rejects(write(call, ctx));
  fs.writeFileSync(path.join(repo.path, "c.txt"), "c\n");
  g("add", "c.txt");
  await assert.rejects(write(call, ctx), "same opId must not run again now that it would succeed");
  assert.equal(count(g), 1);
});

test("a refused network op fails the call itself instead of becoming a job", async () => {
  const { repo } = makeRepo();
  await assert.rejects(write({ repo, opId: "op-fetch-0001", op: "fetch", args: { remote: "--upload-pack=x" } }, ctx), /'-'/);
});

test("a network op returns a job that ends failed with git's message", async () => {
  const { repo } = makeRepo();
  const { jobId } = await write({ repo, opId: "op-fetch-0002", op: "fetch", args: { remote: "nowhere" } }, ctx);
  assert.ok(jobId);
  let j = await job({ repo, jobId: jobId! }, ctx);
  for (let i = 0; i < 100 && j.status === "running"; i++) {
    await sleep(50);
    j = await job({ repo, jobId: jobId! }, ctx);
  }
  assert.equal(j.status, "failed");
  assert.match(j.error ?? "", /nowhere/);
  await assert.rejects(job({ repo, jobId: "job_unknown" }, ctx), /interrupted/);
});

test("commit then undo moves HEAD back once; redo restores it", async () => {
  const { repo, dir, g } = makeRepo();
  fs.writeFileSync(path.join(dir, "b.txt"), "b\n");
  g("add", "b.txt");
  await write({ repo, opId: "op-commit-0004", op: "commit", args: { message: "second" } }, ctx);
  assert.deepEqual(await undoRedo({ repo, action: "peek" }, ctx), { label: null, undo: "Commit", redo: null });
  const u = { repo, action: "undo" as const, opId: "op-undo-00001" };
  assert.equal((await undoRedo(u, ctx)).label, "Commit");
  await undoRedo(u, ctx);
  assert.equal(count(g), 1, "undo twice with the same opId only steps back once");
  await undoRedo({ repo, action: "redo", opId: "op-redo-00001" }, ctx);
  assert.equal(count(g), 2);
});

test("read returns op results and refuses paths outside the repo", async () => {
  const { repo } = makeRepo();
  assert.equal((await read({ repo, op: "readWorkingFile", args: { file: "a.txt" } }, ctx)).result, "one\n");
  await assert.rejects(read({ repo, op: "readWorkingFile", args: { file: "../x" } }, ctx), /outside/);
});
