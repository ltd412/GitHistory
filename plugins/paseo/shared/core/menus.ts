// GENERATED from core/menus.ts by scripts/sync-core.mjs — do not edit; change core/menus.ts and run `npm run sync-core`.
// Ref labels and the context menus of branches, tags, commits and stashes — the same menus in the desktop
// app and the Paseo plugin (moved from src/components/RepoContext.tsx). UI-agnostic: items carry callbacks,
// each app renders them its own way.
import type {
  Commit,
  CustomCommand,
  HistoryOp,
  LocalBranch,
  Refs,
  Remote,
  RemoteBranch,
  RepoState,
  Selection,
  Settings,
  Stash,
  Status,
  Submodule,
  Tag,
} from './types.ts';
import { WORKTREE } from './types.ts';

export type MenuItem =
  | { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }
  | { label: string; submenu: MenuItem[] }
  | { separator: true }
  | { header: string };

export interface RepoData {
  commits: Commit[];
  refs: Refs;
  status: Status;
  stashes: Stash[];
  remotes: Remote[];
  state: RepoState;
  submodules: Submodule[];
  hasMore: boolean;
}

export interface RefLabel {
  key: string;
  kind: 'branch' | 'tag';
  name: string;
  local?: LocalBranch;
  remotes: RemoteBranch[];
  tag?: Tag;
  current: boolean;
}

export interface Actions {
  refresh: (full?: boolean) => Promise<void>;
  loadMore: () => void;
  checkout: (ref: string) => void;
  checkoutRemote: (rb: RemoteBranch) => void;
  createBranch: (start?: string) => void;
  deleteBranch: (b: LocalBranch) => void;
  renameBranch: (b: LocalBranch) => void;
  setUpstream: (b: LocalBranch) => void;
  deleteRemoteBranch: (rb: RemoteBranch) => void;
  fastForward: (b: LocalBranch, target: string) => void;
  merge: (ref: string) => void;
  rebase: (ref: string) => void;
  interactiveRebase: (base: string | null) => void;
  cherryPick: (hash: string) => void;
  revert: (hash: string) => void;
  reset: (hash: string, mode: 'soft' | 'mixed' | 'hard') => void;
  createTag: (hash: string, annotated: boolean) => void;
  deleteTag: (t: Tag) => void;
  pushTag: (t: Tag) => void;
  fetch: () => void;
  pull: (mode?: Settings['pullMode']) => void;
  push: (opts?: { force?: boolean; branch?: LocalBranch }) => void;
  stash: () => void;
  pop: () => void;
  stashApply: (s: Stash, pop: boolean) => void;
  stashDrop: (s: Stash) => void;
  undo: () => void;
  redo: () => void;
  addRemote: () => void;
  editRemote: (r: Remote) => void;
  removeRemote: (r: Remote) => void;
  abort: () => void;
  continueOp: () => void;
  skip: () => void;
  copy: (text: string, what?: string) => void;
  /** Fork-style quick history edit of one commit on the current branch. */
  rewriteHistory: (hash: string, op: HistoryOp) => void;
  /** Takes back a completed merge at HEAD (reset to its first parent), or offers a revert once pushed. */
  undoMerge: (c: Commit) => void;
  /** Opens a searchable picker of every branch, remote branch and tag (optionally the working tree). */
  pickRef: (title: string, onPick: (ref: string) => void, opts?: { worktree?: boolean; kind?: 'all' | 'branches' | 'revisions' }) => void;
  /** Compare `rev` against any other ref chosen in the picker. */
  compareWith: (rev: string, label: string, kind?: 'all' | 'branches' | 'revisions') => void;
  /** PyCharm "Compare with Branch/Revision…" for one file: the working-tree file against the pick. */
  compareFileWith: (file: string, kind: 'branches' | 'revisions') => void;
  runCustom: (cmd: CustomCommand, vars: { sha?: string; branch?: string; file?: string }) => void;
  /** Runs an arbitrary git action with busy state, error toasts and a refresh afterwards. */
  run: (label: string, fn: () => Promise<unknown>, opts?: { success?: string }) => Promise<boolean>;
}

/** What the menus need from the app: its data, its actions and how to change the selection. */
export interface MenuCtx {
  data: RepoData;
  actions: Actions;
  select: (s: Selection) => void;
  settings: Pick<Settings, 'customCommands'>;
}

/** Groups refs per commit; a local branch and its same-named remote branches share one label. */
export function buildRefLabels(refs: Refs): Map<string, RefLabel[]> {
  const map = new Map<string, RefLabel[]>();
  const push = (hash: string, l: RefLabel) => {
    const list = map.get(hash) ?? [];
    list.push(l);
    map.set(hash, list);
  };
  const byKey = new Map<string, RefLabel>();
  for (const b of refs.local) {
    const l: RefLabel = { key: `L:${b.name}`, kind: 'branch', name: b.name, local: b, remotes: [], current: b.current };
    byKey.set(`${b.target}:${b.name}`, l);
    push(b.target, l);
  }
  for (const rb of refs.remote) {
    const existing = byKey.get(`${rb.target}:${rb.branch}`);
    if (existing) existing.remotes.push(rb);
    else {
      const l: RefLabel = { key: `R:${rb.name}`, kind: 'branch', name: rb.name, remotes: [rb], current: false };
      byKey.set(`${rb.target}:${rb.branch}`, l);
      push(rb.target, l);
    }
  }
  for (const t of refs.tags) push(t.target, { key: `T:${t.name}`, kind: 'tag', name: t.name, tag: t, remotes: [], current: false });
  for (const list of map.values()) list.sort((a, b) => Number(b.current) - Number(a.current) || rank(a) - rank(b));
  return map;
}

/**
 * Name shown on a ref pill. A remote-only branch drops its "origin/" prefix — the cloud icon
 * already says it is remote — unless several remotes make the prefix meaningful. Actions keep
 * using the full `name`.
 */
export function refDisplayName(l: RefLabel, remoteCount: number): string {
  if (l.kind === 'branch' && !l.local && l.remotes.length && remoteCount <= 1) return l.remotes[0].branch;
  return l.name;
}

const rank = (l: RefLabel) => (l.kind === 'tag' ? 2 : l.local ? 0 : 1);

// ---------------------------------------------------------------- menus

/** "Compare with current branch / working tree" entries shared by branch, tag and commit menus. */
export function compareItems(ctx: MenuCtx, rev: string, label: string, isCurrent: boolean): MenuItem[] {
  const head = ctx.data.refs.headDetached ? 'HEAD' : (ctx.data.refs.head ?? 'HEAD');
  const sub: MenuItem[] = [];
  if (!isCurrent) sub.push({ label: `with ${head} (current branch)`, onClick: () => ctx.select({ kind: 'compare', from: head, to: rev }) });
  sub.push({ label: 'with working tree', onClick: () => ctx.select({ kind: 'compare', from: rev, to: WORKTREE }) });
  sub.push({ separator: true });
  sub.push({ label: 'with Branch…', onClick: () => ctx.actions.compareWith(rev, label, 'branches') });
  sub.push({ label: 'with Revision…', onClick: () => ctx.actions.compareWith(rev, label, 'revisions') });
  // One entry in the parent menu; the variants live in a submenu to keep the menu short.
  return [{ label: `Compare ${label}`, submenu: sub }];
}

/**
 * `inRow`: the menu is a submenu of a commit row's menu, which already offers everything that
 * acts on the commit itself (merge, rebase, compare, create branch, interactive rebase, undo
 * merge). Those are left out here so each action appears exactly once; only what is specific to
 * the branch as a ref remains. The sidebar shows the full menu.
 */
type RefMenuOpts = { inRow?: boolean };

export function localBranchMenu(ctx: MenuCtx, b: LocalBranch, opts: RefMenuOpts = {}): MenuItem[] {
  const { actions: a, data } = ctx;
  const head = data.refs.head;
  const full = !opts.inRow;
  const items: MenuItem[] = [];
  if (!b.current) {
    items.push({ label: `Checkout ${b.name}`, onClick: () => a.checkout(b.name) });
    if (head && full) {
      items.push({ label: `Merge ${b.name} into ${head}`, onClick: () => a.merge(b.name) });
      items.push({ label: `Rebase ${head} onto ${b.name}`, onClick: () => a.rebase(b.name) });
    }
  } else {
    // A merge that just landed on the checked-out branch can be taken back from the branch itself.
    const tip = data.commits.find((c) => c.hash === b.target);
    if (full && tip && tip.parents.length > 1) {
      items.push({ label: `Undo merge (move ${b.name} back to before it)`, onClick: () => a.undoMerge(tip) }, { separator: true });
    }
    items.push({ label: 'Pull (fast-forward if possible)', onClick: () => a.pull('ff'), disabled: !b.upstream });
  }
  items.push({ label: 'Push', onClick: () => a.push({ branch: b }) });
  if (b.upstream && !b.current && b.behind > 0 && b.ahead === 0)
    items.push({ label: `Fast-forward ${b.name} to ${b.upstream}`, onClick: () => a.fastForward(b, b.upstream!) });
  items.push({ separator: true });
  if (full) {
    items.push(...compareItems(ctx, b.name, b.name, b.current));
    items.push({ label: 'Create branch here', onClick: () => a.createBranch(b.name) });
    items.push({ label: 'Interactive rebase from here…', onClick: () => a.interactiveRebase(b.name), disabled: b.current });
  }
  items.push({ label: `Set upstream…`, onClick: () => a.setUpstream(b) });
  items.push({ separator: true });
  items.push({ label: `Rename ${b.name}…`, onClick: () => a.renameBranch(b) });
  items.push({ label: `Delete ${b.name}`, onClick: () => a.deleteBranch(b), danger: true, disabled: b.current });
  items.push({ separator: true });
  items.push({ label: 'Copy branch name', onClick: () => a.copy(b.name, 'Branch name') });
  items.push(...customMenu(ctx, 'branch', { branch: b.name, sha: b.target }));
  return items;
}

export function remoteBranchMenu(ctx: MenuCtx, rb: RemoteBranch, opts: RefMenuOpts = {}): MenuItem[] {
  const { actions: a, data } = ctx;
  const head = data.refs.head;
  const full = !opts.inRow;
  return [
    { label: `Checkout ${rb.name}`, onClick: () => a.checkoutRemote(rb) },
    ...(head && full
      ? ([
          { label: `Merge ${rb.name} into ${head}`, onClick: () => a.merge(rb.name) },
          { label: `Rebase ${head} onto ${rb.name}`, onClick: () => a.rebase(rb.name) },
        ] as MenuItem[])
      : []),
    { separator: true },
    ...(full ? [...compareItems(ctx, rb.name, rb.name, false), { label: 'Create branch here', onClick: () => a.createBranch(rb.name) } as MenuItem] : []),
    { label: `Delete ${rb.name} from remote`, onClick: () => a.deleteRemoteBranch(rb), danger: true },
    { separator: true },
    { label: 'Copy branch name', onClick: () => a.copy(rb.name, 'Branch name') },
  ];
}

export function tagMenu(ctx: MenuCtx, t: Tag, opts: RefMenuOpts = {}): MenuItem[] {
  const { actions: a } = ctx;
  const full = !opts.inRow;
  return [
    { label: `Checkout ${t.name}`, onClick: () => a.checkout(`tags/${t.name}`) },
    { label: `Push ${t.name} to remote`, onClick: () => a.pushTag(t), disabled: !ctx.data.remotes.length },
    ...(full ? [{ label: 'Create branch here', onClick: () => a.createBranch(t.name) } as MenuItem, ...compareItems(ctx, `tags/${t.name}`, t.name, false)] : []),
    { separator: true },
    { label: `Delete ${t.name}`, onClick: () => a.deleteTag(t), danger: true },
    { separator: true },
    { label: 'Copy tag name', onClick: () => a.copy(t.name, 'Tag name') },
  ];
}

export function labelMenu(ctx: MenuCtx, l: RefLabel, opts: RefMenuOpts = {}): MenuItem[] {
  if (l.tag) return tagMenu(ctx, l.tag, opts);
  if (l.local) {
    const items = localBranchMenu(ctx, l.local, opts);
    for (const rb of l.remotes)
      items.push({ separator: true }, { label: `Delete ${rb.name} from remote`, onClick: () => ctx.actions.deleteRemoteBranch(rb), danger: true });
    return items;
  }
  return remoteBranchMenu(ctx, l.remotes[0], opts);
}

/**
 * Commits a quick history edit can safely rewrite: the first-parent chain from HEAD down to
 * (not past) the first merge commit, since rewriting across a merge would linearize it.
 */
export function editableCommits(data: RepoData): Set<string> {
  const byHash = new Map(data.commits.map((c) => [c.hash, c]));
  const out = new Set<string>();
  let cur = data.refs.headDetached ? undefined : byHash.get(data.refs.headSha ?? '');
  while (cur && cur.parents.length <= 1) {
    out.add(cur.hash);
    cur = byHash.get(cur.parents[0]);
  }
  return out;
}

/** File-level compare entries (PyCharm Git menu): the working-tree file vs. a branch or revision. */
export function fileCompareItems(ctx: MenuCtx, path: string): MenuItem[] {
  return [
    {
      label: 'Compare file',
      submenu: [
        { label: 'with Branch…', onClick: () => ctx.actions.compareFileWith(path, 'branches') },
        { label: 'with Revision…', onClick: () => ctx.actions.compareFileWith(path, 'revisions') },
      ],
    },
  ];
}

export function customMenu(ctx: MenuCtx, target: CustomCommand['target'], vars: { sha?: string; branch?: string; file?: string }): MenuItem[] {
  const cmds = ctx.settings.customCommands.filter((c) => c.target === target);
  if (!cmds.length) return [];
  return [{ separator: true }, { header: 'Custom commands' }, ...cmds.map((c) => ({ label: c.name, onClick: () => ctx.actions.runCustom(c, vars) }))];
}

export function commitMenu(ctx: MenuCtx, c: Commit): MenuItem[] {
  const { actions: a, data } = ctx;
  const short = c.hash.slice(0, 7);
  const branch = data.refs.head ?? 'HEAD';
  const isHead = data.refs.headSha === c.hash;
  const editable = editableCommits(data);
  const history: MenuItem[] = editable.has(c.hash)
    ? [
        { header: `Edit history of ${branch}` },
        { label: 'Edit commit message…', onClick: () => a.rewriteHistory(c.hash, 'reword') },
        // The parent is rewritten too, so it must itself be safely editable.
        { label: 'Squash into parent', onClick: () => a.rewriteHistory(c.hash, 'squash'), disabled: !editable.has(c.parents[0]) },
        { label: 'Fixup into parent (discard message)', onClick: () => a.rewriteHistory(c.hash, 'fixup'), disabled: !editable.has(c.parents[0]) },
        { label: 'Move up', onClick: () => a.rewriteHistory(c.hash, 'up'), disabled: isHead },
        { label: 'Move down', onClick: () => a.rewriteHistory(c.hash, 'down'), disabled: !editable.has(c.parents[0]) },
        { label: 'Drop commit', onClick: () => a.rewriteHistory(c.hash, 'drop'), danger: true },
        { separator: true },
      ]
    : [];
  return [
    { label: 'Create branch here', onClick: () => a.createBranch(c.hash) },
    ...(isHead && c.parents.length > 1 && !data.refs.headDetached
      ? ([{ label: `Undo merge (move ${branch} back to before it)`, onClick: () => a.undoMerge(c) }, { separator: true }] as MenuItem[])
      : []),
    { label: `Checkout this commit (detached)`, onClick: () => a.checkout(c.hash) },
    ...compareItems(ctx, c.hash, 'this commit', isHead),
    { separator: true },
    ...history,
    { label: `Cherry pick commit`, onClick: () => a.cherryPick(c.hash), disabled: isHead },
    { label: `Revert commit`, onClick: () => a.revert(c.hash) },
    { label: `Interactive rebase ${branch} onto ${short}…`, onClick: () => a.interactiveRebase(c.hash), disabled: isHead },
    {
      label: `Reset ${branch} to this commit`,
      submenu: [
        { label: 'Soft — keep all changes staged', onClick: () => a.reset(c.hash, 'soft') },
        { label: 'Mixed — keep working copy, reset index', onClick: () => a.reset(c.hash, 'mixed') },
        { label: 'Hard — discard all changes', onClick: () => a.reset(c.hash, 'hard'), danger: true },
      ],
    },
    { separator: true },
    { label: 'Create tag here…', onClick: () => a.createTag(c.hash, false) },
    { label: 'Create annotated tag here…', onClick: () => a.createTag(c.hash, true) },
    { separator: true },
    { label: 'Copy commit SHA', onClick: () => a.copy(c.hash, 'SHA') },
    { label: 'Copy commit message', onClick: () => a.copy(c.subject, 'Message') },
    ...customMenu(ctx, 'commit', { sha: c.hash }),
  ];
}

/**
 * The one menu for a commit row — the same wherever on the row you right-click (ref pill,
 * node, message, author). Each branch/tag on the commit gets a submenu, then the commit actions.
 */
export function rowMenu(ctx: MenuCtx, c: Commit, labels: RefLabel[]): MenuItem[] {
  const { actions: a, data } = ctx;
  const head = data.refs.head;
  // Merge/rebase sit at the top level: they are the most common reason to right-click a commit,
  // and a commit without a branch label can be merged directly too.
  const quick: MenuItem[] = [];
  if (head && !data.refs.headDetached && data.state.state === 'clean' && !reachableFromHead(data).has(c.hash)) {
    const branches = labels.filter((l) => l.kind === 'branch' && !l.current);
    if (branches.length) {
      for (const l of branches) {
        const ref = l.local?.name ?? l.name;
        const shown = refDisplayName(l, data.remotes.length);
        quick.push({ label: `Merge ${shown} into ${head}`, onClick: () => a.merge(ref) });
        quick.push({ label: `Rebase ${head} onto ${shown}`, onClick: () => a.rebase(ref) });
      }
    } else {
      quick.push({ label: `Merge this commit into ${head}`, onClick: () => a.merge(c.hash) });
      quick.push({ label: `Rebase ${head} onto this commit`, onClick: () => a.rebase(c.hash) });
    }
    quick.push({ separator: true });
  }
  const refs: MenuItem[] = labels.map((l) => ({
    label: `${l.kind === 'tag' ? 'Tag' : l.local ? 'Branch' : 'Remote branch'} ${refDisplayName(l, data.remotes.length)}${l.current ? '  (checked out)' : ''}`,
    submenu: labelMenu(ctx, l, { inRow: true }),
  }));
  return [...quick, ...refs, ...(refs.length ? [{ separator: true } as MenuItem] : []), ...commitMenu(ctx, c)];
}

/** Every loaded commit already contained in HEAD (nothing to merge from those). */
function reachableFromHead(data: RepoData): Set<string> {
  const byHash = new Map(data.commits.map((c) => [c.hash, c]));
  const seen = new Set<string>();
  const stack = data.refs.headSha ? [data.refs.headSha] : [];
  while (stack.length) {
    const h = stack.pop()!;
    if (seen.has(h)) continue;
    seen.add(h);
    for (const p of byHash.get(h)?.parents ?? []) stack.push(p);
  }
  return seen;
}

export function stashMenu(ctx: MenuCtx, s: Stash): MenuItem[] {
  const { actions: a } = ctx;
  return [
    { label: 'Apply stash', onClick: () => a.stashApply(s, false) },
    { label: 'Pop stash', onClick: () => a.stashApply(s, true) },
    { separator: true },
    { label: 'Delete stash', onClick: () => a.stashDrop(s), danger: true },
  ];
}

