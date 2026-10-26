'use strict';
// Integration tests: every case runs against a real throwaway repository.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git: g } = require('../electron/core-node.gen.cjs');

let repo;
const write = (f, c) => {
  fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
  fs.writeFileSync(path.join(repo, f), c);
};
const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');
const sh = (...args) => g.git(repo, args);

beforeEach(async () => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitkrane-test-')));
  await g.init(repo, 'main');
  await sh('config', 'user.name', 'Test User');
  await sh('config', 'user.email', 'test@example.com');
  await sh('config', 'commit.gpgsign', 'false');
});

async function commitFile(f, content, msg) {
  write(f, content);
  await g.stage(repo, [f]);
  await g.commit(repo, msg);
}

test('empty repo: log, refs and status work before the first commit', async () => {
  assert.deepEqual(await g.log(repo), []);
  const refs = await g.refs(repo);
  assert.equal(refs.head, 'main');
  assert.equal(refs.headSha, null);
  write('a.txt', 'x\n');
  const st = await g.status(repo);
  assert.equal(st.unstaged[0].path, 'a.txt');
  assert.ok(st.unstaged[0].untracked);
  await g.stage(repo, ['a.txt']);
  await g.unstage(repo, ['a.txt']);
  assert.equal((await g.status(repo)).staged.length, 0);
});

test('commit, details and file list with numstat', async () => {
  await commitFile('a.txt', 'one\ntwo\n', 'first');
  await commitFile('a.txt', 'one\nTWO\nthree\n', 'second\n\nbody text');
  const log = await g.log(repo);
  assert.deepEqual(log.map((c) => c.subject), ['second', 'first']);
  const d = await g.commitDetails(repo, log[0].hash);
  assert.equal(d.message, 'second\n\nbody text');
  assert.deepEqual(d.files, [{ status: 'M', path: 'a.txt', additions: 2, deletions: 1 }]);
  const root = await g.commitDetails(repo, log[1].hash);
  assert.equal(root.files[0].status, 'A');
});

test('partial staging: applying a line-level patch to the index', async () => {
  await commitFile('f.txt', 'one\ntwo\nthree\nfour\n', 'base');
  write('f.txt', 'one\nTWO\nTHREE\nfour\n');
  const diff = await g.diffWorking(repo, 'f.txt', {});
  // Hand-built equivalent of buildPatch(selected = "-two", "+TWO").
  const header = diff.split('\n').filter((l) => /^(diff --git|---|\+\+\+)/.test(l));
  const patch = [...header, '@@ -1,4 +1,4 @@', ' one', '-two', '+TWO', ' three', ' four', ''].join('\n');
  await g.applyPatch(repo, patch, { cached: true });
  assert.equal(await g.showFile(repo, '', 'f.txt'), 'one\nTWO\nthree\nfour\n');
  assert.equal(read('f.txt'), 'one\nTWO\nTHREE\nfour\n', 'working tree untouched');
});

test('rename shows up in status and in commit files', async () => {
  await commitFile('old name.txt', 'content\n'.repeat(20), 'add');
  await sh('mv', 'old name.txt', 'new name.txt');
  const st = await g.status(repo);
  assert.deepEqual(st.staged[0], { path: 'new name.txt', oldPath: 'old name.txt', status: 'R' });
  await g.commit(repo, 'rename');
  const [head] = await g.log(repo);
  const d = await g.commitDetails(repo, head.hash);
  assert.equal(d.files[0].status, 'R');
  assert.equal(d.files[0].oldPath, 'old name.txt');
});

test('branches, refs, merge conflict, resolve and continue', async () => {
  await commitFile('c.txt', 'base\n', 'base');
  await g.createBranch(repo, 'feature', null, true);
  await commitFile('c.txt', 'feature\n', 'feature change');
  await g.checkout(repo, 'main');
  await commitFile('c.txt', 'main\n', 'main change');
  await assert.rejects(g.merge(repo, 'feature'));
  const state = await g.repoState(repo);
  assert.equal(state.state, 'merging');
  assert.equal(state.mergeHead, await g.revParse(repo, 'feature'));
  const st = await g.status(repo);
  assert.equal(st.conflicted[0].path, 'c.txt');
  const v = await g.conflictVersions(repo, 'c.txt');
  assert.equal(v.ours, 'main\n');
  assert.equal(v.theirs, 'feature\n');
  await g.resolveConflict(repo, 'c.txt', 'theirs');
  await g.continueOp(repo);
  assert.equal((await g.repoState(repo)).state, 'clean');
  const [merge] = await g.log(repo);
  assert.equal(merge.parents.length, 2);
  const refs = await g.refs(repo);
  assert.deepEqual(refs.local.map((b) => b.name).sort(), ['feature', 'main']);
});

test('abort restores a clean state', async () => {
  await commitFile('c.txt', 'base\n', 'base');
  await g.createBranch(repo, 'f', null, true);
  await commitFile('c.txt', 'f\n', 'f');
  await g.checkout(repo, 'main');
  await commitFile('c.txt', 'm\n', 'm');
  await assert.rejects(g.rebase(repo, 'f'));
  assert.equal((await g.repoState(repo)).state, 'rebasing');
  await g.abort(repo);
  assert.equal((await g.repoState(repo)).state, 'clean');
  assert.equal(read('c.txt'), 'm\n');
});

test('interactive rebase: reorder, reword, squash and drop without an editor', async () => {
  await commitFile('a', '1\n', 'base');
  const base = (await g.log(repo))[0].hash;
  await commitFile('b', '1\n', 'add b');
  await commitFile('c', '1\n', 'add c');
  await commitFile('d', '1\n', 'add d');
  await commitFile('e', '1\n', 'add e');
  const commits = await g.rebaseCommits(repo, base);
  assert.deepEqual(commits.map((c) => c.subject), ['add b', 'add c', 'add d', 'add e']);
  const [b, c, d, e] = commits;
  await g.interactiveRebase(repo, base, [
    { action: 'pick', hash: c.hash },
    { action: 'reword', hash: b.hash, message: 'B reworded' },
    { action: 'fixup', hash: d.hash },
    { action: 'drop', hash: e.hash },
  ]);
  const log = await g.log(repo);
  assert.deepEqual(log.map((x) => x.subject), ['B reworded', 'add c', 'base']);
  assert.ok(fs.existsSync(path.join(repo, 'd')), 'fixup content kept');
  assert.ok(!fs.existsSync(path.join(repo, 'e')), 'dropped commit removed');
});

test('stash save, files, apply and drop', async () => {
  await commitFile('a.txt', 'a\n', 'base');
  write('a.txt', 'changed\n');
  write('new.txt', 'untracked\n');
  await g.stashSave(repo, { message: 'my stash', includeUntracked: true });
  assert.equal(read('a.txt'), 'a\n');
  const [s] = await g.stashes(repo);
  assert.match(s.message, /my stash/);
  const files = await g.stashFiles(repo, s.hash);
  assert.deepEqual(files.map((f) => [f.path, !!f.untracked]).sort(), [['a.txt', false], ['new.txt', true]]);
  assert.match(await g.diffStash(repo, s.hash, 'a.txt'), /\+changed/);
  await g.stashApply(repo, 0, true);
  assert.equal(read('a.txt'), 'changed\n');
  assert.equal((await g.stashes(repo)).length, 0);
});

test('tags, cherry-pick, revert and reset', async () => {
  await commitFile('a', '1\n', 'one');
  await g.createTag(repo, 'v1', null, 'release 1');
  await g.createBranch(repo, 'side', null, true);
  await commitFile('s', '1\n', 'side work');
  const side = (await g.log(repo))[0].hash;
  await g.checkout(repo, 'main');
  // Diverge main first, otherwise the pick could reproduce the identical commit hash.
  await commitFile('m', '1\n', 'main work');
  await g.cherryPick(repo, side);
  assert.ok(fs.existsSync(path.join(repo, 's')));
  const picked = (await g.log(repo, {})).find((x) => x.subject === 'side work' && x.hash !== side);
  assert.ok(picked);
  await g.revert(repo, picked.hash);
  assert.ok(!fs.existsSync(path.join(repo, 's')));
  const refs = await g.refs(repo);
  assert.deepEqual(refs.tags.map((t) => [t.name, t.annotated]), [['v1', true]]);
  const v1 = await g.revParse(repo, 'v1^{commit}');
  assert.equal(refs.tags[0].target, v1, 'annotated tag resolves to its commit');
  await g.reset(repo, 'v1', 'hard');
  assert.equal(await g.revParse(repo, 'HEAD'), v1);
});

test('push, fetch and pull against a local bare remote', async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'gitkrane-bare-'));
  await g.git(bare, ['init', '--bare', '-b', 'main']);
  await commitFile('a', '1\n', 'one');
  await g.addRemote(repo, 'origin', bare);
  await g.push(repo, { remote: 'origin', branch: 'main', setUpstream: true }, () => {});
  let refs = await g.refs(repo);
  assert.equal(refs.local[0].upstream, 'origin/main');
  assert.deepEqual(refs.remote.map((r) => r.name), ['origin/main']);

  // A second clone pushes a commit; the first pulls it.
  const other = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gitkrane-other-')), 'o');
  await g.clone(bare, other, () => {});
  await g.git(other, ['-c', 'user.name=O', '-c', 'user.email=o@x', 'commit', '--allow-empty', '-m', 'remote work']);
  await g.git(other, ['push']);
  await g.fetch(repo, {}, () => {});
  refs = await g.refs(repo);
  assert.equal(refs.local[0].behind, 1);
  await g.pull(repo, { ffOnly: true }, () => {});
  assert.equal((await g.log(repo))[0].subject, 'remote work');

  await g.createBranch(repo, 'topic', null, false);
  await g.push(repo, { remote: 'origin', branch: 'topic' }, () => {});
  await g.deleteRemoteBranch(repo, 'origin', 'topic', () => {});
  await g.fetch(repo, {}, () => {});
  assert.ok(!(await g.refs(repo)).remote.some((r) => r.branch === 'topic'));
});

test('blame and file history', async () => {
  await commitFile('b.txt', 'l1\n', 'first');
  await commitFile('b.txt', 'l1\nl2\n', 'second');
  const bl = await g.blame(repo, 'b.txt');
  assert.deepEqual(bl.lines.map((l) => bl.meta[l.hash].summary), ['first', 'second']);
  const hist = await g.fileHistory(repo, 'b.txt');
  assert.deepEqual(hist.map((h) => h.subject), ['second', 'first']);
});

test('discard tracked and untracked changes', async () => {
  await commitFile('a', '1\n', 'one');
  write('a', '2\n');
  write('u', 'x\n');
  await g.discard(repo, [{ path: 'a' }, { path: 'u', untracked: true }]);
  assert.equal(read('a'), '1\n');
  assert.ok(!fs.existsSync(path.join(repo, 'u')));
});

// ---------------------------------------------------------------- Fork-style features

async function linear(n) {
  for (let i = 1; i <= n; i++) await commitFile(`f${i}`, `${i}\n`, `c${i}`);
  return (await g.log(repo)).map((c) => c.hash).reverse(); // oldest first
}
const subjects = async () => (await g.log(repo)).map((c) => c.subject);

test('rewriteHistory: reword a middle commit keeps the rest', async () => {
  const [, c2] = await linear(3);
  await g.rewriteHistory(repo, c2, 'reword', 'second, reworded');
  assert.deepEqual(await subjects(), ['c3', 'second, reworded', 'c1']);
});

test('rewriteHistory: reword the root commit', async () => {
  const [c1] = await linear(2);
  await g.rewriteHistory(repo, c1, 'reword', 'root reworded');
  assert.deepEqual(await subjects(), ['c2', 'root reworded']);
});

test('rewriteHistory: squash and fixup into parent', async () => {
  const [, , c3, c4] = await linear(4);
  await g.rewriteHistory(repo, c4, 'fixup');
  assert.deepEqual(await subjects(), ['c3', 'c2', 'c1']);
  assert.ok(fs.existsSync(path.join(repo, 'f4')), 'fixup keeps the content');
  const head = (await g.log(repo))[0].hash;
  assert.notEqual(head, c3);
  await g.rewriteHistory(repo, head, 'squash');
  const [top] = await g.log(repo);
  assert.equal(top.subject, 'c2');
  assert.match(await g.lastCommitMessage(repo), /c2[\s\S]*c3/, 'squash keeps both messages');
});

test('rewriteHistory: drop, move up and move down', async () => {
  const [, c2, , c4] = await linear(4);
  await g.rewriteHistory(repo, c2, 'drop');
  assert.deepEqual(await subjects(), ['c4', 'c3', 'c1']);
  assert.ok(!fs.existsSync(path.join(repo, 'f2')));
  const c3 = (await g.log(repo))[1].hash;
  await g.rewriteHistory(repo, c3, 'up');
  assert.deepEqual(await subjects(), ['c3', 'c4', 'c1']);
  const c4b = (await g.log(repo))[1].hash;
  assert.notEqual(c4b, c4);
  await g.rewriteHistory(repo, (await g.log(repo))[0].hash, 'down');
  assert.deepEqual(await subjects(), ['c4', 'c3', 'c1']);
});

test('rewriteHistory keeps uncommitted work (autostash)', async () => {
  const [, c2] = await linear(3);
  write('f1', 'local edit\n');
  await g.rewriteHistory(repo, c2, 'reword', 'x');
  assert.equal(read('f1'), 'local edit\n');
});

test('rewriteHistory refuses across a merge and off-branch commits', async () => {
  const [c1] = await linear(1);
  await g.createBranch(repo, 'side', null, true);
  await commitFile('s', '1\n', 'side');
  const side = (await g.log(repo))[0].hash;
  await g.checkout(repo, 'main');
  await commitFile('m', '1\n', 'main');
  await g.merge(repo, 'side', { mode: 'no-ff' });
  await commitFile('after', '1\n', 'after merge');
  await assert.rejects(g.rewriteHistory(repo, c1, 'reword', 'x'), /merge commit/);
  await g.checkout(repo, 'side');
  await commitFile('s2', '1\n', 'side 2');
  await g.checkout(repo, 'main');
  const side2 = (await g.log(repo)).find((c) => c.subject === 'side 2').hash;
  await assert.rejects(g.rewriteHistory(repo, side2, 'drop'), /not on the current branch/);
  assert.ok(side);
});

test('rangeFiles and diffRange compare two arbitrary commits', async () => {
  const [c1, , c3] = await linear(3);
  const files = await g.rangeFiles(repo, c1, c3);
  assert.deepEqual(files.map((f) => [f.path, f.status, f.additions]), [['f2', 'A', 1], ['f3', 'A', 1]]);
  assert.match(await g.diffRange(repo, c1, c3, 'f3'), /\+3/);
});

test('ignore-whitespace diff hides indentation-only changes', async () => {
  await commitFile('w.js', 'if (x) {\nfoo();\n}\n', 'w');
  write('w.js', 'if (x) {\n    foo();\n}\n');
  assert.match(await g.diffWorking(repo, 'w.js', {}), /\+    foo\(\);/);
  assert.equal(await g.diffWorking(repo, 'w.js', { ignoreWs: true }), '');
});

test('readBlob reads worktree, index and revisions; lsTree lists a commit', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
  fs.writeFileSync(path.join(repo, 'img.png'), png);
  await g.stage(repo, ['img.png']);
  await g.commit(repo, 'img');
  fs.writeFileSync(path.join(repo, 'img.png'), Buffer.from([9, 9]));
  const head = await g.readBlob(repo, 'HEAD', 'img.png');
  assert.deepEqual(Buffer.from(head.base64, 'base64'), png, 'binary content survives intact');
  assert.equal((await g.readBlob(repo, ':', 'img.png')).size, png.length);
  assert.equal((await g.readBlob(repo, null, 'img.png')).size, 2);
  assert.equal(await g.readBlob(repo, 'HEAD', 'missing.png'), null);
  write('dir/a.txt', 'a\n');
  await g.stage(repo, ['dir/a.txt']);
  await g.commit(repo, 'dir');
  assert.deepEqual(await g.lsTree(repo, 'HEAD'), ['dir/a.txt', 'img.png']);
});

test('repoSummary and scanRepos for the repository manager', async () => {
  await linear(1);
  write('dirty', 'x\n');
  const s = await g.repoSummary(repo);
  assert.deepEqual([s.branch, s.changes, s.ok], ['main', 1, true]);
  assert.equal((await g.repoSummary(path.join(repo, 'nope'))).ok, false);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitkrane-scan-')));
  for (const d of ['a', 'b/c', 'node_modules/x']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
    await g.init(path.join(root, d));
  }
  fs.mkdirSync(path.join(root, 'a', 'nested'));
  await g.init(path.join(root, 'a', 'nested'));
  assert.deepEqual((await g.scanRepos(root)).map((p) => path.relative(root, p)).sort(), ['a', path.join('b', 'c')]);
});

test('log is in date order so parallel branches interleave instead of keeping lanes open', async () => {
  // main and side alternate in time; topo order would print one whole line first.
  await commitFile('base', '1\n', 'base');
  await g.createBranch(repo, 'side', null, false);
  const at = (n) => ({ GIT_AUTHOR_DATE: `${1700000000 + n} +0000`, GIT_COMMITTER_DATE: `${1700000000 + n} +0000` });
  for (let i = 1; i <= 3; i++) {
    for (const b of ['main', 'side']) {
      await g.checkout(repo, b);
      write(`${b}${i}`, 'x\n');
      await g.stage(repo, [`${b}${i}`]);
      await g.git(repo, ['commit', '-q', '-m', `${b}${i}`], { env: at(i * 10 + (b === 'side' ? 5 : 0)) });
    }
  }
  const order = (await g.log(repo)).map((c) => c.subject).slice(0, 6);
  assert.deepEqual(order, ['side3', 'main3', 'side2', 'main2', 'side1', 'main1']);
});

test('conflictDiff3 rebuilds conflicts with the base, auto-merging the rest', async () => {
  await commitFile('c.txt', 'a\nb\nc\nd\ne\n', 'base');
  await g.createBranch(repo, 'f', null, true);
  await commitFile('c.txt', 'a\nB-theirs\nc\nd\nE-theirs\n', 'f');
  await g.checkout(repo, 'main');
  await commitFile('c.txt', 'A-ours\nB-ours\nc\nd\ne\n', 'm');
  await assert.rejects(g.merge(repo, 'f'));
  const out = await g.conflictDiff3(repo, 'c.txt');
  // Git groups the adjacent edits of lines 1–2 into one conflict that carries the base;
  // the separate, non-conflicting edit of line 5 is already merged in.
  assert.equal(
    out,
    '<<<<<<< ours\nA-ours\nB-ours\n||||||| base\na\nb\n=======\na\nB-theirs\n>>>>>>> theirs\nc\nd\nE-theirs\n',
  );
  await g.abort(repo);
  assert.equal((await g.repoState(repo)).state, 'clean');
  assert.equal(read('c.txt'), 'A-ours\nB-ours\nc\nd\ne\n', 'abort restores the pre-merge file');
});

test('conflictDiff3 returns null when one side deleted the file', async () => {
  await commitFile('d.txt', 'x\n', 'base');
  await g.createBranch(repo, 'f', null, true);
  await sh('rm', '-q', 'd.txt');
  await g.commit(repo, 'delete');
  await g.checkout(repo, 'main');
  await commitFile('d.txt', 'changed\n', 'modify');
  await assert.rejects(g.merge(repo, 'f'));
  assert.equal(await g.conflictDiff3(repo, 'd.txt'), null);
});

test('compare against the working tree and against a branch name', async () => {
  await commitFile('a', '1\n', 'one');
  await g.createBranch(repo, 'other', null, true);
  await commitFile('b', '1\n', 'two');
  await g.checkout(repo, 'main');
  write('a', 'edited\n');
  const wt = await g.rangeFiles(repo, 'HEAD', ':worktree');
  assert.deepEqual(wt.map((f) => [f.path, f.status]), [['a', 'M']]);
  assert.match(await g.diffRange(repo, 'HEAD', ':worktree', 'a'), /\+edited/);
  const br = await g.rangeFiles(repo, 'main', 'other');
  assert.deepEqual(br.map((f) => [f.path, f.status]), [['b', 'A']]);
});

test('undo a completed merge: reset --keep to the first parent keeps local edits', async () => {
  await commitFile('a', '1\n', 'base');
  await g.createBranch(repo, 'f', null, true);
  await commitFile('b', '1\n', 'feature');
  await g.checkout(repo, 'main');
  await commitFile('c', '1\n', 'main work');
  const before = await g.revParse(repo, 'HEAD');
  await g.merge(repo, 'f', { mode: 'no-ff' });
  const [merge] = await g.log(repo);
  assert.equal(merge.parents[0], before);
  write('c', 'uncommitted edit\n');
  await g.reset(repo, merge.parents[0], 'keep');
  assert.equal(await g.revParse(repo, 'HEAD'), before, 'branch is back to before the merge');
  assert.ok(!fs.existsSync(path.join(repo, 'b')), 'merged changes are gone from the branch');
  assert.equal(read('c'), 'uncommitted edit\n', 'uncommitted work survives');
  assert.ok(await g.revParse(repo, 'f'), 'the merged branch itself is untouched');
});

test('reset --keep refuses rather than overwrite a conflicting local edit', async () => {
  await commitFile('a', '1\n', 'base');
  const base = await g.revParse(repo, 'HEAD');
  await commitFile('a', '2\n', 'change a');
  write('a', 'local\n');
  await assert.rejects(g.reset(repo, base, 'keep'));
  assert.equal(read('a'), 'local\n');
});

test('compare works when a branch shares its name with a folder', async () => {
  // Reproduces "ambiguous argument 'test': both revision and filename".
  await commitFile('test/spec.txt', '1\n', 'add test folder');
  await g.createBranch(repo, 'test', null, true);
  await commitFile('test/spec.txt', '2\n', 'change on branch test');
  await g.checkout(repo, 'main');
  const files = await g.rangeFiles(repo, 'main', 'test');
  assert.deepEqual(files.map((f) => [f.path, f.status]), [['test/spec.txt', 'M']]);
  assert.match(await g.diffRange(repo, 'main', 'test', 'test/spec.txt'), /\+2/);
  assert.equal((await g.rangeFiles(repo, 'test', ':worktree')).length, 1);
  assert.equal((await g.rebaseCommits(repo, 'test')).length, 0);
});

test('checkout and reset accept a branch named like a folder', async () => {
  await commitFile('test/spec.txt', '1\n', 'base');
  await g.createBranch(repo, 'test', null, false);
  await commitFile('test/spec.txt', '2\n', 'main moves on');
  await g.checkout(repo, 'test');
  assert.equal((await g.refs(repo)).head, 'test');
  assert.equal(read('test/spec.txt'), '1\n');
  await g.checkout(repo, 'main');
  await g.reset(repo, 'test', 'keep');
  assert.equal(read('test/spec.txt'), '1\n');
});

test('rebasePreview counts rewritten, incoming and already-pushed commits', async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'gitkrane-bare-'));
  await g.git(bare, ['init', '--bare', '-b', 'main']);
  await commitFile('a', '1\n', 'base');
  await g.createBranch(repo, 'topic', null, true);
  await commitFile('t1', '1\n', 'topic 1');
  await g.addRemote(repo, 'origin', bare);
  await g.push(repo, { remote: 'origin', branch: 'topic', setUpstream: true }, () => {});
  await commitFile('t2', '1\n', 'topic 2 (local only)');
  await g.checkout(repo, 'main');
  await commitFile('m1', '1\n', 'main 1');
  await g.checkout(repo, 'topic');
  assert.deepEqual(await g.rebasePreview(repo, 'main'), { rewrite: 2, incoming: 1, pushed: 1, upstream: 'origin/topic' });
  // Already up to date with main's history: nothing to rewrite.
  await g.checkout(repo, 'main');
  assert.equal((await g.rebasePreview(repo, 'topic')).rewrite, 1);
});
