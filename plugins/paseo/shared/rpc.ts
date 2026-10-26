// RPC contracts between the panel and the daemon (plans/261026-paseo-plugin/solution.md §3,
// payload samples in data-model.md §2). Zod validates both directions, so every field is declared.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const Commit = z.object({
  hash: z.string(),
  parents: z.array(z.string()),
  author: z.string(),
  email: z.string(),
  time: z.number(),
  subject: z.string(),
});
const LocalBranch = z.object({
  name: z.string(),
  target: z.string(),
  upstream: z.string().nullable(),
  upstreamGone: z.boolean(),
  ahead: z.number(),
  behind: z.number(),
  current: z.boolean(),
});
const RemoteBranch = z.object({ name: z.string(), remote: z.string(), branch: z.string(), target: z.string() });
const Tag = z.object({ name: z.string(), target: z.string(), annotated: z.boolean() });
const FileChange = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  status: z.string(),
  untracked: z.boolean().optional(),
  conflict: z.string().optional(),
  additions: z.number().nullable().optional(),
  deletions: z.number().nullable().optional(),
});
const RepoStateName = z.enum(["clean", "merging", "rebasing", "cherry-picking", "reverting"]);

export const SnapshotSchema = z.object({
  kind: z.literal("repo"),
  revision: z.number(),
  commits: z.array(Commit),
  hasMore: z.boolean(),
  refs: z.object({
    local: z.array(LocalBranch),
    remote: z.array(RemoteBranch),
    tags: z.array(Tag),
    head: z.string().nullable(),
    headSha: z.string().nullable(),
    headDetached: z.boolean(),
  }),
  status: z.object({
    branch: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number(),
    behind: z.number(),
    staged: z.array(FileChange),
    unstaged: z.array(FileChange),
    conflicted: z.array(FileChange),
  }),
  stashes: z.array(
    z.object({ hash: z.string(), base: z.string(), ref: z.string(), index: z.number(), message: z.string(), time: z.number() }),
  ),
  remotes: z.array(z.object({ name: z.string(), fetchUrl: z.string(), pushUrl: z.string() })),
  // gitDir is deliberately absent: absolute daemon paths are not sent to (possibly remote) clients.
  state: z.object({ state: RepoStateName, mergeMsg: z.string(), mergeHead: z.string().nullable() }),
  submodules: z.array(z.object({ state: z.string(), hash: z.string(), path: z.string() })),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

/**
 * Which repository a call is about (dinh-chinh-02): a Paseo workspace, or any directory on the daemon's
 * machine the user picked. Paths inside the repository are still confined by server/guard.ts.
 */
export const RepoRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("workspace"), id: z.string().min(1) }),
  z.object({ kind: z.literal("path"), path: z.string().min(1).max(4096) }),
]);
export type RepoRef = z.infer<typeof RepoRefSchema>;

/** Cheap poll: no git process is spawned (flows.md F2). */
export const revisionRpc = defineRpc({
  name: "githistory.revision",
  input: z.object({ repo: RepoRefSchema }),
  output: z.object({ revision: z.number(), state: z.union([RepoStateName, z.literal("not-a-repo")]) }),
});

export const snapshotRpc = defineRpc({
  name: "githistory.snapshot",
  input: z.object({ repo: RepoRefSchema, logLimit: z.number().int().min(1).max(5000), logSkip: z.number().int().min(0) }),
  output: z.discriminatedUnion("kind", [SnapshotSchema, z.object({ kind: z.literal("not-a-repo") })]),
});

/** Git workspaces Paseo knows about, for the project tabs (dinh-chinh-01). Never returns paths. */
export const workspacesRpc = defineRpc({
  name: "githistory.workspaces",
  input: z.object({}),
  output: z.object({
    entries: z.array(z.object({ id: z.string(), name: z.string(), projectName: z.string() })),
  }),
});

/** Directory browser for opening a project that is not a Paseo workspace (dinh-chinh-02). */
export const browseRpc = defineRpc({
  name: "githistory.browse",
  input: z.object({ path: z.string().max(4096).optional(), showHidden: z.boolean().optional() }),
  output: z.object({
    path: z.string(),
    parent: z.string().nullable(),
    isRepo: z.boolean(),
    entries: z.array(z.object({ name: z.string(), path: z.string(), isRepo: z.boolean() })),
    truncated: z.boolean(),
  }),
});

/** One of the read ops in shared/ops.ts; args are validated per op on the server. */
export const readRpc = defineRpc({
  name: "githistory.read",
  input: z.object({ repo: RepoRefSchema, op: z.string(), args: z.unknown() }),
  output: z.object({ result: z.unknown() }),
});

/**
 * One of the write ops in shared/ops.ts. `opId` is generated once per user action and reused on retry:
 * a repeated opId returns the first outcome instead of running git again (flows.md F3). Network ops
 * return a `jobId` to poll with `githistory.job` (solution.md §6).
 */
export const writeRpc = defineRpc({
  name: "githistory.write",
  input: z.object({ repo: RepoRefSchema, opId: z.string().min(8).max(64), op: z.string(), args: z.unknown() }),
  output: z.object({ result: z.unknown().optional(), jobId: z.string().optional() }),
});

export const jobRpc = defineRpc({
  name: "githistory.job",
  input: z.object({ repo: RepoRefSchema, jobId: z.string() }),
  output: z.object({
    status: z.enum(["running", "done", "failed"]),
    op: z.string(),
    progress: z.string(),
    error: z.string().optional(),
  }),
});

export const historyRpc = defineRpc({
  name: "githistory.history",
  input: z.object({ repo: RepoRefSchema, action: z.enum(["peek", "undo", "redo"]), opId: z.string().min(8).max(64).optional() }),
  output: z.object({ label: z.string().nullable(), undo: z.string().nullable(), redo: z.string().nullable() }),
});

const SavedTab = z.object({ ref: RepoRefSchema, title: z.string().min(1).max(200) });
export type SavedTab = z.infer<typeof SavedTab>;
const TabsState = z.object({ tabs: z.array(SavedTab).max(30), active: z.string().max(4200).nullable() });
export type TabsState = z.infer<typeof TabsState>;

/** Open project tabs, kept on the daemon so a reload or another device shows the same tabs (dinh-chinh-03). */
export const tabsRpc = defineRpc({
  name: "githistory.tabs",
  input: z.discriminatedUnion("action", [z.object({ action: z.literal("get") }), z.object({ action: z.literal("set"), state: TabsState })]),
  output: TabsState,
});

/**
 * Directory search for the project picker, like Paseo's own "Search for directory": a name fragment
 * searches under the home directory; a value starting with "/" or "~" completes that path.
 */
export const searchDirsRpc = defineRpc({
  name: "githistory.search-dirs",
  input: z.object({ query: z.string().max(1024) }),
  output: z.object({ entries: z.array(z.object({ path: z.string(), display: z.string(), isRepo: z.boolean() })), truncated: z.boolean() }),
});
