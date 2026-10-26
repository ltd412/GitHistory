// githistory.read / write / job / history: the op calls behind every button of the UI. Validation and path
// confinement happen in dispatch.ts; this file adds per-repository idempotency, background jobs for
// network ops and the undo history (data-model.md §4).
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { createHistory } from "./core-node/history";
import { runRead, runWrite, validateWrite } from "./dispatch";
import { resolve, type RepoHandle } from "./registry";
import { NETWORK_OPS, type WriteOp } from "../shared/ops";
import type { historyRpc, jobRpc, readRpc, writeRpc } from "../shared/rpc";

const OPS_LIMIT = 200;
const JOB_TTL_MS = 5 * 60_000;

type Outcome = { ok: true; value: RpcOutput<typeof writeRpc> } | { ok: false; error: string };
interface Job {
  id: string;
  op: string;
  status: "running" | "done" | "failed";
  progress: string;
  error?: string;
  finishedAt?: number;
}
interface RepoRuntime {
  ops: Map<string, Promise<Outcome>>;
  jobs: Map<string, Job>;
}

const runtimes = new WeakMap<RepoHandle, RepoRuntime>();
const history = createHistory();
let jobSeq = 0;

function runtime(h: RepoHandle): RepoRuntime {
  let r = runtimes.get(h);
  if (!r) runtimes.set(h, (r = { ops: new Map(), jobs: new Map() }));
  for (const [id, j] of r.jobs) if (j.finishedAt && Date.now() - j.finishedAt > JOB_TTL_MS) r.jobs.delete(id);
  return r;
}

async function repoOf(input: { repo: RpcInput<typeof readRpc>["repo"] }, paseo: PluginHandlerContext["paseo"]) {
  const h = await resolve(paseo, input.repo);
  if (!h.toplevel) throw new Error("Not a Git repository");
  return { h, dir: h.toplevel };
}

/**
 * Runs `fn` at most once per opId. The promise itself is stored, so a retry that arrives while the first
 * call is still running waits for it instead of starting a second git process.
 */
async function once(rt: RepoRuntime, opId: string, fn: () => Promise<RpcOutput<typeof writeRpc>>): Promise<RpcOutput<typeof writeRpc>> {
  let p = rt.ops.get(opId);
  if (!p) {
    p = fn().then(
      (value): Outcome => ({ ok: true, value }),
      (e): Outcome => ({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    rt.ops.set(opId, p);
    if (rt.ops.size > OPS_LIMIT) rt.ops.delete(rt.ops.keys().next().value!);
  }
  const out = await p;
  if (!out.ok) throw new Error(out.error);
  return out.value;
}

export async function read(input: RpcInput<typeof readRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof readRpc>> {
  const { dir } = await repoOf(input, paseo);
  return { result: await runRead(dir, input.op, input.args) };
}

export async function write(input: RpcInput<typeof writeRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof writeRpc>> {
  const { h, dir } = await repoOf(input, paseo);
  const rt = runtime(h);
  return once(rt, input.opId, async () => {
    if (!NETWORK_OPS.includes(input.op as WriteOp)) {
      const result = await runWrite(dir, input.op, input.args, undefined, history.tracked);
      return { result: result ?? null };
    }
    // Network ops: a refused op fails the call itself; only a valid one becomes a background job.
    validateWrite(dir, input.op, input.args);
    const job: Job = { id: `job_${++jobSeq}`, op: input.op, status: "running", progress: "" };
    const started = runWrite(dir, input.op, input.args, (chunk) => {
      const line = chunk.split(/[\r\n]+/).filter(Boolean).pop();
      if (line) job.progress = line.trim();
    }, history.tracked);
    rt.jobs.set(job.id, job);
    started.then(
      () => {
        job.status = "done";
        job.finishedAt = Date.now();
      },
      (e) => {
        job.status = "failed";
        job.error = e instanceof Error ? e.message : String(e);
        job.finishedAt = Date.now();
      },
    );
    return { jobId: job.id };
  });
}

export async function job(input: RpcInput<typeof jobRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof jobRpc>> {
  const { h } = await repoOf(input, paseo);
  const j = runtime(h).jobs.get(input.jobId);
  // After a plugin reload the job is gone; never let the client read that as success (flows.md F10).
  if (!j) throw new Error("Unknown job — the operation was interrupted; check the repository state");
  return { status: j.status, op: j.op, progress: j.progress, ...(j.error ? { error: j.error } : {}) };
}

export async function undoRedo(input: RpcInput<typeof historyRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof historyRpc>> {
  const { h, dir } = await repoOf(input, paseo);
  if (input.action === "peek") return { label: null, ...history.info(dir) };
  if (!input.opId) throw new Error("opId is required for undo/redo");
  const out = await once(runtime(h), input.opId, async () => ({
    result: input.action === "undo" ? await history.undo(dir) : await history.redo(dir),
  }));
  return { label: (out.result as string | null) ?? null, ...history.info(dir) };
}
