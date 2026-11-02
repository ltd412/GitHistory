// GENERATED from core/jb.ts by scripts/sync-core.mjs — do not edit; change core/jb.ts and run `npm run sync-core`.
// Pure logic of the JetBrains-style Git log (PyCharm / IntelliJ look): the changed-files tree, the branches
// tree, log filters with the graph kept connected, and date formatting. UI-agnostic — shared by the desktop
// app and the Paseo plugin. The commit graph itself reuses layoutGraph / graph-draw with JB_METRICS.
import type { Commit, FileChange, LocalBranch, Refs, RemoteBranch, Tag } from './types.ts';
import type { RefLabel } from './menus.ts';
import type { Metrics } from './graph-draw.ts';

/** Dense rows and narrow lanes like the IDE's log; `compact` also selects the small dot nodes. */
export const JB_METRICS: Metrics = { row: 26, lane: 14, pad: 8, compact: true };

// ---------------------------------------------------------------- changed files tree

export interface FileNode<T extends { path: string }> {
  /** Label; a chain of single-child folders is joined ("src/main/java"). */
  name: string;
  /** Folder path (no trailing slash) or file path. */
  path: string;
  dir: boolean;
  children: FileNode<T>[];
  file?: T;
  /** Files below a folder, 1 for a file. */
  count: number;
}

/** Folders first, then files, each alphabetical; single-child folder chains are merged (IDE "flatten packages"). */
export function buildFileTree<T extends { path: string }>(files: readonly T[]): FileNode<T>[] {
  const root: FileNode<T> = { name: '', path: '', dir: true, children: [], count: 0 };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/');
      if (i === parts.length - 1) {
        node.children.push({ name: part, path, dir: false, children: [], file, count: 1 });
        return;
      }
      let next = node.children.find((c) => c.dir && c.name === part);
      if (!next) node.children.push((next = { name: part, path, dir: true, children: [], count: 0 }));
      node = next;
    });
  }
  const finish = (n: FileNode<T>): FileNode<T> => {
    n.children = n.children.map(finish);
    n.children.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    n.count = n.dir ? n.children.reduce((s, c) => s + c.count, 0) : 1;
    // Merge into the only child when it is a folder too.
    if (n.dir && n.path && n.children.length === 1 && n.children[0].dir) {
      const only = n.children[0];
      return { ...only, name: `${n.name}/${only.name}` };
    }
    return n;
  };
  return finish(root).children;
}

/** Every folder path of a tree, for "expand all". */
export function folderPaths<T extends { path: string }>(nodes: readonly FileNode<T>[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly FileNode<T>[]) => {
    for (const n of list) if (n.dir) (out.push(n.path), walk(n.children));
  };
  walk(nodes);
  return out;
}

export function sumChanges(files: readonly FileChange[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions ?? 0;
    deletions += f.deletions ?? 0;
  }
  return { additions, deletions };
}

// ---------------------------------------------------------------- branches tree

export type BranchNodeKind = 'group' | 'folder' | 'local' | 'remote' | 'tag';

export interface BranchNode {
  id: string;
  label: string;
  kind: BranchNodeKind;
  children: BranchNode[];
  local?: LocalBranch;
  remote?: RemoteBranch;
  tag?: Tag;
  /** Ref name that checks out / filters the log: "main", "origin/main", the tag name. */
  ref?: string;
  current?: boolean;
}

/** Nests `name`/`name` folders under `parent`, like the IDE's branches pane ("feature/login" under "feature"). */
function addPath(parent: BranchNode[], idPrefix: string, segments: string[], leaf: Omit<BranchNode, 'id' | 'label' | 'children'>) {
  let list = parent;
  segments.forEach((seg, i) => {
    const id = `${idPrefix}/${segments.slice(0, i + 1).join('/')}`;
    if (i === segments.length - 1) {
      list.push({ id, label: seg, children: [], ...leaf });
      return;
    }
    let folder = list.find((n) => n.kind === 'folder' && n.label === seg);
    if (!folder) list.push((folder = { id, label: seg, kind: 'folder', children: [] }));
    list = folder.children;
  });
}

const sortNodes = (list: BranchNode[]) => {
  list.sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.label.localeCompare(b.label));
  for (const n of list) sortNodes(n.children);
};

/** HEAD, Local, Remote (by remote), Tags; `query` keeps matching leaves and their folders. */
export function buildBranchTree(refs: Refs, query = ''): BranchNode[] {
  const q = query.trim().toLowerCase();
  const local: BranchNode[] = [];
  for (const b of refs.local) addPath(local, 'local', b.name.split('/'), { kind: 'local', local: b, ref: b.name, current: b.current });
  const remote: BranchNode[] = [];
  const byRemote = new Map<string, BranchNode>();
  for (const rb of refs.remote) {
    if (rb.branch === 'HEAD') continue;
    let group = byRemote.get(rb.remote);
    if (!group) {
      group = { id: `remote/${rb.remote}`, label: rb.remote, kind: 'folder', children: [] };
      byRemote.set(rb.remote, group);
      remote.push(group);
    }
    addPath(group.children, `remote/${rb.remote}`, rb.branch.split('/'), { kind: 'remote', remote: rb, ref: rb.name });
  }
  const tags: BranchNode[] = [];
  for (const t of refs.tags) tags.push({ id: `tag/${t.name}`, label: t.name, kind: 'tag', children: [], tag: t, ref: t.name });
  [local, remote, tags].forEach(sortNodes);

  const prune = (list: BranchNode[]): BranchNode[] => {
    if (!q) return list;
    const out: BranchNode[] = [];
    for (const n of list) {
      if (n.children.length) {
        const kids = prune(n.children);
        if (kids.length || n.label.toLowerCase().includes(q)) out.push({ ...n, children: kids.length ? kids : n.children });
      } else if ((n.ref ?? n.label).toLowerCase().includes(q)) out.push(n);
    }
    return out;
  };
  const groups: BranchNode[] = [];
  const head: BranchNode = {
    id: 'head',
    label: refs.headDetached ? `HEAD (${(refs.headSha ?? '').slice(0, 7)})` : 'HEAD (Current Branch)',
    kind: 'group',
    children: [],
    ref: 'HEAD',
    current: true,
  };
  if (!q) groups.push(head);
  for (const [id, label, list] of [['local', 'Local', local], ['remote', 'Remote', remote], ['tags', 'Tags', tags]] as const) {
    const kids = prune(list);
    if (kids.length) groups.push({ id: `group/${id}`, label, kind: 'group', children: kids });
  }
  return groups;
}

/** Every folder / group id of a branch tree. */
export function branchFolderIds(nodes: readonly BranchNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly BranchNode[]) => {
    for (const n of list) if (n.children.length) (out.push(n.id), walk(n.children));
  };
  walk(nodes);
  return out;
}

// ---------------------------------------------------------------- log filters

export interface LogFilter {
  /** Message, author or hash fragment. */
  text: string;
  /** Author name or e-mail; null = anyone. */
  author: string | null;
  /** Only commits from the last N days; null = any date. */
  days: number | null;
  /** Only commits reachable from this ref ("HEAD", a branch, a remote branch or a tag); null = all refs. */
  branch: string | null;
}

export const NO_FILTER: LogFilter = { text: '', author: null, days: null, branch: null };

export const isFiltering = (f: LogFilter) => !!f.text.trim() || f.author != null || f.days != null || f.branch != null;

/** Commit a ref points at, or null when the ref is unknown. */
export function refTarget(refs: Refs, name: string): string | null {
  if (name === 'HEAD') return refs.headSha;
  return (
    refs.local.find((b) => b.name === name)?.target ??
    refs.remote.find((b) => b.name === name)?.target ??
    refs.tags.find((t) => t.name === name)?.target ??
    null
  );
}

/** Commits reachable from `start` among the loaded ones (parents come after children in the list). */
export function reachableFrom(commits: readonly Commit[], start: string): Set<string> {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const h = stack.pop()!;
    if (seen.has(h)) continue;
    const c = byHash.get(h);
    if (!c) continue;
    seen.add(h);
    for (const p of c.parents) stack.push(p);
  }
  return seen;
}

/**
 * Keeps the commits in `keep` and gives each the nearest kept ancestors as parents, so the graph of a
 * filtered log stays connected (the IDE rewrites parents the same way). `commits` is newest first with
 * parents after their children, which is what `git log --date-order` returns.
 */
export function rewriteParents(commits: readonly Commit[], keep: ReadonlySet<string>): Commit[] {
  // nearest[h]: the kept commits to attach to when a child links to h.
  const nearest = new Map<string, string[]>();
  for (let i = commits.length - 1; i >= 0; i--) {
    const c = commits[i];
    if (keep.has(c.hash)) {
      nearest.set(c.hash, [c.hash]);
      continue;
    }
    const via: string[] = [];
    for (const p of c.parents) for (const h of nearest.get(p) ?? []) if (!via.includes(h)) via.push(h);
    nearest.set(c.hash, via);
  }
  const out: Commit[] = [];
  for (const c of commits) {
    if (!keep.has(c.hash)) continue;
    const parents: string[] = [];
    for (const p of c.parents) for (const h of nearest.get(p) ?? []) if (!parents.includes(h)) parents.push(h);
    out.push({ ...c, parents });
  }
  return out;
}

/** The commits that pass `f`, with parents rewritten across the hidden ones. `now` is in ms. */
export function applyLogFilter(commits: Commit[], f: LogFilter, refs: Refs, now = Date.now()): Commit[] {
  if (!isFiltering(f)) return commits;
  const text = f.text.trim().toLowerCase();
  const since = f.days == null ? null : now / 1000 - f.days * 86400;
  const tip = f.branch ? refTarget(refs, f.branch) : null;
  const reach = f.branch ? (tip ? reachableFrom(commits, tip) : new Set<string>()) : null;
  const author = f.author?.toLowerCase() ?? null;
  const keep = new Set<string>();
  for (const c of commits) {
    if (reach && !reach.has(c.hash)) continue;
    if (since != null && c.time < since) continue;
    if (author && c.author.toLowerCase() !== author && c.email.toLowerCase() !== author) continue;
    if (text && !(c.subject.toLowerCase().includes(text) || c.author.toLowerCase().includes(text) || c.hash.startsWith(text))) continue;
    keep.add(c.hash);
  }
  return rewriteParents(commits, keep);
}

/** Distinct authors, most active first. */
export function authorsOf(commits: readonly Commit[]): { name: string; email: string; count: number }[] {
  const by = new Map<string, { name: string; email: string; count: number }>();
  for (const c of commits) {
    const key = c.email.toLowerCase() || c.author.toLowerCase();
    const e = by.get(key);
    if (e) e.count++;
    else by.set(key, { name: c.author, email: c.email, count: 1 });
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const DATE_FILTERS: readonly { label: string; days: number | null }[] = [
  { label: 'Any time', days: null },
  { label: 'Last 24 hours', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last year', days: 365 },
];

// ---------------------------------------------------------------- dates

/** "Today 14:03", "Yesterday 09:12", otherwise the short local date and time, like the IDE's Date column. */
export function jbTime(sec: number, now = Date.now()): string {
  const d = new Date(sec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startOfDay = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86400000);
  if (days === 0) return `Today ${hm}`;
  if (days === 1) return `Yesterday ${hm}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${hm}`;
}

// ---------------------------------------------------------------- view options and ref labels

/** The log's View Options (OpenIDEA logOptions.ts, IDEA's defaults). */
export interface JbLogOptions {
  /** A local branch absorbs its remote-tracking branches ("origin & main"). */
  compactRefs: boolean;
  /** Show tag names; off shows one tag icon. */
  tagNames: boolean;
  refsOnLeft: boolean;
  showAuthor: boolean;
  showDate: boolean;
  showHash: boolean;
  highlightMine: boolean;
  highlightMerges: boolean;
  highlightCurrentBranch: boolean;
  showBranches: boolean;
}

export const DEFAULT_JB_OPTIONS: JbLogOptions = {
  compactRefs: true,
  tagNames: false,
  refsOnLeft: false,
  showAuthor: true,
  showDate: true,
  showHash: false,
  highlightMine: true,
  highlightMerges: true,
  highlightCurrentBranch: true,
  showBranches: true,
};

export function parseJbOptions(raw: unknown): JbLogOptions {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_JB_OPTIONS };
  for (const k of Object.keys(out) as (keyof JbLogOptions)[]) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  return out;
}

export type JbRefKind = 'head' | 'local' | 'remote' | 'tag';

export interface JbRefLabel {
  kind: JbRefKind;
  /** Empty for a tag shown without its name. */
  text: string;
  title: string;
}

/**
 * The labels of one commit row, like the IDE: compact view merges a local branch with its remote-tracking
 * branches ("origin & main"); HEAD is only labelled when it is detached; tags are one icon unless tag names
 * are on. `labels` are the commit's RefLabels (core/menus.ts).
 */
export function jbRefLabels(labels: readonly RefLabel[], opts: { compact: boolean; tagNames: boolean }, detachedHere: boolean): JbRefLabel[] {
  const out: JbRefLabel[] = [];
  const branches = labels.filter((l) => l.kind === 'branch');
  if (detachedHere && !branches.length) out.push({ kind: 'head', text: 'HEAD', title: 'HEAD' });
  const trailing: JbRefLabel[] = [];
  for (const l of branches) {
    if (l.local) {
      const tracking = l.remotes;
      if (opts.compact && tracking.length) {
        out.push({ kind: 'local', text: `${tracking.map((r) => r.remote).join(', ')} & ${l.local.name}`, title: [l.local.name, ...tracking.map((r) => r.name)].join(', ') });
      } else {
        out.push({ kind: 'local', text: l.local.name, title: l.local.name });
        for (const r of tracking) trailing.push({ kind: 'remote', text: r.name, title: r.name });
      }
    } else for (const r of l.remotes) out.push({ kind: 'remote', text: r.name, title: r.name });
  }
  out.push(...trailing);
  const tags = labels.filter((l) => l.kind === 'tag').map((l) => l.name);
  if (tags.length) {
    if (opts.tagNames) out.push(...tags.map((t) => ({ kind: 'tag' as const, text: t, title: t })));
    else out.push({ kind: 'tag', text: '', title: tags.join(', ') });
  }
  return out;
}
