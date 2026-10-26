// GENERATED from core/git-client.ts by scripts/sync-core.mjs — do not edit; change core/git-client.ts and run `npm run sync-core`.
// The typed git API the UI calls, positional like the git service itself (core-node/git.ts). It is built
// on a transport so the same calls work over Electron IPC (desktop) and Paseo RPC (plugin); see
// GIT_PARAMS for how the plugin names the positional arguments.
import type { Commit, CommitDetails, FileChange, HistoryOp, Refs, Remote, RepoState, RepoSummary, Stash, Status, Submodule } from './types.ts';

/** Sends `method` with its positional args (repository first) and resolves with git's result. */
export type GitTransport = (method: string, args: unknown[]) => Promise<any>;

export function createGitClient(call: GitTransport) {
  return {
    log: (r: string, opts?: { limit?: number; skip?: number }): Promise<Commit[]> => call('log', [r, opts]),
    searchCommits: (r: string, q: string): Promise<Commit[]> => call('searchCommits', [r, q]),
    fileHistory: (r: string, f: string): Promise<Commit[]> => call('fileHistory', [r, f]),
    commitDetails: (r: string, h: string): Promise<CommitDetails> => call('commitDetails', [r, h]),
    refs: (r: string): Promise<Refs> => call('refs', [r]),
    remotes: (r: string): Promise<Remote[]> => call('remotes', [r]),
    stashes: (r: string): Promise<Stash[]> => call('stashes', [r]),
    submodules: (r: string): Promise<Submodule[]> => call('submodules', [r]),
    status: (r: string): Promise<Status> => call('status', [r]),
    repoState: (r: string): Promise<RepoState> => call('repoState', [r]),
    stage: (r: string, paths: string[]) => call('stage', [r, paths]),
    stageAll: (r: string) => call('stageAll', [r]),
    unstage: (r: string, paths: string[]) => call('unstage', [r, paths]),
    unstageAll: (r: string) => call('unstageAll', [r]),
    discard: (r: string, files: FileChange[]) => call('discard', [r, files]),
    discardAll: (r: string) => call('discardAll', [r]),
    applyPatch: (r: string, patch: string, opts: { cached?: boolean; reverse?: boolean }) =>
      call('applyPatch', [r, patch, opts]),
    diffWorking: (r: string, f: string, opts: { staged?: boolean; untracked?: boolean; ignoreWs?: boolean; full?: boolean }): Promise<string> =>
      call('diffWorking', [r, f, opts]),
    diffCommit: (r: string, h: string, f: string, oldPath?: string, ignoreWs?: boolean, full?: boolean): Promise<string> =>
      call('diffCommit', [r, h, f, oldPath, ignoreWs, full]),
    diffStash: (r: string, h: string, f: string, untracked?: boolean, ignoreWs?: boolean, full?: boolean): Promise<string> =>
      call('diffStash', [r, h, f, untracked, ignoreWs, full]),
    diffRange: (r: string, from: string, to: string, f: string, oldPath?: string, ignoreWs?: boolean, full?: boolean): Promise<string> =>
      call('diffRange', [r, from, to, f, oldPath, ignoreWs, full]),
    conflictDiff3: (r: string, f: string): Promise<string | null> => call('conflictDiff3', [r, f]),
    rangeFiles: (r: string, from: string, to: string): Promise<FileChange[]> => call('rangeFiles', [r, from, to]),
    readBlob: (r: string, rev: string | null, f: string): Promise<{ base64: string | null; size: number; tooLarge: boolean } | null> =>
      call('readBlob', [r, rev, f]),
    lsTree: (r: string, rev: string): Promise<string[]> => call('lsTree', [r, rev]),
    rewriteHistory: (r: string, hash: string, op: HistoryOp, message?: string) => call('rewriteHistory', [r, hash, op, message]),
    repoSummary: (dir: string): Promise<RepoSummary> => call('repoSummary', [dir]),
    isRepoPath: (dir: string): Promise<string | null> => call('isRepo', [dir]),
    scanRepos: (dir: string): Promise<string[]> => call('scanRepos', [dir]),
    showFile: (r: string, rev: string, f: string): Promise<string | null> => call('showFile', [r, rev, f]),
    readWorkingFile: (r: string, f: string): Promise<string> => call('readWorkingFile', [r, f]),
    writeWorkingFile: (r: string, f: string, c: string) => call('writeWorkingFile', [r, f, c]),
    restoreFile: (r: string, rev: string, f: string) => call('restoreFile', [r, rev, f]),
    blame: (
      r: string,
      f: string,
      rev?: string,
    ): Promise<{
      lines: { hash: string; text: string }[];
      meta: Record<string, { hash: string; author: string; time: number; summary: string }>;
    }> => call('blame', [r, f, rev]),
    commit: (r: string, msg: string, opts: { amend?: boolean }) => call('commit', [r, msg, opts]),
    lastCommitMessage: (r: string): Promise<string> => call('lastCommitMessage', [r]),
    commitMessage: (r: string, h: string): Promise<string> => call('commitMessage', [r, h]),
    checkout: (r: string, ref: string) => call('checkout', [r, ref]),
    checkoutRemote: (r: string, remoteBranch: string, local: string) =>
      call('checkoutRemote', [r, remoteBranch, local]),
    createBranch: (r: string, name: string, start: string | null, checkout: boolean) =>
      call('createBranch', [r, name, start, checkout]),
    deleteBranch: (r: string, name: string, force: boolean) => call('deleteBranch', [r, name, force]),
    renameBranch: (r: string, a: string, z: string) => call('renameBranch', [r, a, z]),
    setUpstream: (r: string, branch: string, upstream: string | null) => call('setUpstream', [r, branch, upstream]),
    deleteRemoteBranch: (r: string, remote: string, branch: string) =>
      call('deleteRemoteBranch', [r, remote, branch]),
    fastForward: (r: string, branch: string, target: string) => call('fastForward', [r, branch, target]),
    merge: (r: string, ref: string, opts?: { mode?: string; message?: string }) => call('merge', [r, ref, opts]),
    rebase: (r: string, onto: string) => call('rebase', [r, onto]),
    rebasePreview: (r: string, onto: string): Promise<{ rewrite: number; incoming: number; pushed: number; upstream: string | null }> =>
      call('rebasePreview', [r, onto]),
    interactiveRebase: (r: string, base: string | null, steps: { action: string; hash: string; message?: string }[]) =>
      call('interactiveRebase', [r, base, steps]),
    rebaseCommits: (r: string, base: string | null): Promise<Commit[]> => call('rebaseCommits', [r, base]),
    cherryPick: (r: string, h: string) => call('cherryPick', [r, h]),
    revert: (r: string, h: string) => call('revert', [r, h]),
    reset: (r: string, target: string, mode: 'soft' | 'mixed' | 'hard' | 'keep') => call('reset', [r, target, mode]),
    abort: (r: string) => call('abort', [r]),
    continueOp: (r: string) => call('continueOp', [r]),
    skipRebase: (r: string) => call('skipRebase', [r]),
    resolveConflict: (r: string, f: string, side: 'ours' | 'theirs' | 'mark') => call('resolveConflict', [r, f, side]),
    conflictVersions: (
      r: string,
      f: string,
    ): Promise<{ base: string | null; ours: string | null; theirs: string | null; working: string }> =>
      call('conflictVersions', [r, f]),
    fetch: (r: string, opts?: { remote?: string; prune?: boolean }) => call('fetch', [r, opts ?? {}]),
    pull: (r: string, opts: { rebase?: boolean; ffOnly?: boolean }) => call('pull', [r, opts]),
    push: (r: string, opts: { remote?: string; branch?: string; force?: boolean; setUpstream?: boolean; tags?: boolean }) =>
      call('push', [r, opts]),
    addRemote: (r: string, name: string, url: string) => call('addRemote', [r, name, url]),
    removeRemote: (r: string, name: string) => call('removeRemote', [r, name]),
    renameRemote: (r: string, a: string, z: string) => call('renameRemote', [r, a, z]),
    setRemoteUrl: (r: string, name: string, url: string) => call('setRemoteUrl', [r, name, url]),
    stashSave: (r: string, opts: { message?: string; includeUntracked?: boolean; keepIndex?: boolean }) =>
      call('stashSave', [r, opts]),
    stashApply: (r: string, index: number, pop: boolean) => call('stashApply', [r, index, pop]),
    stashDrop: (r: string, index: number) => call('stashDrop', [r, index]),
    stashFiles: (r: string, h: string): Promise<FileChange[]> => call('stashFiles', [r, h]),
    createTag: (r: string, name: string, target: string | null, message?: string) =>
      call('createTag', [r, name, target, message]),
    deleteTag: (r: string, name: string) => call('deleteTag', [r, name]),
    pushTag: (r: string, remote: string, name: string) => call('pushTag', [r, remote, name]),
    deleteRemoteTag: (r: string, remote: string, name: string) => call('deleteRemoteTag', [r, remote, name]),
    getConfig: (
      r: string | null,
    ): Promise<{ globalName: string; globalEmail: string; localName: string; localEmail: string }> =>
      call('getConfig', [r]),
    setConfig: (r: string | null, scope: 'global' | 'local', key: string, value: string) =>
      call('setConfig', [r, scope, key, value]),
    revParse: (r: string, rev: string): Promise<string | null> => call('revParse', [r, rev]),
    isAncestor: (r: string, a: string, z: string): Promise<boolean> => call('isAncestor', [r, a, z]),
  };
}

export type GitClient = ReturnType<typeof createGitClient>;

/**
 * Argument names of every op the plugin exposes, in positional order after the repository; `*` spreads an
 * options object into the args. Must match the schemas in plugins/paseo/shared/ops.ts (checked by a test).
 */
export const GIT_PARAMS: Record<string, readonly string[]> = {
  log: ['*'],
  searchCommits: ['query'],
  fileHistory: ['file'],
  commitDetails: ['hash'],
  commitMessage: ['hash'],
  lastCommitMessage: [],
  diffWorking: ['file', '*'],
  diffCommit: ['hash', 'file', 'oldPath', 'ignoreWs', 'full'],
  diffStash: ['hash', 'file', 'untracked', 'ignoreWs', 'full'],
  diffRange: ['from', 'to', 'file', 'oldPath', 'ignoreWs', 'full'],
  rangeFiles: ['from', 'to'],
  showFile: ['rev', 'file'],
  readWorkingFile: ['file'],
  readBlob: ['rev', 'file'],
  lsTree: ['rev'],
  blame: ['file', 'rev'],
  conflictDiff3: ['file'],
  conflictVersions: ['file'],
  stashFiles: ['hash'],
  rebasePreview: ['onto'],
  rebaseCommits: ['base'],
  revParse: ['rev'],
  isAncestor: ['a', 'b'],
  getConfig: [],
  stage: ['paths'],
  stageAll: [],
  unstage: ['paths'],
  unstageAll: [],
  discard: ['files'],
  discardAll: [],
  applyPatch: ['patch', '*'],
  writeWorkingFile: ['file', 'content'],
  restoreFile: ['rev', 'file'],
  commit: ['message', '*'],
  checkout: ['ref'],
  checkoutRemote: ['remoteBranch', 'localName'],
  createBranch: ['name', 'start', 'checkout'],
  deleteBranch: ['name', 'force'],
  renameBranch: ['oldName', 'newName'],
  setUpstream: ['branch', 'upstream'],
  deleteRemoteBranch: ['remote', 'branch'],
  fastForward: ['branch', 'target'],
  merge: ['ref', '*'],
  rebase: ['onto'],
  interactiveRebase: ['base', 'steps'],
  rewriteHistory: ['hash', 'op', 'message'],
  cherryPick: ['hash'],
  revert: ['hash'],
  reset: ['target', 'mode'],
  abort: [],
  continueOp: [],
  skipRebase: [],
  resolveConflict: ['file', 'side'],
  fetch: ['*'],
  pull: ['*'],
  push: ['*'],
  addRemote: ['name', 'url'],
  removeRemote: ['name'],
  renameRemote: ['oldName', 'newName'],
  setRemoteUrl: ['name', 'url'],
  stashSave: ['*'],
  stashApply: ['index', 'pop'],
  stashDrop: ['index'],
  createTag: ['name', 'target', 'message'],
  deleteTag: ['name'],
  pushTag: ['remote', 'name'],
  deleteRemoteTag: ['remote', 'name'],
};

/** Named args for `method` from its positional args (repository already removed). Undefined values are dropped. */
export function namedArgs(method: string, args: unknown[]): Record<string, unknown> {
  const names = GIT_PARAMS[method];
  if (!names) throw new Error(`Operation not available: ${method}`);
  const out: Record<string, unknown> = {};
  names.forEach((n, i) => {
    const v = args[i];
    if (n === '*') {
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = x;
    } else if (v !== undefined) out[n] = v;
  });
  return out;
}
