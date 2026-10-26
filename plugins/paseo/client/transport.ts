// The desktop's typed git API (core/git-client.ts) over Paseo RPC: reads go to githistory.read, writes to
// githistory.write with a fresh opId per call, and network ops wait for their background job, so callers
// see exactly what the desktop sees — a resolved promise, or git's error message.
import { createGitClient, namedArgs } from "../shared/core/git-client";
import { READ_OPS } from "../shared/ops";
import type { RepoRef } from "../shared/rpc";

export interface RpcFns {
  read: (input: { repo: RepoRef; op: string; args: unknown }) => Promise<{ result?: unknown }>;
  write: (input: { repo: RepoRef; opId: string; op: string; args: unknown }) => Promise<{ result?: unknown; jobId?: string }>;
  job: (input: { repo: RepoRef; jobId: string }) => Promise<{ status: "running" | "done" | "failed"; progress: string; error?: string }>;
}

const JOB_POLL_MS = 700;

/** Random id for one user action; reused only by retries of that action (flows.md F3). */
export function newOpId(): string {
  const rnd = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join("");
  return `${Date.now().toString(36)}-${rnd}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function rpcGitClient(rpc: RpcFns, repo: RepoRef, onProgress?: (line: string) => void) {
  return createGitClient(async (method, args) => {
    const named = namedArgs(method, args.slice(1));
    if (Object.prototype.hasOwnProperty.call(READ_OPS, method)) return (await rpc.read({ repo, op: method, args: named })).result;
    const out = await rpc.write({ repo, opId: newOpId(), op: method, args: named });
    if (!out.jobId) return out.result;
    for (;;) {
      await sleep(JOB_POLL_MS);
      const j = await rpc.job({ repo, jobId: out.jobId });
      if (j.progress) onProgress?.(j.progress);
      if (j.status === "done") return null;
      if (j.status === "failed") throw new Error(j.error || `${method} failed`);
    }
  });
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^(Error: )+/, "");
