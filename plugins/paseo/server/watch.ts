// Keeps each open repository's revision counter current (solution.md §5, flows.md F2). Paseo has no
// server → client push, so clients poll `githistory.revision`; this file is what makes that poll cheap:
// the counter and repo state are updated here on file changes, never per poll.
import fs from "node:fs";
import path from "node:path";
import * as git from "./core-node/git";

export const DEBOUNCE_MS = 400;
export const IDLE_MS = 10 * 60_000;
const FALLBACK_POLL_MS = 2000;

// WHY: object writes and lock files fire on every git command but never change what the UI shows on their
// own; the ref/index/HEAD rename that follows them does.
const IGNORED = /(^|[\\/])(\.git[\\/]objects|node_modules)([\\/]|$)|\.lock$/;

/** Long, real form of a path (resolves symlinks and Windows 8.3 short names); the input if it does not exist. */
function canonical(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

export type RepoStateName = "clean" | "merging" | "rebasing" | "cherry-picking" | "reverting";

export interface Watched {
  workspaceId: string;
  toplevel: string;
  revision: number;
  state: RepoStateName;
  lastAccess: number;
  stop: (() => void) | null;
}

async function readState(w: Watched) {
  try {
    w.state = (await git.repoState(w.toplevel)).state as RepoStateName;
  } catch {
    // Repository vanished or is mid-rewrite; keep the last known state, the next event refreshes it.
  }
}

/** Starts watching `w.toplevel` (and an out-of-tree git dir, for linked worktrees) if not already. */
export async function ensureWatching(w: Watched): Promise<void> {
  if (w.stop) return;
  const stops: (() => void)[] = [];
  // Claimed before the first await so a concurrent poll does not start a second watcher.
  w.stop = () => stops.forEach((s) => s());
  let timer: NodeJS.Timeout | null = null;
  const bump = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      await readState(w);
      w.revision++;
    }, DEBOUNCE_MS);
  };
  stops.push(() => timer && clearTimeout(timer));
  // Each watched directory with the prefix that makes its event paths read like paths under the worktree.
  const dirs: { dir: string; prefix: string }[] = [{ dir: w.toplevel, prefix: "" }];
  const gitDir = await git.git(w.toplevel, ["rev-parse", "--absolute-git-dir"]).then((s: string) => s.trim(), () => null);
  // WHY realpath.native: on Windows git prints C:/Users/runneradmin/… while the worktree may be the 8.3 form
  // C:\Users\RUNNER~1\…; compared raw, .git looked outside the worktree and was watched twice.
  if (gitDir && path.relative(canonical(w.toplevel), canonical(gitDir)).startsWith("..")) dirs.push({ dir: gitDir, prefix: ".git/" });
  for (const { dir, prefix } of dirs) {
    try {
      const watcher = fs.watch(dir, { recursive: true }, (_event, file) => {
        if (file && IGNORED.test(prefix + String(file))) return;
        bump();
      });
      watcher.on("error", () => {}); // a deleted subtree must not crash the daemon
      stops.push(() => watcher.close());
    } catch {
      // Recursive fs.watch unsupported (older Node on Linux — solution.md §9): poll a cheap fingerprint.
      let last = "";
      const iv = setInterval(async () => {
        const fp = await git
          .git(w.toplevel, ["status", "--porcelain=v2", "--branch"])
          .then((s: string) => s, () => "");
        if (fp !== last) {
          if (last) bump();
          last = fp;
        }
      }, FALLBACK_POLL_MS);
      stops.push(() => clearInterval(iv));
      break;
    }
  }
  await readState(w);
  console.info(`STARTED: watcher workspace=${w.workspaceId} dirs=${dirs.length}`);
}

export function stopWatching(w: Watched, reason: string) {
  if (!w.stop) return;
  w.stop();
  w.stop = null;
  console.info(`SHUTDOWN: watcher workspace=${w.workspaceId} reason=${reason}`);
}

/** Closes watchers nobody has polled for IDLE_MS. */
export function sweepIdle(all: Iterable<Watched>, now = Date.now()) {
  for (const w of all) if (w.stop && now - w.lastAccess > IDLE_MS) stopWatching(w, "idle");
}

export function startIdleSweep(all: () => Iterable<Watched>): () => void {
  const iv = setInterval(() => sweepIdle(all()), 60_000);
  iv.unref?.();
  return () => clearInterval(iv);
}
