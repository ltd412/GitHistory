// T03 acceptance: nothing a client sends can reach outside the workspace's repository or run a shell.
// Runs against real git repositories in a temp directory.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runRead, runWrite } from "../server/dispatch";
import { GuardError, patchPaths } from "../server/guard";

const bases: string[] = [];
after(() => bases.forEach((b) => fs.rmSync(b, { recursive: true, force: true })));

function makeRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "githistory-guard-"));
  bases.push(base);
  const repo = path.join(base, "repo");
  fs.mkdirSync(repo);
  const g = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "T");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  g("add", "a.txt");
  g("commit", "-q", "-m", "first");
  return { base, repo, g };
}

const refused = (re: RegExp) => (e: unknown) => e instanceof GuardError && re.test(e.message);

test("writeWorkingFile ../../etc/x is refused and no file appears", async () => {
  const { base, repo } = makeRepo();
  await assert.rejects(runWrite(repo, "writeWorkingFile", { file: "../escape.txt", content: "x" }), refused(/outside/));
  await assert.rejects(runWrite(repo, "writeWorkingFile", { file: "../../etc/x", content: "x" }), refused(/outside/));
  assert.equal(fs.existsSync(path.join(base, "escape.txt")), false);
});

test("absolute paths and NUL bytes are refused", async () => {
  const { repo } = makeRepo();
  await assert.rejects(runRead(repo, "readWorkingFile", { file: "/etc/passwd" }), refused(/Absolute/));
  await assert.rejects(runRead(repo, "readWorkingFile", { file: "a\u0000b" }), GuardError);
});

test("reading through ../ is refused too (no file disclosure)", async () => {
  const { repo } = makeRepo();
  await assert.rejects(runRead(repo, "readWorkingFile", { file: "../../../../etc/hosts" }), refused(/outside/));
});

test(".git and anything under it is refused, any case, even via x/../", async () => {
  const { repo } = makeRepo();
  for (const file of [".git/config", ".git/hooks/pre-commit", ".GIT/config", "sub/../.git/config"])
    await assert.rejects(runWrite(repo, "writeWorkingFile", { file, content: "x" }), refused(/\.git/), file);
  await assert.rejects(runWrite(repo, "stage", { paths: ["a.txt", ".git"] }), refused(/\.git/));
});

/** Windows only allows symlinks with Developer Mode or admin rights; skip there instead of failing. */
function trySymlink(t: { skip(msg: string): void }, target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("symlinks not permitted on this machine");
      return false;
    }
    throw e;
  }
}

test("a symlink pointing outside the repo cannot be written or read through", async (t) => {
  const { base, repo } = makeRepo();
  const outside = path.join(base, "outside");
  fs.mkdirSync(outside);
  if (!trySymlink(t, outside, path.join(repo, "link"))) return;
  fs.writeFileSync(path.join(outside, "secret"), "s");
  fs.symlinkSync(path.join(outside, "secret"), path.join(repo, "file-link"));
  await assert.rejects(runWrite(repo, "writeWorkingFile", { file: "link/new.txt", content: "x" }), refused(/symlink/));
  await assert.rejects(runWrite(repo, "writeWorkingFile", { file: "file-link", content: "x" }), refused(/symlink/));
  await assert.rejects(runRead(repo, "readWorkingFile", { file: "link/secret" }), refused(/symlink/));
  assert.equal(fs.existsSync(path.join(outside, "new.txt")), false);
  assert.equal(fs.readFileSync(path.join(outside, "secret"), "utf8"), "s");
});

test("a symlink to .git is refused", async (t) => {
  const { repo } = makeRepo();
  if (!trySymlink(t, path.join(repo, ".git"), path.join(repo, "g"))) return;
  await assert.rejects(runWrite(repo, "writeWorkingFile", { file: "g/config", content: "x" }), refused(/\.git/));
});

const outsidePatch = (target: string) =>
  [`diff --git a/${target} b/${target}`, "new file mode 100644", "--- /dev/null", `+++ b/${target}`, "@@ -0,0 +1 @@", "+pwned", ""].join("\n");

test("applyPatch whose header leaves the repo is refused", async () => {
  const { base, repo } = makeRepo();
  await assert.rejects(runWrite(repo, "applyPatch", { patch: outsidePatch("../outside.txt") }), refused(/outside/));
  await assert.rejects(runWrite(repo, "applyPatch", { patch: outsidePatch(".git/hooks/post-commit") }), refused(/\.git/));
  assert.equal(fs.existsSync(path.join(base, "outside.txt")), false);
});

test("applyPatch: C-quoted escapes and rename lines are decoded before checking", async () => {
  assert.deepEqual(patchPaths('--- "a/..\\057x"\n'), ["../x"]);
  assert.deepEqual(patchPaths('diff --git "a/caf\\303\\251" "b/caf\\303\\251"\n'), ["café"]);
  const { repo } = makeRepo();
  const quoted = ['diff --git "a/..\\057o" "b/..\\057o"', "new file mode 100644", "--- /dev/null", '+++ "b/..\\057o"', "@@ -0,0 +1 @@", "+x", ""].join("\n");
  await assert.rejects(runWrite(repo, "applyPatch", { patch: quoted }), refused(/outside/));
  const rename = ["diff --git a/a.txt b/a.txt", "similarity index 100%", "rename from a.txt", "rename to ../moved.txt", ""].join("\n");
  await assert.rejects(runWrite(repo, "applyPatch", { patch: rename }), refused(/outside/));
  const spaced = ["diff --git a/x y b/../x y", "new file mode 100644", ""].join("\n");
  await assert.rejects(runWrite(repo, "applyPatch", { patch: spaced }), refused(/outside/));
});

test("a patch that names no file is refused", async () => {
  const { repo } = makeRepo();
  await assert.rejects(runWrite(repo, "applyPatch", { patch: "hello\n" }), refused(/no files/));
});

test("ops outside the allowlist are refused (runCustom, internal helpers, prototype keys)", async () => {
  const { repo } = makeRepo();
  for (const op of ["runCustom", "run", "git", "setConfig", "clone", "init", "scanRepos", "__proto__", "constructor", "toString"])
    await assert.rejects(runWrite(repo, op, {}), refused(/not allowed/), op);
  await assert.rejects(runRead(repo, "stage", { paths: ["a.txt"] }), refused(/not allowed/), "write op via read");
});

test("revisions starting with '-' are refused before git sees them", async () => {
  const { repo } = makeRepo();
  await assert.rejects(runWrite(repo, "checkout", { ref: "--orphan=x" }), refused(/must not start with '-'/));
  await assert.rejects(runWrite(repo, "fetch", { remote: "--upload-pack=touch /tmp/pwned" }), refused(/'-'/));
  await assert.rejects(runRead(repo, "revParse", { rev: "-h" }), GuardError);
});

test("remote URLs: ext::, file paths and option-looking hosts are refused; normal ones pass", async () => {
  const { repo, g } = makeRepo();
  for (const url of [
    "ext::sh -c touch% /tmp/pwned",
    "file:///etc",
    "/abs/path",
    "../sibling",
    "ssh://-oProxyCommand=touch /tmp/p/x",
    "ssh://user@-oProxyCommand=x/repo",
    "-oProxyCommand=x@host:repo",
    "https://host/repo\nx",
  ])
    await assert.rejects(runWrite(repo, "addRemote", { name: "evil", url }), GuardError, url);
  assert.equal(g("remote").trim(), "");
  for (const [name, url] of [["h", "https://github.com/a/b.git"], ["s", "git@github.com:a/b.git"], ["ss", "ssh://git@host:22/a/b.git"]])
    await runWrite(repo, "addRemote", { name, url });
  assert.deepEqual(g("remote").trim().split("\n").sort(), ["h", "s", "ss"]);
});

test("unknown fields are dropped and wrong types refused", async () => {
  const { repo } = makeRepo();
  await assert.rejects(runWrite(repo, "stage", { paths: "a.txt" }), refused(/Invalid arguments for stage/));
  await assert.rejects(runWrite(repo, "reset", { target: "HEAD", mode: "merge" }), GuardError);
});

test("valid operations inside the repo still work: write, stage, commit, read back", async () => {
  const { repo, g } = makeRepo();
  await runWrite(repo, "writeWorkingFile", { file: "dir/../b.txt", content: "two\n" });
  await runWrite(repo, "stage", { paths: ["b.txt"] });
  await runWrite(repo, "commit", { message: "second" });
  assert.equal(g("log", "-1", "--format=%s").trim(), "second");
  assert.equal(await runRead(repo, "readWorkingFile", { file: "b.txt" }), "two\n");
  const patch = ["diff --git a/a.txt b/a.txt", "--- a/a.txt", "+++ b/a.txt", "@@ -1 +1 @@", "-one", "+uno", ""].join("\n");
  await runWrite(repo, "applyPatch", { patch, cached: true });
  assert.match(g("diff", "--cached"), /\+uno/);
  const details = (await runRead(repo, "commitDetails", { hash: "HEAD" })) as { subject?: string };
  assert.ok(details);
});
