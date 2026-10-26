export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  subject: string;
}

export interface FileChange {
  path: string;
  oldPath?: string;
  status: string;
  untracked?: boolean;
  conflict?: string;
  additions?: number | null;
  deletions?: number | null;
}

export interface CommitDetails extends Omit<Commit, 'subject'> {
  committer: string;
  committerEmail: string;
  committerTime: number;
  message: string;
  files: FileChange[];
}

export interface LocalBranch {
  name: string;
  target: string;
  upstream: string | null;
  upstreamGone: boolean;
  ahead: number;
  behind: number;
  current: boolean;
}

export interface RemoteBranch {
  name: string;
  remote: string;
  branch: string;
  target: string;
}

export interface Tag {
  name: string;
  target: string;
  annotated: boolean;
}

export interface Refs {
  local: LocalBranch[];
  remote: RemoteBranch[];
  tags: Tag[];
  head: string | null;
  headSha: string | null;
  headDetached: boolean;
}

export interface Remote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface Stash {
  hash: string;
  base: string;
  ref: string;
  index: number;
  message: string;
  time: number;
}

export interface Submodule {
  state: string;
  hash: string;
  path: string;
}

export interface Status {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: FileChange[];
  unstaged: FileChange[];
  conflicted: FileChange[];
}

export interface RepoState {
  state: 'clean' | 'merging' | 'rebasing' | 'cherry-picking' | 'reverting';
  mergeMsg: string;
  mergeHead: string | null;
  gitDir: string;
}

export interface Settings {
  recent: string[];
  openTabs: string[];
  activeTab: string | null;
  autoFetchMinutes: number;
  defaultCloneDir: string;
  pullMode: 'ff' | 'ff-only' | 'rebase';
  dateFormat: 'relative' | 'absolute';
  /** Repositories kept in the repository manager, optionally grouped. */
  repos: ManagedRepo[];
  customCommands: CustomCommand[];
  compact: boolean;
  pushAfterCommit: boolean;
  /** dark · light · follow macOS · switch by time of day (light from `lightFrom`, dark from `darkFrom`). */
  theme: 'dark' | 'light' | 'system' | 'schedule';
  lightFrom: string;
  darkFrom: string;
}

export interface ManagedRepo {
  path: string;
  group: string;
}

export interface RepoSummary {
  path: string;
  branch: string | null;
  ahead: number;
  behind: number;
  changes: number;
  ok: boolean;
}

export interface CustomCommand {
  name: string;
  /** Shell command; ${repo} ${sha} ${branch} ${file} ${head} are substituted shell-quoted. */
  command: string;
  target: 'repo' | 'commit' | 'branch' | 'file';
  showOutput: boolean;
}

/** Compare target standing for the working tree (must match WORKTREE in electron/git.cjs). */
export const WORKTREE = ':worktree';

export type HistoryOp = 'reword' | 'squash' | 'fixup' | 'drop' | 'up' | 'down';

/** What the center pane is showing instead of the graph. */
export type CenterView =
  | { kind: 'graph' }
  | { kind: 'diff'; source: DiffSource; file: FileChange }
  | { kind: 'conflict'; file: string }
  | { kind: 'history'; file: string }
  | { kind: 'blame'; file: string; rev?: string }
  | { kind: 'file'; file: string; rev: string };

export type DiffSource =
  | { kind: 'unstaged' }
  | { kind: 'staged' }
  | { kind: 'commit'; hash: string }
  | { kind: 'stash'; hash: string }
  | { kind: 'range'; from: string; to: string };

/** Graph selection: a commit hash, the WIP node, or a stash. */
export type Selection =
  | { kind: 'wip' }
  | { kind: 'commit'; hash: string }
  | { kind: 'stash'; stash: Stash }
  /** Two commits picked with ⌘-click: compare `from` (older side) against `to`. */
  | { kind: 'compare'; from: string; to: string }
  | null;
