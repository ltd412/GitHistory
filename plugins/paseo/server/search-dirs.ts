// Directory search behind the project picker (dinh-chinh-02: any folder on the daemon's machine may be
// opened). Bounded so a broad query on a large home directory still answers fast.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { expandPath } from "./registry";
import type { searchDirsRpc } from "../shared/rpc";

const LIMIT = 50;
const MAX_DEPTH = 5;
const MAX_VISITS = 20_000;
const BUDGET_MS = 400;
// Never interesting as a project, and huge.
const SKIP = new Set(["node_modules", "Library", ".git", "Pictures", "Music", "Movies", ".Trash", "venv", ".venv", "__pycache__", "dist", "build"]);

type Entry = RpcOutput<typeof searchDirsRpc>["entries"][number];

const isRepoDir = (dir: string) => fs.existsSync(path.join(dir, ".git"));
export const display = (p: string, home = os.homedir()) => (p === home ? "~" : p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p);
const entry = (p: string): Entry => ({ path: p, display: display(p), isRepo: isRepoDir(p) });

function subdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() || (d.isSymbolicLink() && fs.statSync(path.join(dir, d.name), { throwIfNoEntry: false })?.isDirectory()))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** "~/code/gi" → children of ~/code starting with "gi"; "~/code/" → all children of ~/code. */
function completePath(query: string): RpcOutput<typeof searchDirsRpc> {
  const full = expandPath(query.endsWith("/") ? query.slice(0, -1) || "/" : query);
  const exact = fs.statSync(full, { throwIfNoEntry: false })?.isDirectory();
  const [dir, prefix] = query.endsWith("/") ? [full, ""] : [path.dirname(full), path.basename(full).toLowerCase()];
  const names = subdirs(dir)
    .filter((n) => n.toLowerCase().startsWith(prefix) && (prefix.startsWith(".") || !n.startsWith(".")))
    .sort((a, b) => a.localeCompare(b));
  const out = names.slice(0, LIMIT).map((n) => entry(path.join(dir, n)));
  if (exact && !query.endsWith("/") && !out.some((e) => e.path === full)) out.unshift(entry(full));
  return { entries: out.slice(0, LIMIT), truncated: names.length > LIMIT };
}

/** Breadth-first under home; a directory matches when its path below home contains the query. */
function searchHome(query: string, home = os.homedir()): RpcOutput<typeof searchDirsRpc> {
  const q = query.toLowerCase();
  const started = Date.now();
  const hits: string[] = [];
  let queue = [home];
  let visits = 0;
  let truncated = false;
  for (let depth = 0; depth <= MAX_DEPTH && queue.length; depth++) {
    const next: string[] = [];
    for (const dir of queue) {
      for (const name of subdirs(dir)) {
        if (name.startsWith(".") || SKIP.has(name)) continue;
        const p = path.join(dir, name);
        if (p.slice(home.length).toLowerCase().includes(q)) hits.push(p);
        next.push(p);
        if (++visits >= MAX_VISITS || Date.now() - started > BUDGET_MS) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
    if (truncated) break;
    queue = next;
  }
  // Name matches before matches only somewhere in the path, then shallower, then alphabetical.
  const score = (p: string) => (path.basename(p).toLowerCase().includes(q) ? 0 : 1);
  hits.sort((a, b) => score(a) - score(b) || a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b));
  return { entries: hits.slice(0, LIMIT).map(entry), truncated: truncated || hits.length > LIMIT };
}

export async function searchDirs({ query }: RpcInput<typeof searchDirsRpc>): Promise<RpcOutput<typeof searchDirsRpc>> {
  const q = query.trim();
  if (!q) return { entries: [], truncated: false };
  return q.startsWith("/") || q.startsWith("~") ? completePath(q) : searchHome(q);
}
