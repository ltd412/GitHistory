// The one door from an RPC op name to a git call (solution.md §4). An op runs only if it is in the
// allowlist (shared/ops.ts), its args pass that op's schema, and every path it names stays inside the
// repository. There is no op that runs a shell command (plan.md Q3).
import type { z } from "zod";
import * as git from "./core-node/git";
import { GuardError, assertInsideRepo, assertPatchInsideRepo } from "./guard";
import { READ_OPS, WRITE_OPS, type ReadArgs, type ReadOp, type WriteArgs, type WriteOp } from "../shared/ops";

type Runner<A> = (repo: string, a: A) => Promise<unknown>;
/** Git functions by name; the undo history passes recording versions of some of them (core-node/history.ts). */
export type GitImpl = typeof git & Record<string, (...args: any[]) => Promise<any>>;
type WriteRunner<A> = (g: GitImpl, repo: string, a: A, onProgress?: (chunk: string) => void) => Promise<unknown>;

const READ: { [O in ReadOp]: Runner<ReadArgs<O>> } = {
  log: (r, a) => git.log(r, a),
  searchCommits: (r, a) => git.searchCommits(r, a.query),
  fileHistory: (r, a) => git.fileHistory(r, a.file),
  commitDetails: (r, a) => git.commitDetails(r, a.hash),
  commitMessage: (r, a) => git.commitMessage(r, a.hash),
  lastCommitMessage: (r) => git.lastCommitMessage(r),
  diffWorking: (r, a) => git.diffWorking(r, a.file, a),
  diffCommit: (r, a) => git.diffCommit(r, a.hash, a.file, a.oldPath, a.ignoreWs, a.full),
  diffStash: (r, a) => git.diffStash(r, a.hash, a.file, a.untracked, a.ignoreWs, a.full),
  diffRange: (r, a) => git.diffRange(r, a.from, a.to, a.file, a.oldPath, a.ignoreWs, a.full),
  rangeFiles: (r, a) => git.rangeFiles(r, a.from, a.to),
  showFile: (r, a) => git.showFile(r, a.rev, a.file),
  readWorkingFile: (r, a) => git.readWorkingFile(r, a.file),
  readBlob: (r, a) => git.readBlob(r, a.rev, a.file),
  lsTree: (r, a) => git.lsTree(r, a.rev),
  blame: (r, a) => git.blame(r, a.file, a.rev),
  conflictDiff3: (r, a) => git.conflictDiff3(r, a.file),
  conflictVersions: (r, a) => git.conflictVersions(r, a.file),
  stashFiles: (r, a) => git.stashFiles(r, a.hash),
  rebasePreview: (r, a) => git.rebasePreview(r, a.onto),
  rebaseCommits: (r, a) => git.rebaseCommits(r, a.base),
  revParse: (r, a) => git.revParse(r, a.rev),
  isAncestor: (r, a) => git.isAncestor(r, a.a, a.b),
  getConfig: (r) => git.getConfig(r),
};

const WRITE: { [O in WriteOp]: WriteRunner<WriteArgs<O>> } = {
  stage: (g, r, a) => g.stage(r, a.paths),
  stageAll: (g, r) => g.stageAll(r),
  unstage: (g, r, a) => g.unstage(r, a.paths),
  unstageAll: (g, r) => g.unstageAll(r),
  discard: (g, r, a) => g.discard(r, a.files),
  discardAll: (g, r) => g.discardAll(r),
  applyPatch: (g, r, a) => g.applyPatch(r, a.patch, a),
  writeWorkingFile: (g, r, a) => g.writeWorkingFile(r, a.file, a.content),
  restoreFile: (g, r, a) => g.restoreFile(r, a.rev, a.file),
  commit: (g, r, a) => g.commit(r, a.message, a),
  checkout: (g, r, a) => g.checkout(r, a.ref),
  checkoutRemote: (g, r, a) => g.checkoutRemote(r, a.remoteBranch, a.localName),
  createBranch: (g, r, a) => g.createBranch(r, a.name, a.start, a.checkout),
  deleteBranch: (g, r, a) => g.deleteBranch(r, a.name, a.force),
  renameBranch: (g, r, a) => g.renameBranch(r, a.oldName, a.newName),
  setUpstream: (g, r, a) => g.setUpstream(r, a.branch, a.upstream),
  deleteRemoteBranch: (g, r, a, p) => g.deleteRemoteBranch(r, a.remote, a.branch, p),
  fastForward: (g, r, a) => g.fastForward(r, a.branch, a.target),
  merge: (g, r, a) => g.merge(r, a.ref, a),
  rebase: (g, r, a) => g.rebase(r, a.onto),
  interactiveRebase: (g, r, a) => g.interactiveRebase(r, a.base, a.steps),
  rewriteHistory: (g, r, a) => g.rewriteHistory(r, a.hash, a.op, a.message),
  cherryPick: (g, r, a) => g.cherryPick(r, a.hash),
  revert: (g, r, a) => g.revert(r, a.hash),
  reset: (g, r, a) => g.reset(r, a.target, a.mode),
  abort: (g, r) => g.abort(r),
  continueOp: (g, r) => g.continueOp(r),
  skipRebase: (g, r) => g.skipRebase(r),
  resolveConflict: (g, r, a) => g.resolveConflict(r, a.file, a.side),
  fetch: (g, r, a, p) => g.fetch(r, a, p),
  pull: (g, r, a, p) => g.pull(r, a, p),
  push: (g, r, a, p) => g.push(r, a, p),
  addRemote: (g, r, a) => g.addRemote(r, a.name, a.url),
  removeRemote: (g, r, a) => g.removeRemote(r, a.name),
  renameRemote: (g, r, a) => g.renameRemote(r, a.oldName, a.newName),
  setRemoteUrl: (g, r, a) => g.setRemoteUrl(r, a.name, a.url),
  stashSave: (g, r, a) => g.stashSave(r, a),
  stashApply: (g, r, a) => g.stashApply(r, a.index, a.pop),
  stashDrop: (g, r, a) => g.stashDrop(r, a.index),
  createTag: (g, r, a) => g.createTag(r, a.name, a.target, a.message),
  deleteTag: (g, r, a) => g.deleteTag(r, a.name),
  pushTag: (g, r, a, p) => g.pushTag(r, a.remote, a.name, p),
  deleteRemoteTag: (g, r, a, p) => g.deleteRemoteTag(r, a.remote, a.name, p),
};

/** Every repository-relative path an op's (already parsed) args name. */
function pathsOf(a: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ["file", "oldPath"] as const) if (typeof a[k] === "string") out.push(a[k] as string);
  if (Array.isArray(a.paths)) out.push(...(a.paths as string[]));
  if (Array.isArray(a.files)) out.push(...(a.files as { path: string }[]).map((f) => f.path));
  return out;
}

const own = (table: object, op: string) => Object.prototype.hasOwnProperty.call(table, op);

function check(schemas: Record<string, z.ZodType>, op: string, args: unknown, repo: string): Record<string, unknown> {
  if (typeof op !== "string" || !own(schemas, op)) throw new GuardError(`Operation not allowed: ${String(op)}`);
  const parsed = schemas[op].safeParse(args ?? {});
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ");
    throw new GuardError(`Invalid arguments for ${op}: ${why}`);
  }
  for (const p of pathsOf(parsed.data as Record<string, unknown>)) assertInsideRepo(repo, p);
  return parsed.data as Record<string, unknown>;
}

export async function runRead(repo: string, op: string, args: unknown): Promise<unknown> {
  const a = check(READ_OPS, op, args, repo);
  return (READ[op as ReadOp] as Runner<unknown>)(repo, a);
}

/** Throws GuardError unless `op` with `args` may run on `repo`; returns the parsed args. */
export function validateWrite(repo: string, op: string, args: unknown): Record<string, unknown> {
  const a = check(WRITE_OPS, op, args, repo);
  if (op === "applyPatch") assertPatchInsideRepo(repo, (a as unknown as WriteArgs<"applyPatch">).patch);
  return a;
}

/** Validates and runs a write op. Network ops report git's `--progress` stderr through `onProgress`. */
export async function runWrite(
  repo: string,
  op: string,
  args: unknown,
  onProgress?: (chunk: string) => void,
  tracked: Record<string, (...args: any[]) => Promise<unknown>> = {},
): Promise<unknown> {
  const a = validateWrite(repo, op, args);
  const g = { ...git, ...tracked } as GitImpl;
  return (WRITE[op as WriteOp] as WriteRunner<unknown>)(g, repo, a, onProgress);
}
