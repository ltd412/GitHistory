// Git service shared by the Electron app and the Paseo plugin server (Node only).
// Ported from electron/git.cjs (plans/261026-paseo-plugin T01): same behaviour; parameters are typed
// loosely where the original was untyped JavaScript.
// Git service: every operation shells out to the system `git` binary so behaviour
// matches the CLI exactly (hooks, config, credential helpers, signing).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FS = '\x1f';
const RS = '\x1e';

class GitError extends Error {
  code: number;
  constructor(args: string[], code: number, stderr: string, stdout: string | Buffer) {
    super((stderr || String(stdout) || `git ${args[0]} failed with code ${code}`).trim());
    this.code = code;
  }
}

function run(cwd?: any, args?: any, opts: any = {}): Promise<any> {
  const { input, env, onProgress, okCodes = [0], raw = false } = opts;
  return new Promise((resolve: any, reject: any) => {
    // WHY: GIT_TERMINAL_PROMPT=0 — a credential prompt on a TTY-less child would hang forever;
    // failing fast surfaces "authentication failed" to the UI instead.
    const child = spawn('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...env },
    });
    const out: any[] = [];
    const err: any[] = [];
    child.stdout.on('data', (d: any) => out.push(d));
    child.stderr.on('data', (d: any) => {
      err.push(d);
      if (onProgress) onProgress(d.toString());
    });
    child.on('error', reject);
    child.on('close', (code: any) => {
      const stdout = raw ? Buffer.concat(out) : Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (okCodes.includes(code)) resolve({ stdout, stderr, code });
      else reject(new GitError(args, code, stderr, stdout));
    });
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function git(cwd?: any, args?: any, opts?: any) {
  return (await run(cwd, args, opts)).stdout;
}

async function tryGit(cwd?: any, args?: any) {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- repository

async function isRepo(dir?: any) {
  const out = await tryGit(dir, ['rev-parse', '--show-toplevel']);
  return out ? out.trim() : null;
}

async function init(dir?: any, initialBranch?: any) {
  fs.mkdirSync(dir, { recursive: true });
  const args = ['init'];
  if (initialBranch) args.push('-b', initialBranch);
  await git(dir, args);
  return dir;
}

async function clone(url?: any, dir?: any, onProgress?: any) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await git(path.dirname(dir), ['clone', '--progress', url, dir], { onProgress });
  return dir;
}

async function hasHead(repo?: any) {
  return (await tryGit(repo, ['rev-parse', '--verify', '-q', 'HEAD'])) != null;
}

async function gitDir(repo?: any) {
  return (await git(repo, ['rev-parse', '--absolute-git-dir'])).trim();
}

async function repoState(repo?: any) {
  const dir = await gitDir(repo);
  const exists = (p: any) => fs.existsSync(path.join(dir, p));
  let state = 'clean';
  if (exists('rebase-merge') || exists('rebase-apply')) state = 'rebasing';
  else if (exists('MERGE_HEAD')) state = 'merging';
  else if (exists('CHERRY_PICK_HEAD')) state = 'cherry-picking';
  else if (exists('REVERT_HEAD')) state = 'reverting';
  let mergeMsg = '';
  if (exists('MERGE_MSG')) {
    mergeMsg = fs
      .readFileSync(path.join(dir, 'MERGE_MSG'), 'utf8')
      .split('\n')
      .filter((l: any) => !l.startsWith('#'))
      .join('\n')
      .trim();
  }
  // While merging, the pending commit has a second parent; the graph draws it on the WIP node.
  const mergeHead = exists('MERGE_HEAD') ? fs.readFileSync(path.join(dir, 'MERGE_HEAD'), 'utf8').split('\n')[0].trim() : null;
  return { state, mergeMsg, mergeHead, gitDir: dir };
}

// ---------------------------------------------------------------- history

const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s'].join('%x1f') + '%x1e';

function parseLog(out?: any) {
  return out
    .split(RS)
    .map((r: any) => r.replace(/^\n/, ''))
    .filter(Boolean)
    .map((r: any) => {
      const [hash, parents, author, email, time, subject] = r.split(FS);
      return {
        hash,
        parents: parents ? parents.split(' ') : [],
        author,
        email,
        time: Number(time),
        subject,
      };
    });
}

async function log(repo?: any, { limit = 2000, skip = 0 }: any = {}) {
  const refs = (await git(repo, ['for-each-ref', '--count=1', '--format=%(refname)'])).trim();
  const head = await hasHead(repo);
  if (!refs && !head) return [];
  const args = ['log', '--date-order', `--format=${LOG_FORMAT}`, `-n${limit}`, `--skip=${skip}`];
  args.push('--branches', '--remotes', '--tags');
  if (head) args.push('HEAD');
  args.push('--');
  return parseLog(await git(repo, args));
}

async function searchCommits(repo?: any, query?: any, limit: any = 500) {
  const args = ['log', '--all', `--format=${LOG_FORMAT}`, `-n${limit}`, '-i'];
  if (/^[0-9a-f]{4,40}$/i.test(query)) {
    const out = await tryGit(repo, ['rev-parse', '--verify', '-q', `${query}^{commit}`]);
    if (out) return parseLog(await git(repo, ['log', `--format=${LOG_FORMAT}`, '-n1', out.trim()]));
  }
  const byMsg = parseLog(await git(repo, [...args, `--grep=${query}`]));
  const byAuthor = parseLog(await git(repo, [...args, `--author=${query}`]));
  const seen = new Set();
  return [...byMsg, ...byAuthor].filter((c: any) => !seen.has(c.hash) && seen.add(c.hash));
}

async function fileHistory(repo?: any, file?: any, limit: any = 500) {
  return parseLog(
    await git(repo, ['log', '--follow', `--format=${LOG_FORMAT}`, `-n${limit}`, '--', file]),
  );
}

async function commitDetails(repo?: any, hash?: any) {
  const fmt = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B'].join('%x1f');
  const out = await git(repo, ['show', '-s', `--format=${fmt}`, hash]);
  const [h, parents, author, email, time, committer, cemail, ctime, body] = out.split(FS);
  const files = await commitFiles(repo, h, parents ? parents.split(' ') : []);
  return {
    hash: h,
    parents: parents ? parents.split(' ') : [],
    author,
    email,
    time: Number(time),
    committer,
    committerEmail: cemail,
    committerTime: Number(ctime),
    message: body.replace(/\n+$/, ''),
    files,
  };
}

function parseNameStatus(out?: any) {
  const parts = out.split('\0').filter((p: any) => p !== '');
  const files: any[] = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++];
    const status = code[0];
    if (status === 'R' || status === 'C') {
      const oldPath = parts[i++];
      files.push({ status, oldPath, path: parts[i++] });
    } else {
      files.push({ status, path: parts[i++] });
    }
  }
  return files;
}

async function commitFiles(repo?: any, hash?: any, parents?: any) {
  const args = parents.length
    ? ['diff', '--name-status', '-z', '-M', parents[0], hash, '--']
    : ['diff-tree', '--no-commit-id', '--name-status', '-z', '-r', '-M', '--root', hash];
  const files = parseNameStatus(await git(repo, args));
  const statArgs = parents.length
    ? ['diff', '--numstat', '-z', '-M', parents[0], hash, '--']
    : ['diff-tree', '--no-commit-id', '--numstat', '-z', '-r', '-M', '--root', hash];
  const stats = parseNumstat(await git(repo, statArgs));
  for (const f of files) Object.assign(f, stats[f.path] || {});
  return files;
}

function parseNumstat(out?: any) {
  const res: any = {};
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const [add, del, name] = p.split('\t');
    let file = name;
    // Renames in -z numstat: "add\tdel\t" followed by old\0new
    if (name === '') {
      i += 1;
      file = parts[++i];
    }
    res[file] = { additions: add === '-' ? null : Number(add), deletions: del === '-' ? null : Number(del) };
  }
  return res;
}

// ---------------------------------------------------------------- refs

async function refs(repo?: any) {
  const fmt = [
    '%(refname)',
    '%(objectname)',
    '%(*objectname)',
    '%(upstream:short)',
    '%(upstream:track,nobracket)',
    '%(HEAD)',
    '%(objecttype)',
  ].join('%1f');
  const out = await git(repo, ['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes', 'refs/tags']);
  const result: any = { local: [], remote: [], tags: [], head: null, headDetached: false };
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [ref, obj, peeled, upstream, track, isHead, type] = line.split(FS);
    const target = peeled || obj;
    if (ref.startsWith('refs/heads/')) {
      const name = ref.slice(11);
      const ahead: any = /ahead (\d+)/.exec(track);
      const behind: any = /behind (\d+)/.exec(track);
      const b = {
        name,
        target,
        upstream: upstream || null,
        upstreamGone: track === 'gone',
        ahead: ahead ? Number(ahead[1]) : 0,
        behind: behind ? Number(behind[1]) : 0,
        current: isHead === '*',
      };
      result.local.push(b);
      if (b.current) result.head = name;
    } else if (ref.startsWith('refs/remotes/')) {
      const name = ref.slice(13);
      if (name.endsWith('/HEAD')) continue;
      const slash = name.indexOf('/');
      result.remote.push({ name, remote: name.slice(0, slash), branch: name.slice(slash + 1), target });
    } else if (ref.startsWith('refs/tags/')) {
      result.tags.push({ name: ref.slice(10), target, annotated: type === 'tag' });
    }
  }
  const headSha = await tryGit(repo, ['rev-parse', '--verify', '-q', 'HEAD']);
  result.headSha = headSha ? headSha.trim() : null;
  if (!result.head) {
    if (result.headSha) result.headDetached = true;
    else {
      // Unborn branch: HEAD points to a ref with no commits yet.
      const sym = await tryGit(repo, ['symbolic-ref', '--short', '-q', 'HEAD']);
      result.head = sym ? sym.trim() : null;
    }
  }
  return result;
}

async function remotes(repo?: any) {
  const out = await git(repo, ['remote', '-v']);
  const map: any = {};
  for (const line of out.split('\n')) {
    const m: any = /^(\S+)\t(\S+) \((fetch|push)\)$/.exec(line);
    if (!m) continue;
    map[m[1]] = map[m[1]] || { name: m[1], fetchUrl: '', pushUrl: '' };
    map[m[1]][m[3] === 'fetch' ? 'fetchUrl' : 'pushUrl'] = m[2];
  }
  return Object.values(map);
}

async function stashes(repo?: any) {
  const out = await tryGit(repo, ['stash', 'list', `--format=%H${FS}%P${FS}%gd${FS}%gs${FS}%at`]);
  if (!out) return [];
  return out
    .split('\n')
    .filter(Boolean)
    .map((l: any) => {
      const [hash, parents, ref, message, time] = l.split(FS);
      const idx = Number(/\{(\d+)\}/.exec(ref)![1]);
      return { hash, base: parents.split(' ')[0], ref, index: idx, message, time: Number(time) };
    });
}

async function submodules(repo?: any) {
  const out = await tryGit(repo, ['submodule', 'status']);
  if (!out) return [];
  return out
    .split('\n')
    .filter(Boolean)
    .map((l: any) => {
      const m: any = /^([ +\-U])([0-9a-f]+) (\S+)/.exec(l);
      return m ? { state: m[1], hash: m[2], path: m[3] } : null;
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------- working tree

async function status(repo?: any) {
  const out = await git(repo, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']);
  const res: any = { branch: null, upstream: null, ahead: 0, behind: 0, staged: [], unstaged: [], conflicted: [] };
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith('# branch.head ')) res.branch = line.slice(14);
    else if (line.startsWith('# branch.upstream ')) res.upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) {
      const m: any = /\+(\d+) -(\d+)/.exec(line);
      res.ahead = Number(m[1]);
      res.behind = Number(m[2]);
    } else if (line[0] === '1' || line[0] === '2') {
      const fields = line.split(' ');
      const xy = fields[1];
      const isRename = line[0] === '2';
      const p = fields.slice(isRename ? 9 : 8).join(' ');
      const oldPath = isRename ? parts[++i] : undefined;
      if (xy[0] !== '.') res.staged.push({ path: p, oldPath, status: xy[0] });
      if (xy[1] !== '.') res.unstaged.push({ path: p, status: xy[1] });
    } else if (line[0] === 'u') {
      const fields = line.split(' ');
      res.conflicted.push({ path: fields.slice(10).join(' '), status: 'U', conflict: fields[1] });
    } else if (line[0] === '?') {
      res.unstaged.push({ path: line.slice(2), status: '?', untracked: true });
    }
  }
  return res;
}

async function stage(repo?: any, paths?: any) {
  await git(repo, ['add', '-A', '--', ...paths]);
}

async function stageAll(repo?: any) {
  await git(repo, ['add', '-A']);
}

async function unstage(repo?: any, paths?: any) {
  if (await hasHead(repo)) await git(repo, ['reset', '-q', 'HEAD', '--', ...paths]);
  else await git(repo, ['rm', '--cached', '-r', '-q', '--', ...paths]);
}

async function unstageAll(repo?: any) {
  if (await hasHead(repo)) await git(repo, ['reset', '-q']);
  else await tryGit(repo, ['rm', '--cached', '-r', '-q', '.']);
}

async function discard(repo?: any, files?: any) {
  const untracked = files.filter((f: any) => f.untracked).map((f: any) => f.path);
  const tracked = files.filter((f: any) => !f.untracked).map((f: any) => f.path);
  if (untracked.length) await git(repo, ['clean', '-f', '-q', '--', ...untracked]);
  if (tracked.length) await git(repo, ['checkout', '-q', '--', ...tracked]);
}

async function discardAll(repo?: any) {
  if (await hasHead(repo)) await git(repo, ['reset', '--hard', '-q']);
  await git(repo, ['clean', '-fd', '-q']);
}

async function applyPatch(repo?: any, patch?: any, { cached = false, reverse = false }: any = {}) {
  const args = ['apply', '--recount', '--whitespace=nowarn'];
  if (cached) args.push('--cached');
  if (reverse) args.push('-R');
  args.push('-');
  await git(repo, args, { input: patch });
}

// ---------------------------------------------------------------- diffs

const wsArgs = (ignoreWs: any) => (ignoreWs ? ['-w'] : []);
// Full-file context for the side-by-side viewer: one hunk spanning the whole file.
const ctxArgs = (full: any) => (full ? ['-U100000'] : []);

async function diffWorking(repo?: any, file?: any, { staged = false, untracked = false, ignoreWs = false, full = false }: any = {}) {
  if (untracked) {
    return git(repo, ['diff', '--no-color', '--no-index', ...ctxArgs(full), '--', '/dev/null', file], { okCodes: [0, 1] });
  }
  const args = ['diff', '--no-color', '-M', ...wsArgs(ignoreWs), ...ctxArgs(full)];
  if (staged) args.push('--cached');
  args.push('--', file);
  return git(repo, args);
}

async function diffCommit(repo?: any, hash?: any, file?: any, oldPath?: any, ignoreWs?: any, full?: any) {
  const parent = (await tryGit(repo, ['rev-parse', '--verify', '-q', `${hash}^1`]))?.trim();
  const paths = oldPath ? [oldPath, file] : [file];
  const extra = [...wsArgs(ignoreWs), ...ctxArgs(full)];
  if (!parent) return git(repo, ['diff-tree', '-p', '--no-color', '--root', '-M', ...extra, hash, '--', ...paths]);
  return git(repo, ['diff', '--no-color', '-M', ...extra, parent, hash, '--', ...paths]);
}

/** Compare target meaning "the working tree" (tracked files, staged or not). */
const WORKTREE = ':worktree';
const revArgs = (from: any, to: any) => (to === WORKTREE ? [from] : [from, to]);

/** Files changed between two arbitrary revisions, or a revision and the working tree (Compare view). */
async function rangeFiles(repo?: any, from?: any, to?: any) {
  // WHY: the trailing `--` marks everything before it as revisions; without it a branch that
  // shares its name with a file or folder (e.g. branch `test` next to a `test/` dir) fails as
  // "ambiguous argument".
  const files = parseNameStatus(await git(repo, ['diff', '--name-status', '-z', '-M', ...revArgs(from, to), '--']));
  const stats = parseNumstat(await git(repo, ['diff', '--numstat', '-z', '-M', ...revArgs(from, to), '--']));
  for (const f of files) Object.assign(f, stats[f.path] || {});
  return files;
}

async function diffRange(repo?: any, from?: any, to?: any, file?: any, oldPath?: any, ignoreWs?: any, full?: any) {
  const paths = oldPath ? [oldPath, file] : [file];
  return git(repo, ['diff', '--no-color', '-M', ...wsArgs(ignoreWs), ...ctxArgs(full), ...revArgs(from, to), '--', ...paths]);
}

/**
 * Re-creates a conflicted file from its three index stages with diff3 markers, so the merge
 * tool can show the common ancestor (base) next to ours and theirs — regardless of the user's
 * merge.conflictStyle. Null when a stage is missing (add/add, modify/delete).
 */
async function conflictDiff3(repo?: any, file?: any) {
  const stages = await Promise.all([1, 2, 3].map((n: any) => tryGit(repo, ['show', `:${n}:${file}`])));
  if (stages.some((x: any) => x == null)) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitkrane-merge-'));
  try {
    const [base, ours, theirs] = ['base', 'ours', 'theirs'].map((n: any, i: any) => {
      const f = path.join(tmp, n);
      fs.writeFileSync(f, stages[i]);
      return f;
    });
    // merge-file exits with the number of conflicts (capped at 127); only negative codes are errors.
    const okCodes = Array.from({ length: 128 }, (_: any, i: any) => i);
    return await git(tmp, ['merge-file', '-p', '--diff3', '-L', 'ours', '-L', 'base', '-L', 'theirs', ours, base, theirs], { okCodes });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Reads file content for previews (image diff, file viewer) as base64.
 * rev: a revision, ':' for the index, or null for the working tree. Missing → null.
 */
async function readBlob(repo?: any, rev?: any, file?: any) {
  const MAX = 20 * 1024 * 1024;
  try {
    let buf;
    if (rev == null) buf = fs.readFileSync(path.join(repo, file));
    else buf = await git(repo, ['show', rev === ':' ? `:${file}` : `${rev}:${file}`], { raw: true });
    if (buf.length > MAX) return { base64: null, size: buf.length, tooLarge: true };
    return { base64: buf.toString('base64'), size: buf.length, tooLarge: false };
  } catch {
    return null;
  }
}

/** All files in a revision's tree (Fork's "All files" view of a commit). */
async function lsTree(repo?: any, rev?: any) {
  const out = await git(repo, ['ls-tree', '-r', '-z', '--name-only', rev]);
  return out.split('\0').filter(Boolean);
}

async function showFile(repo?: any, rev?: any, file?: any) {
  return tryGit(repo, ['show', `${rev}:${file}`]);
}

async function readWorkingFile(repo?: any, file?: any) {
  return fs.readFileSync(path.join(repo, file), 'utf8');
}

async function writeWorkingFile(repo?: any, file?: any, content?: any) {
  fs.writeFileSync(path.join(repo, file), content);
}

async function restoreFile(repo?: any, rev?: any, file?: any) {
  await git(repo, ['checkout', rev, '--', file]);
}

async function blame(repo?: any, file?: any, rev?: any) {
  const args = ['blame', '--porcelain'];
  if (rev) args.push(rev);
  args.push('--', file);
  const out = await git(repo, args);
  const lines: any[] = [];
  const meta: any = {};
  const rows = out.split('\n');
  let cur: any = null;
  for (const row of rows) {
    const head: any = /^([0-9a-f]{40}) (\d+) (\d+)/.exec(row);
    if (head) {
      cur = head[1];
      meta[cur] = meta[cur] || { hash: cur };
    } else if (row.startsWith('\t')) {
      lines.push({ hash: cur, text: row.slice(1) });
    } else if (cur) {
      const sp = row.indexOf(' ');
      const key = row.slice(0, sp);
      const val = row.slice(sp + 1);
      if (key === 'author') meta[cur].author = val;
      else if (key === 'author-time') meta[cur].time = Number(val);
      else if (key === 'summary') meta[cur].summary = val;
    }
  }
  return { lines, meta };
}

// ---------------------------------------------------------------- commit

async function commit(repo?: any, message?: any, { amend = false }: any = {}) {
  const args = ['commit', '-F', '-'];
  if (amend) args.push('--amend');
  await git(repo, args, { input: message });
}

/** Full message of one commit (hover card in the graph fetches bodies lazily). */
async function commitMessage(repo?: any, hash?: any) {
  return (await git(repo, ['show', '-s', '--format=%B', hash])).replace(/\n+$/, '');
}

async function lastCommitMessage(repo?: any) {
  return (await git(repo, ['log', '-1', '--format=%B'])).replace(/\n+$/, '');
}

// ---------------------------------------------------------------- branches

async function checkout(repo?: any, ref?: any) {
  // `--` keeps a branch named like a file/folder from being read as a path to restore.
  await git(repo, ['checkout', '-q', ref, '--']);
}

async function checkoutRemote(repo?: any, remoteBranch?: any, localName?: any) {
  await git(repo, ['checkout', '-q', '-b', localName, '--track', remoteBranch]);
}

async function createBranch(repo?: any, name?: any, start?: any, doCheckout?: any) {
  if (doCheckout) await git(repo, ['checkout', '-q', '-b', name, ...(start ? [start] : [])]);
  else await git(repo, ['branch', name, ...(start ? [start] : [])]);
}

async function deleteBranch(repo?: any, name?: any, force?: any) {
  await git(repo, ['branch', force ? '-D' : '-d', name]);
}

async function renameBranch(repo?: any, oldName?: any, newName?: any) {
  await git(repo, ['branch', '-m', oldName, newName]);
}

async function setUpstream(repo?: any, branch?: any, upstream?: any) {
  if (upstream) await git(repo, ['branch', `--set-upstream-to=${upstream}`, branch]);
  else await git(repo, ['branch', '--unset-upstream', branch]);
}

async function deleteRemoteBranch(repo?: any, remote?: any, branch?: any, onProgress?: any) {
  await git(repo, ['push', '--progress', remote, '--delete', branch], { onProgress });
}

async function fastForward(repo?: any, branch?: any, target?: any) {
  // Moves a non-checked-out branch; refuses non-fast-forward like `git fetch . src:dst`.
  await git(repo, ['fetch', '.', `${target}:refs/heads/${branch}`]);
}

// ---------------------------------------------------------------- integrate

async function merge(repo?: any, ref?: any, { mode = 'default', message }: any = {}) {
  const args = ['merge', '--no-edit'];
  if (mode === 'ff-only') args.push('--ff-only');
  if (mode === 'no-ff') args.push('--no-ff');
  if (mode === 'squash') args.push('--squash');
  if (message) args.push('-m', message);
  args.push(ref);
  await git(repo, args);
}

/**
 * What `rebase onto` would do, for the confirmation dialog:
 * rewrite  — commits of HEAD not in `onto` (they get new hashes),
 * incoming — commits of `onto` not in HEAD,
 * pushed   — how many of the rewritten ones the upstream already has (a force push would follow).
 */
async function rebasePreview(repo?: any, onto?: any) {
  const count = async (...revs: string[]) => Number((await git(repo, ['rev-list', '--count', ...revs, '--'])).trim());
  const rewrite = await count(`${onto}..HEAD`);
  const incoming = await count(`HEAD..${onto}`);
  const upstream = (await tryGit(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']))?.trim() || null;
  let pushed = 0;
  if (upstream && rewrite) {
    const base = (await tryGit(repo, ['merge-base', 'HEAD', upstream]))?.trim();
    if (base) pushed = await count(base, `^${onto}`);
  }
  return { rewrite, incoming, pushed, upstream };
}

async function rebase(repo?: any, onto?: any) {
  await git(repo, ['rebase', onto], { env: { GIT_EDITOR: 'true' } });
}

async function interactiveRebase(repo?: any, base?: any, steps?: any) {
  // WHY: `git rebase -i` opens $GIT_SEQUENCE_EDITOR on the todo file; copying our pre-built
  // todo over it gives a non-interactive, fully-specified rebase. Reword is expressed as an
  // `exec git commit --amend -F <file>` right after the pick so no editor is ever needed.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitkrane-rebase-'));
  const todo: any[] = [];
  steps.forEach((s: any, i: any) => {
    if (s.action === 'drop') return;
    const action = s.action === 'reword' ? 'pick' : s.action;
    todo.push(`${action} ${s.hash}`);
    if (s.action === 'reword') {
      const msgFile = path.join(tmp, `msg-${i}.txt`);
      fs.writeFileSync(msgFile, s.message);
      todo.push(`exec git commit --amend --allow-empty -q -F ${JSON.stringify(msgFile)}`);
    }
  });
  const todoFile = path.join(tmp, 'todo');
  fs.writeFileSync(todoFile, todo.join('\n') + '\n');
  const editor = `cp ${JSON.stringify(todoFile)}`;
  const args = ['rebase', '-i', '--autostash'];
  args.push(base || '--root');
  await git(repo, args, { env: { GIT_SEQUENCE_EDITOR: editor, GIT_EDITOR: 'true' } });
  // Removed only on success: a rebase stopped on a conflict still needs the reword message files.
  fs.rmSync(tmp, { recursive: true, force: true });
}

/**
 * Rewrites one commit of the current branch in place (Fork-style quick history edits):
 * reword, squash/fixup into its parent, drop, or move one step up/down.
 * Expressed as a fully specified interactive rebase starting just below the affected commits.
 */
async function rewriteHistory(repo?: any, hash?: any, op?: any, message?: any) {
  hash = (await git(repo, ['rev-parse', '--verify', `${hash}^{commit}`])).trim();
  if (!(await isAncestor(repo, hash, 'HEAD'))) throw new Error('This commit is not on the current branch.');
  // Squash, fixup and move-down also rewrite the parent, so the rebase starts one level lower.
  const deeper = op === 'squash' || op === 'fixup' || op === 'down';
  const target = deeper ? `${hash}^` : hash;
  const base = await revParse(repo, `${target}^`);
  if (deeper && !(await revParse(repo, `${hash}^`))) throw new Error('The first commit has no parent to combine with.');
  const range = base ? `${base}..HEAD` : 'HEAD';
  // WHY: `rebase -i` without --rebase-merges silently linearizes merges in the range; refusing
  // keeps a quick edit from rewriting history shape the user did not ask to change.
  if ((await git(repo, ['rev-list', '--merges', range])).trim()) {
    throw new Error('A merge commit lies between this commit and HEAD. Use interactive rebase instead.');
  }
  const steps = (await rebaseCommits(repo, base)).map((c: any) => ({ action: 'pick', hash: c.hash, message: c.subject }));
  const i = steps.findIndex((s: any) => s.hash === hash);
  if (i === -1) throw new Error('Commit not found in the rebase range.');
  if (op === 'reword') Object.assign(steps[i], { action: 'reword', message });
  else if (op === 'squash' || op === 'fixup' || op === 'drop') steps[i].action = op;
  else if (op === 'up') {
    if (i === steps.length - 1) throw new Error('This is already the newest commit.');
    [steps[i], steps[i + 1]] = [steps[i + 1], steps[i]];
  } else if (op === 'down') [steps[i], steps[i - 1]] = [steps[i - 1], steps[i]];
  else throw new Error(`Unknown history operation: ${op}`);
  await interactiveRebase(repo, base, steps);
}

async function cherryPick(repo?: any, hash?: any) {
  const parents = (await git(repo, ['show', '-s', '--format=%P', hash])).trim().split(' ');
  const args = ['cherry-pick'];
  if (parents.length > 1) args.push('-m', '1');
  args.push(hash);
  await git(repo, args);
}

async function revert(repo?: any, hash?: any) {
  const parents = (await git(repo, ['show', '-s', '--format=%P', hash])).trim().split(' ');
  const args = ['revert', '--no-edit'];
  if (parents.length > 1) args.push('-m', '1');
  args.push(hash);
  await git(repo, args);
}

async function reset(repo?: any, target?: any, mode: any = 'mixed') {
  await git(repo, ['reset', `--${mode}`, '-q', target, '--']);
}

async function abort(repo?: any) {
  const { state } = await repoState(repo);
  const cmd = { merging: 'merge', rebasing: 'rebase', 'cherry-picking': 'cherry-pick', reverting: 'revert' }[state];
  if (cmd) await git(repo, [cmd, '--abort']);
}

async function continueOp(repo?: any) {
  const { state } = await repoState(repo);
  const env = { GIT_EDITOR: 'true' };
  if (state === 'merging') await git(repo, ['commit', '--no-edit'], { env });
  else if (state === 'rebasing') await git(repo, ['rebase', '--continue'], { env });
  else if (state === 'cherry-picking') await git(repo, ['cherry-pick', '--continue'], { env });
  else if (state === 'reverting') await git(repo, ['revert', '--continue'], { env });
}

async function skipRebase(repo?: any) {
  await git(repo, ['rebase', '--skip']);
}

async function resolveConflict(repo?: any, file?: any, side?: any) {
  if (side === 'ours' || side === 'theirs') await git(repo, ['checkout', `--${side}`, '--', file]);
  await git(repo, ['add', '--', file]);
}

async function conflictVersions(repo?: any, file?: any) {
  const [base, ours, theirs] = await Promise.all([
    tryGit(repo, ['show', `:1:${file}`]),
    tryGit(repo, ['show', `:2:${file}`]),
    tryGit(repo, ['show', `:3:${file}`]),
  ]);
  let working = '';
  try {
    working = fs.readFileSync(path.join(repo, file), 'utf8');
  } catch {
    /* deleted on one side */
  }
  return { base, ours, theirs, working };
}

// ---------------------------------------------------------------- remotes

async function fetch(repo?: any, { remote, prune = true }: any = {}, onProgress?: any) {
  const args = ['fetch', '--progress'];
  if (prune) args.push('--prune');
  if (remote) args.push(remote);
  else args.push('--all');
  await git(repo, args, { onProgress });
}

async function pull(repo?: any, { rebase: useRebase = false, ffOnly = false }: any = {}, onProgress?: any) {
  const args = ['pull', '--progress'];
  if (ffOnly) args.push('--ff-only');
  else args.push(useRebase ? '--rebase' : '--no-rebase');
  await git(repo, args, { onProgress, env: { GIT_EDITOR: 'true' } });
}

async function push(repo?: any, { remote, branch, force = false, setUpstream: su = false, tags = false }: any = {}, onProgress?: any) {
  const args = ['push', '--progress'];
  if (force) args.push('--force-with-lease');
  if (su) args.push('-u');
  if (tags) args.push('--tags');
  if (remote) args.push(remote);
  if (branch) args.push(branch);
  await git(repo, args, { onProgress });
}

async function addRemote(repo?: any, name?: any, url?: any) {
  await git(repo, ['remote', 'add', name, url]);
}

async function removeRemote(repo?: any, name?: any) {
  await git(repo, ['remote', 'remove', name]);
}

async function renameRemote(repo?: any, oldName?: any, newName?: any) {
  await git(repo, ['remote', 'rename', oldName, newName]);
}

async function setRemoteUrl(repo?: any, name?: any, url?: any) {
  await git(repo, ['remote', 'set-url', name, url]);
}

// ---------------------------------------------------------------- stash

async function stashSave(repo?: any, { message, includeUntracked = true, keepIndex = false }: any = {}) {
  const args = ['stash', 'push'];
  if (includeUntracked) args.push('-u');
  if (keepIndex) args.push('--keep-index');
  if (message) args.push('-m', message);
  await git(repo, args);
}

async function stashApply(repo?: any, index?: any, pop?: any) {
  await git(repo, ['stash', pop ? 'pop' : 'apply', `stash@{${index}}`]);
}

async function stashDrop(repo?: any, index?: any) {
  await git(repo, ['stash', 'drop', `stash@{${index}}`]);
}

async function stashFiles(repo?: any, hash?: any) {
  const files = parseNameStatus(await git(repo, ['diff', '--name-status', '-z', '-M', `${hash}^1`, hash]));
  // Untracked files are stored in the stash's third parent.
  const u = await tryGit(repo, ['diff-tree', '--no-commit-id', '--name-status', '-z', '-r', '--root', `${hash}^3`]);
  if (u) files.push(...parseNameStatus(u).map((f: any) => ({ ...f, untracked: true })));
  return files;
}

async function diffStash(repo?: any, hash?: any, file?: any, untracked?: any, ignoreWs?: any, full?: any) {
  if (untracked) return git(repo, ['diff-tree', '-p', '--no-color', '--root', ...ctxArgs(full), `${hash}^3`, '--', file]);
  return git(repo, ['diff', '--no-color', '-M', ...wsArgs(ignoreWs), ...ctxArgs(full), `${hash}^1`, hash, '--', file]);
}

// ---------------------------------------------------------------- tags

async function createTag(repo?: any, name?: any, target?: any, message?: any) {
  const args = ['tag'];
  if (message) args.push('-a', name, '-m', message);
  else args.push(name);
  if (target) args.push(target);
  await git(repo, args);
}

async function deleteTag(repo?: any, name?: any) {
  await git(repo, ['tag', '-d', name]);
}

async function pushTag(repo?: any, remote?: any, name?: any, onProgress?: any) {
  await git(repo, ['push', '--progress', remote, `refs/tags/${name}`], { onProgress });
}

async function deleteRemoteTag(repo?: any, remote?: any, name?: any, onProgress?: any) {
  await git(repo, ['push', '--progress', remote, `:refs/tags/${name}`], { onProgress });
}

// ---------------------------------------------------------------- config

async function getConfig(repo?: any) {
  const read = async (scope: any, key: any) => {
    const args = ['config'];
    if (scope) args.push(`--${scope}`);
    args.push('--get', key);
    return ((await tryGit(repo || os.homedir(), args)) || '').trim();
  };
  return {
    globalName: await read('global', 'user.name'),
    globalEmail: await read('global', 'user.email'),
    localName: repo ? await read('local', 'user.name') : '',
    localEmail: repo ? await read('local', 'user.email') : '',
  };
}

async function setConfig(repo?: any, scope?: any, key?: any, value?: any) {
  const cwd = repo || os.homedir();
  if (value) await git(cwd, ['config', `--${scope}`, key, value]);
  else await tryGit(cwd, ['config', `--${scope}`, '--unset', key]);
}

async function revParse(repo?: any, rev?: any) {
  return (await tryGit(repo, ['rev-parse', '--verify', '-q', rev]))?.trim() || null;
}

async function isAncestor(repo?: any, a?: any, b?: any) {
  try {
    await git(repo, ['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch {
    return false;
  }
}

async function rebaseCommits(repo?: any, base?: any) {
  // Commits that an interactive rebase onto `base` would replay, oldest first.
  const range = base ? `${base}..HEAD` : 'HEAD';
  return parseLog(await git(repo, ['log', '--reverse', '--no-merges', `--format=${LOG_FORMAT}`, range, '--']));
}

// ---------------------------------------------------------------- repository manager

/** Branch, ahead/behind and change count for one repository, for the repository manager. */
async function repoSummary(dir?: any) {
  try {
    const out = await git(dir, ['status', '--porcelain=v2', '--branch', '-z']);
    const res: any = { path: dir, branch: null, ahead: 0, behind: 0, changes: 0, ok: true };
    for (const line of out.split('\0')) {
      if (line.startsWith('# branch.head ')) res.branch = line.slice(14);
      else if (line.startsWith('# branch.ab ')) {
        const m: any = /\+(\d+) -(\d+)/.exec(line);
        res.ahead = Number(m[1]);
        res.behind = Number(m[2]);
      } else if (line && !line.startsWith('#') && /^[12u?] /.test(line)) res.changes++;
    }
    return res;
  } catch {
    return { path: dir, branch: null, ahead: 0, behind: 0, changes: 0, ok: false };
  }
}

const SKIP_DIRS = new Set(['node_modules', '.venv', 'venv', 'vendor', 'Pods', 'build', 'dist', 'target', 'Library']);

/** Finds repositories under `root` (not descending into a repo once found). */
async function scanRepos(root?: any, maxDepth: any = 4) {
  const found: any[] = [];
  const walk = (dir: any, depth: any) => {
    if (found.length >= 500) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e: any) => e.name === '.git')) {
      found.push(dir);
      return;
    }
    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

export {
  rewriteHistory,
  rangeFiles,
  rebasePreview,
  conflictDiff3,
  diffRange,
  readBlob,
  lsTree,
  repoSummary,
  scanRepos,
  run,
  git,
  isRepo,
  init,
  clone,
  repoState,
  log,
  searchCommits,
  fileHistory,
  commitDetails,
  refs,
  remotes,
  stashes,
  submodules,
  status,
  stage,
  stageAll,
  unstage,
  unstageAll,
  discard,
  discardAll,
  applyPatch,
  diffWorking,
  diffCommit,
  showFile,
  readWorkingFile,
  writeWorkingFile,
  blame,
  restoreFile,
  commit,
  lastCommitMessage,
  commitMessage,
  checkout,
  checkoutRemote,
  createBranch,
  deleteBranch,
  renameBranch,
  setUpstream,
  deleteRemoteBranch,
  fastForward,
  merge,
  rebase,
  interactiveRebase,
  rebaseCommits,
  cherryPick,
  revert,
  reset,
  abort,
  continueOp,
  skipRebase,
  resolveConflict,
  conflictVersions,
  fetch,
  pull,
  push,
  addRemote,
  removeRemote,
  renameRemote,
  setRemoteUrl,
  stashSave,
  stashApply,
  stashDrop,
  stashFiles,
  diffStash,
  createTag,
  deleteTag,
  pushTag,
  deleteRemoteTag,
  getConfig,
  setConfig,
  revParse,
  isAncestor,
};
