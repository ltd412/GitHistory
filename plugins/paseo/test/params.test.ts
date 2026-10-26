// The client names positional git arguments with GIT_PARAMS; the server validates them with shared/ops.ts.
// If the two drift, a button sends a field the schema drops and the op runs with defaults — silently.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GIT_PARAMS, namedArgs } from "../shared/core/git-client";
import { READ_OPS, WRITE_OPS } from "../shared/ops";

const SPREAD_KEYS: Record<string, string[]> = {
  log: ["limit", "skip"],
  diffWorking: ["staged", "untracked", "ignoreWs", "full"],
  applyPatch: ["cached", "reverse"],
  commit: ["amend"],
  merge: ["mode", "message"],
  fetch: ["remote", "prune"],
  pull: ["rebase", "ffOnly"],
  push: ["remote", "branch", "force", "setUpstream", "tags"],
  stashSave: ["message", "includeUntracked", "keepIndex"],
};

test("every exposed op has argument names, and they are exactly the schema's keys", () => {
  const ops = { ...READ_OPS, ...WRITE_OPS } as Record<string, { shape: Record<string, unknown> }>;
  assert.deepEqual(Object.keys(GIT_PARAMS).sort(), Object.keys(ops).sort());
  for (const [op, schema] of Object.entries(ops)) {
    const names = GIT_PARAMS[op].flatMap((n) => (n === "*" ? SPREAD_KEYS[op] : [n]));
    assert.ok(names.every(Boolean), `${op}: spread keys listed`);
    assert.deepEqual([...names].sort(), Object.keys(schema.shape).sort(), op);
  }
});

test("namedArgs maps positions, spreads options and drops undefined", () => {
  assert.deepEqual(namedArgs("createBranch", ["feat", null, true]), { name: "feat", start: null, checkout: true });
  assert.deepEqual(namedArgs("merge", ["dev", { mode: "no-ff", message: undefined }]), { ref: "dev", mode: "no-ff" });
  assert.deepEqual(namedArgs("diffCommit", ["abc", "a.txt", undefined, false]), { hash: "abc", file: "a.txt", ignoreWs: false });
  assert.throws(() => namedArgs("runCustom", []), /not available/);
});

test("every RPC name is one Paseo accepts (lowercase, digits, . _ -)", async () => {
  const rpc = await import("../shared/rpc");
  const names = (Object.values(rpc) as unknown[])
    .filter((v: unknown): v is { name: string } => typeof v === "object" && v !== null && typeof (v as { name?: unknown }).name === "string")
    .map((v) => v.name);
  assert.ok(names.length >= 10);
  // WHY: the daemon refuses to load the whole plugin for one bad name (plugin-process.js, `^[a-z][a-z0-9._-]*$`).
  for (const n of names) assert.match(n, /^[a-z][a-z0-9._-]*$/, n);
});
