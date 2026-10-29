// Shared by the desktop app and the Paseo plugin server: "something under this repository changed".
import fs from 'node:fs';
import path from 'node:path';

// WHY: object writes and lock files fire on every git command but never change what the UI shows on their
// own; the ref/index/HEAD rename that follows them does.
// Windows also reports the bare ".git" directory when something inside it changes; the meaningful
// changes (HEAD, refs, index) always arrive with their own path, so the directory event alone is noise.
const NOISE = /(^|[\\/])(\.git[\\/]objects|node_modules)([\\/]|$)|\.lock$|^\.git$/;
export const isNoise = (rel: string) => NOISE.test(rel);

const POLL_MS = 2000;
// WHY: inotify watches are a system-wide budget (fs.inotify.max_user_watches), shared with IDEs and other apps.
// Past this many directories we stop adding watchers and poll `git status` instead.
const MAX_DIRS = 8000;
// Dependency / cache trees that are huge, ignored by git and never change what the UI shows.
const SKIP_DIRS = new Set(['node_modules', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.tox']);

export interface WatchTreeOptions {
  /** Prepended to event paths before they are tested with `ignore` (e.g. ".git/" for an out-of-tree git dir). */
  prefix?: string;
  /** Paths (relative to `root`, '/' separated) that neither fire `onChange` nor get a watcher. Default: `isNoise`. */
  ignore?: (rel: string) => boolean;
  /** Cheap snapshot of the repository state, compared while polling after watching had to be given up. */
  fingerprint: () => Promise<string>;
}

/**
 * Calls `onChange` (not debounced) when something under `root` changes; returns the function that stops watching.
 *
 * WHY not `fs.watch(root, { recursive: true })` on Linux: Node implements it in JavaScript with one inotify watch
 * per directory and adds watchers for new directories from inside the event callback. When the system limit is
 * reached that throws ENOSPC from the callback — an uncaught exception that cannot be caught by an `error`
 * listener. Here every watcher is created inside try/catch, and running out of watches (or an over-large tree)
 * degrades to polling instead of crashing. macOS and Windows have native recursive watching and keep using it.
 */
export function watchTree(root: string, onChange: () => void, opts: WatchTreeOptions): () => void {
  const prefix = opts.prefix ?? '';
  const ignore = opts.ignore ?? isNoise;
  const ignored = (rel: string) => ignore(prefix + rel);
  const watchers = new Map<string, fs.FSWatcher>();
  let poll: NodeJS.Timeout | null = null;
  let stopped = false;

  const stop = () => {
    stopped = true;
    for (const w of watchers.values()) w.close();
    watchers.clear();
    if (poll) clearInterval(poll);
    poll = null;
  };

  const degrade = () => {
    if (poll || stopped) return;
    let last = '';
    poll = setInterval(async () => {
      const fp = await opts.fingerprint().catch(() => '');
      if (fp !== last) {
        if (last) onChange();
        last = fp;
      }
    }, POLL_MS);
    poll.unref?.();
  };

  if (process.platform !== 'linux') {
    try {
      const w = fs.watch(root, { recursive: true }, (_event, file) => {
        if (file && ignored(String(file))) return;
        onChange();
      });
      w.on('error', () => {}); // a deleted subtree must not crash the process
      watchers.set('', w);
    } catch {
      degrade();
    }
    return stop;
  }

  const closeDir = (rel: string) => {
    for (const [key, w] of watchers) {
      if (key === rel || key.startsWith(rel + '/')) {
        w.close();
        watchers.delete(key);
      }
    }
  };

  const addDir = (rel: string) => {
    if (stopped || watchers.has(rel)) return;
    if (watchers.size >= MAX_DIRS) return degrade();
    const abs = path.join(root, rel);
    let w: fs.FSWatcher;
    try {
      w = fs.watch(abs, (_event, file) => onEvent(rel, file));
    } catch (e) {
      // ENOENT: the directory vanished while walking; anything else (ENOSPC, EMFILE…) means we cannot watch it all.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') degrade();
      return;
    }
    w.on('error', () => closeDir(rel));
    watchers.set(rel, w);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      // WHY trailing '/': a directory is skipped only when something *inside* it is noise; the bare ".git" entry
      // is noise as an event, but the directory itself must be watched (HEAD, refs, index live there).
      if (!ignored(child + '/')) addDir(child);
    }
  };

  const onEvent = (dir: string, file: string | Buffer | null) => {
    if (!file) return onChange();
    const name = String(file);
    const rel = dir ? `${dir}/${name}` : name;
    if (ignored(rel)) return;
    // inotify is not recursive: a directory that just appeared needs its own watcher.
    if (!SKIP_DIRS.has(name) && !watchers.has(rel)) {
      try {
        if (fs.statSync(path.join(root, rel)).isDirectory()) addDir(rel);
      } catch {
        /* a file, or already gone */
      }
    } else if (watchers.has(rel) && !fs.existsSync(path.join(root, rel))) {
      closeDir(rel);
    }
    onChange();
  };

  addDir('');
  return stop;
}
