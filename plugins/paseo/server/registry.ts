// Maps a RepoRef to its repository on this machine: a Paseo workspace (its directory comes from Paseo's
// own list, plan.md Q6) or any directory the user picked (dinh-chinh-02).
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as git from "./core-node/git";

type PaseoApi = PluginHandlerContext["paseo"];
import { ensureWatching, startIdleSweep, stopWatching, type Watched } from "./watch";
import type { RepoRef } from "../shared/rpc";

export interface RepoHandle extends Omit<Watched, "toplevel"> {
  /** git rev-parse --show-toplevel of the directory; null when it is not a repository. */
  toplevel: string | null;
}

const handles = new Map<string, RepoHandle>();
const creating = new Map<string, Promise<RepoHandle>>();
const watched = () => [...handles.values()].filter((h): h is RepoHandle & Watched => h.toplevel !== null);
let stopSweep: (() => void) | null = null;

/** `~` and `~/x` mean the daemon user's home; anything else must be absolute. */
export function expandPath(p: string): string {
  const expanded = p === "~" ? os.homedir() : p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
  if (!path.isAbsolute(expanded) || expanded.includes("\0")) throw new Error(`Not an absolute path: ${p}`);
  return path.resolve(expanded);
}

async function directoryOf(paseo: PaseoApi, ref: RepoRef): Promise<string> {
  if (ref.kind === "path") {
    const dir = expandPath(ref.path);
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Not a directory: ${ref.path}`);
    return dir;
  }
  const { entries } = await paseo.workspaces.list();
  const ws = entries.find((w) => w.id === ref.id);
  if (!ws) throw new Error(`Unknown workspace ${ref.id}`);
  return ws.workspaceDirectory ?? ws.projectRootPath;
}

const keyOf = (ref: RepoRef) => (ref.kind === "workspace" ? `ws:${ref.id}` : `dir:${ref.path}`);

/**
 * The handle for a repository, with its watcher running. A watcher closed for idleness is reopened here and
 * the revision bumped, because changes made while nobody watched were missed (flows.md F2).
 */
export async function resolve(paseo: PaseoApi, ref: RepoRef): Promise<RepoHandle> {
  const key = keyOf(ref);
  let h = handles.get(key);
  const fresh = !h;
  if (!h) {
    // Concurrent first polls share one lookup, so they end up with the same handle and watcher.
    let p = creating.get(key);
    if (!p) {
      p = (async () => {
        const dir = await directoryOf(paseo, ref);
        const toplevel: string | null = (await git.isRepo(dir)) ?? null;
        const created: RepoHandle = { workspaceId: key, toplevel, revision: 1, state: "clean", lastAccess: Date.now(), stop: null };
        handles.set(key, created);
        return created;
      })().finally(() => creating.delete(key));
      creating.set(key, p);
    }
    h = await p;
  }
  h.lastAccess = Date.now();
  if (h.toplevel && !h.stop) {
    await ensureWatching(h as RepoHandle & Watched);
    if (!fresh) h.revision++;
  }
  stopSweep ??= startIdleSweep(watched);
  return h;
}

export function disposeAll() {
  for (const h of watched()) stopWatching(h, "plugin-unload");
  stopSweep?.();
  stopSweep = null;
  handles.clear();
}
