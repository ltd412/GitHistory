import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import * as git from "./core-node/git";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandPath, resolve } from "./registry";
import type { browseRpc, revisionRpc, snapshotRpc, workspacesRpc } from "../shared/rpc";
import type { Remote, RepoState } from "../shared/core/types";

// The git module is ported JavaScript with loose return types; these are the shapes it produces.
type StateName = RepoState["state"];

export async function revision(
  { repo: ref }: RpcInput<typeof revisionRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof revisionRpc>> {
  // No git process here: the watcher keeps revision and state current (flows.md F2).
  const h = await resolve(paseo, ref);
  if (!h.toplevel) return { revision: h.revision, state: "not-a-repo" };
  return { revision: h.revision, state: h.state };
}

export async function snapshot(
  { repo: ref, logLimit, logSkip }: RpcInput<typeof snapshotRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof snapshotRpc>> {
  const h = await resolve(paseo, ref);
  const repo = h.toplevel;
  if (!repo) return { kind: "not-a-repo" };
  const [refs, status, stashes, state, commits, remotes, submodules] = await Promise.all([
    git.refs(repo),
    git.status(repo),
    git.stashes(repo),
    git.repoState(repo),
    git.log(repo, { limit: logLimit, skip: logSkip }),
    git.remotes(repo),
    git.submodules(repo),
  ]);
  return {
    kind: "repo",
    revision: h.revision,
    commits,
    hasMore: commits.length >= logLimit,
    refs,
    status,
    stashes,
    remotes: remotes as Remote[],
    state: { state: state.state as StateName, mergeMsg: state.mergeMsg, mergeHead: state.mergeHead },
    submodules,
  };
}

export async function workspaces(
  _input: RpcInput<typeof workspacesRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof workspacesRpc>> {
  const { entries } = await paseo.workspaces.list();
  return {
    entries: entries
      .filter((w) => w.projectKind === "git" && !w.archivingAt)
      .map((w) => ({ id: w.id, name: w.title || w.name, projectName: w.projectCustomName || w.projectDisplayName })),
  };
}

const BROWSE_MAX = 2000;
const isRepoDir = (dir: string) => fs.existsSync(path.join(dir, ".git"));

/** Lists sub-directories, marking Git repositories. Any directory the daemon user can read (dinh-chinh-02). */
export async function browse({ path: p, showHidden }: RpcInput<typeof browseRpc>): Promise<RpcOutput<typeof browseRpc>> {
  const dir = expandPath(p || os.homedir());
  const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
  const entries: RpcOutput<typeof browseRpc>["entries"] = [];
  for (const d of dirents) {
    if (!showHidden && d.name.startsWith(".")) continue;
    const full = path.join(dir, d.name);
    const isDir = d.isDirectory() || (d.isSymbolicLink() && fs.statSync(full, { throwIfNoEntry: false })?.isDirectory());
    if (isDir) entries.push({ name: d.name, path: full, isRepo: isRepoDir(full) });
  }
  entries.sort((a, b) => Number(b.isRepo) - Number(a.isRepo) || a.name.localeCompare(b.name));
  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, isRepo: isRepoDir(dir), entries: entries.slice(0, BROWSE_MAX), truncated: entries.length > BROWSE_MAX };
}
