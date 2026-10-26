// The only git operations a client may ask for, with a schema per operation
// (plans/261026-paseo-plugin/data-model.md §3: 24 read + 43 write). Anything else is refused.
import { z } from "zod";

// A ref, revision, branch, tag or remote name. A leading "-" would let a caller smuggle git options
// (`--upload-pack=<cmd>` on fetch runs a command), so it is refused here, before git ever sees it.
const Rev = z
  .string()
  .min(1)
  .max(512)
  .refine((v) => !v.startsWith("-"), "must not start with '-'")
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "must not contain control characters");
// Repository-relative file path; containment is checked against the real repository on the server.
const RelPath = z.string().min(1).max(4096).refine((v) => !/\u0000/.test(v), "must not contain NUL");
// Remote URL: no `ext::` (runs a shell command) and no option-looking values.
const RemoteUrl = z
  .string()
  .min(1)
  .max(2048)
  .refine((v) => /^(https?:\/\/|ssh:\/\/|git:\/\/|[\w.-]+@[\w.-]+:)/.test(v), "unsupported remote URL scheme")
  // WHY: a host or user starting with "-" reaches ssh as an option (`ssh://-oProxyCommand=…`).
  .refine((v) => !/^-|:\/\/-|:\/\/[^/@]*@-/.test(v), "user/host must not start with '-'")
  .refine((v) => !/[\s\u0000-\u001f\u007f]/.test(v), "must not contain whitespace or control characters");
const Message = z.string().max(100_000);
const FileRef = z.object({ path: RelPath, untracked: z.boolean().optional() });

export const READ_OPS = {
  log: z.object({ limit: z.number().int().min(1).max(5000), skip: z.number().int().min(0) }),
  searchCommits: z.object({ query: z.string().min(1).max(200) }),
  fileHistory: z.object({ file: RelPath }),
  commitDetails: z.object({ hash: Rev }),
  commitMessage: z.object({ hash: Rev }),
  lastCommitMessage: z.object({}),
  diffWorking: z.object({
    file: RelPath,
    staged: z.boolean().optional(),
    untracked: z.boolean().optional(),
    ignoreWs: z.boolean().optional(),
    full: z.boolean().optional(),
  }),
  diffCommit: z.object({ hash: Rev, file: RelPath, oldPath: RelPath.optional(), ignoreWs: z.boolean().optional(), full: z.boolean().optional() }),
  diffStash: z.object({ hash: Rev, file: RelPath, untracked: z.boolean().optional(), ignoreWs: z.boolean().optional(), full: z.boolean().optional() }),
  diffRange: z.object({ from: Rev, to: Rev, file: RelPath, oldPath: RelPath.optional(), ignoreWs: z.boolean().optional(), full: z.boolean().optional() }),
  rangeFiles: z.object({ from: Rev, to: Rev }),
  showFile: z.object({ rev: Rev, file: RelPath }),
  readWorkingFile: z.object({ file: RelPath }),
  readBlob: z.object({ rev: z.union([Rev, z.null()]), file: RelPath }),
  lsTree: z.object({ rev: Rev }),
  blame: z.object({ file: RelPath, rev: Rev.optional() }),
  conflictDiff3: z.object({ file: RelPath }),
  conflictVersions: z.object({ file: RelPath }),
  stashFiles: z.object({ hash: Rev }),
  rebasePreview: z.object({ onto: Rev }),
  rebaseCommits: z.object({ base: Rev.nullable() }),
  revParse: z.object({ rev: Rev }),
  isAncestor: z.object({ a: Rev, b: Rev }),
  getConfig: z.object({}),
} as const;

export const WRITE_OPS = {
  stage: z.object({ paths: z.array(RelPath).min(1) }),
  stageAll: z.object({}),
  unstage: z.object({ paths: z.array(RelPath).min(1) }),
  unstageAll: z.object({}),
  discard: z.object({ files: z.array(FileRef).min(1) }),
  discardAll: z.object({}),
  applyPatch: z.object({ patch: z.string().min(1).max(10_000_000), cached: z.boolean().optional(), reverse: z.boolean().optional() }),
  writeWorkingFile: z.object({ file: RelPath, content: z.string().max(50_000_000) }),
  restoreFile: z.object({ rev: Rev, file: RelPath }),
  commit: z.object({ message: Message.min(1), amend: z.boolean().optional() }),
  checkout: z.object({ ref: Rev }),
  checkoutRemote: z.object({ remoteBranch: Rev, localName: Rev }),
  createBranch: z.object({ name: Rev, start: Rev.nullable(), checkout: z.boolean() }),
  deleteBranch: z.object({ name: Rev, force: z.boolean() }),
  renameBranch: z.object({ oldName: Rev, newName: Rev }),
  setUpstream: z.object({ branch: Rev, upstream: Rev.nullable() }),
  deleteRemoteBranch: z.object({ remote: Rev, branch: Rev }),
  fastForward: z.object({ branch: Rev, target: Rev }),
  merge: z.object({ ref: Rev, mode: z.enum(["default", "no-ff", "ff-only", "squash"]).optional(), message: Message.optional() }),
  rebase: z.object({ onto: Rev }),
  interactiveRebase: z.object({
    base: Rev.nullable(),
    steps: z.array(z.object({ action: z.enum(["pick", "reword", "squash", "fixup", "drop"]), hash: Rev, message: Message.optional() })).min(1),
  }),
  rewriteHistory: z.object({ hash: Rev, op: z.enum(["reword", "squash", "fixup", "drop", "up", "down"]), message: Message.optional() }),
  cherryPick: z.object({ hash: Rev }),
  revert: z.object({ hash: Rev }),
  reset: z.object({ target: Rev, mode: z.enum(["soft", "mixed", "hard", "keep"]) }),
  abort: z.object({}),
  continueOp: z.object({}),
  skipRebase: z.object({}),
  resolveConflict: z.object({ file: RelPath, side: z.enum(["ours", "theirs", "mark"]) }),
  fetch: z.object({ remote: Rev.optional(), prune: z.boolean().optional() }),
  pull: z.object({ rebase: z.boolean().optional(), ffOnly: z.boolean().optional() }),
  push: z.object({
    remote: Rev.optional(),
    branch: Rev.optional(),
    force: z.boolean().optional(),
    setUpstream: z.boolean().optional(),
    tags: z.boolean().optional(),
  }),
  addRemote: z.object({ name: Rev, url: RemoteUrl }),
  removeRemote: z.object({ name: Rev }),
  renameRemote: z.object({ oldName: Rev, newName: Rev }),
  setRemoteUrl: z.object({ name: Rev, url: RemoteUrl }),
  stashSave: z.object({ message: Message.optional(), includeUntracked: z.boolean().optional(), keepIndex: z.boolean().optional() }),
  stashApply: z.object({ index: z.number().int().min(0), pop: z.boolean() }),
  stashDrop: z.object({ index: z.number().int().min(0) }),
  createTag: z.object({ name: Rev, target: Rev.nullable(), message: Message.optional() }),
  deleteTag: z.object({ name: Rev }),
  pushTag: z.object({ remote: Rev, name: Rev }),
  deleteRemoteTag: z.object({ remote: Rev, name: Rev }),
} as const;

export type ReadOp = keyof typeof READ_OPS;
export type WriteOp = keyof typeof WRITE_OPS;
export type ReadArgs<O extends ReadOp> = z.infer<(typeof READ_OPS)[O]>;
export type WriteArgs<O extends WriteOp> = z.infer<(typeof WRITE_OPS)[O]>;

/** Network operations run as background jobs (solution.md §6). */
export const NETWORK_OPS: readonly WriteOp[] = ["fetch", "pull", "push", "deleteRemoteBranch", "pushTag", "deleteRemoteTag"];
