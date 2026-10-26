// GENERATED from core/actions.ts by scripts/sync-core.mjs — do not edit; change core/actions.ts and run `npm run sync-core`.
// Every repository action of the UI (checkout, merge with its strategy dialog, smart rebase confirm, push
// with force-on-reject, undo merge, history edits…), moved from src/components/RepoView.tsx so the desktop
// app and the Paseo plugin behave the same. Git, dialogs and UI state are passed in.
import type { DialogApi } from './dialogs.ts';
import type { GitClient } from './git-client.ts';
import type { Actions, RepoData } from './menus.ts';
import { WORKTREE, type CenterView, type LocalBranch, type Selection, type Settings } from './types.ts';

export interface RefPickRequest {
  title: string;
  onPick: (ref: string) => void;
  worktree: boolean;
  exclude?: string;
  kind?: 'all' | 'branches' | 'revisions';
}

export interface CommandOutput {
  name: string;
  code: number;
  stdout: string;
  stderr: string;
  command: string;
}

export interface ActionDeps {
  repo: string;
  data: RepoData;
  git: GitClient;
  ui: DialogApi;
  app: {
    undo: (repo: string) => Promise<string | null>;
    redo: (repo: string) => Promise<string | null>;
    copy: (text: string) => Promise<unknown> | void;
    runCustom: (cwd: string, command: string, vars: Record<string, string | null>) => Promise<Omit<CommandOutput, 'name'>>;
  };
  errorMessage: (e: unknown) => string;
  pullMode: Settings['pullMode'];
  wipCount: number;
  selection: Selection;
  centerKind: CenterView['kind'];
  refresh: Actions['refresh'];
  run: Actions['run'];
  loadMore: () => void;
  setSelection: (s: Selection) => void;
  setCenter: (v: CenterView) => void;
  setRebaseBase: (base: string | null) => void;
  setRefPick: (p: RefPickRequest) => void;
  setBusy: (label: string | null) => void;
  setCmdOutput: (o: CommandOutput) => void;
}

export function createActions(d: ActionDeps): Actions {
  const { repo, data, git, ui, run, refresh, errorMessage, wipCount } = d;
  const head = () => data.refs.head;
  const currentBranch = () => data.refs.local.find((b) => b.current);
  const a: Actions = {
    refresh,
    run,
    loadMore: d.loadMore,
    checkout: (ref) => void run(`Checkout ${ref}`, () => git.checkout(repo, ref)),
    checkoutRemote: (rb) => {
      const existing = data.refs.local.find((b) => b.name === rb.branch);
      if (existing) {
        void run(`Checkout ${rb.branch}`, async () => {
          await git.checkout(repo, rb.branch);
          if (existing.target !== rb.target) {
            // Same-named local branch exists: bring it up to the remote when that is a fast-forward.
            if (await git.isAncestor(repo, existing.target, rb.target)) await git.merge(repo, rb.name, { mode: 'ff-only' });
          }
        });
        return;
      }
      void run(`Checkout ${rb.name}`, () => git.checkoutRemote(repo, rb.name, rb.branch));
    },
    createBranch: async (start) => {
      const v = await ui.form({
        title: 'Create branch',
        message: start ? `Starting at ${start.length === 40 ? start.slice(0, 7) : start}` : `Starting at ${head() ?? 'HEAD'}`,
        fields: [
          { name: 'name', label: 'Branch name', placeholder: 'feature/my-branch' },
          { name: 'checkout', label: 'Check out after creating', type: 'checkbox', value: true },
        ],
        confirm: 'Create branch',
      });
      if (!v?.name?.trim()) return;
      void run('Create branch', () => git.createBranch(repo, v.name.trim(), start ?? null, v.checkout));
    },
    deleteBranch: async (b) => {
      const merged = data.refs.headSha ? await git.isAncestor(repo, b.target, data.refs.headSha) : false;
      const ok = await ui.confirm(
        `Delete branch ${b.name}?`,
        merged ? 'This branch is merged into HEAD.' : 'This branch is NOT fully merged into HEAD. Its commits may become unreachable.',
        { danger: true, confirm: 'Delete' },
      );
      if (ok) void run(`Delete ${b.name}`, () => git.deleteBranch(repo, b.name, true));
    },
    renameBranch: async (b) => {
      const v = await ui.form({ title: `Rename ${b.name}`, fields: [{ name: 'name', label: 'New name', value: b.name }], confirm: 'Rename' });
      if (v?.name && v.name !== b.name) void run('Rename branch', () => git.renameBranch(repo, b.name, v.name.trim()));
    },
    setUpstream: async (b) => {
      const options = [{ value: '', label: '(none)' }, ...data.refs.remote.map((r) => ({ value: r.name, label: r.name }))];
      const v = await ui.form({
        title: `Set upstream for ${b.name}`,
        fields: [{ name: 'up', label: 'Upstream branch', type: 'select', options, value: b.upstream ?? '' }],
      });
      if (v) void run('Set upstream', () => git.setUpstream(repo, b.name, v.up || null));
    },
    deleteRemoteBranch: async (rb) => {
      const ok = await ui.confirm(`Delete ${rb.name}?`, `This deletes the branch "${rb.branch}" on remote "${rb.remote}".`, {
        danger: true,
        confirm: 'Delete from remote',
      });
      if (ok) void run(`Delete ${rb.name}`, () => git.deleteRemoteBranch(repo, rb.remote, rb.branch));
    },
    fastForward: (b, target) => void run(`Fast-forward ${b.name}`, () => git.fastForward(repo, b.name, target)),
    merge: async (ref) => {
      const v = await ui.form({
        title: `Merge ${ref} into ${head()}`,
        fields: [
          {
            name: 'mode',
            label: 'Strategy',
            type: 'radio',
            value: 'default',
            options: [
              { value: 'default', label: 'Fast-forward if possible', description: 'Just move the branch when it can; otherwise create a merge commit (git default).' },
              { value: 'no-ff', label: 'Always create a merge commit', description: 'Keeps the merged branch visible in history (--no-ff).' },
              { value: 'ff-only', label: 'Fast-forward only', description: 'Refuse if a merge commit would be needed (--ff-only).' },
              { value: 'squash', label: 'Squash', description: 'Stage all changes as one set, without committing — you write the commit (--squash).' },
            ],
          },
        ],
        confirm: 'Merge',
      });
      if (v) void run(`Merge ${ref}`, () => git.merge(repo, ref, { mode: v.mode }), { success: `Merged ${ref} — ⌘Z to undo` });
    },
    rebase: async (ref) => {
      let p: Awaited<ReturnType<typeof git.rebasePreview>>;
      try {
        p = await git.rebasePreview(repo, ref);
      } catch (e) {
        return ui.toast('error', 'Rebase failed', errorMessage(e));
      }
      const branch = head() ?? 'HEAD';
      if (p.incoming === 0) return ui.toast('info', `${branch} already contains ${ref}`, 'Nothing to rebase.');
      // Nothing of ours gets rewritten: the rebase is a plain fast-forward, no need to ask.
      if (p.rewrite === 0) return void run(`Rebase onto ${ref}`, () => git.rebase(repo, ref), { success: `${branch} fast-forwarded to ${ref}` });
      const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
      const lines = [
        `${plural(p.rewrite, 'commit')} on ${branch} will be rewritten (new hashes) and replayed on top of ${plural(p.incoming, 'commit')} from ${ref}.`,
      ];
      if (p.pushed > 0)
        lines.push(
          '',
          `⚠ ${p.pushed} of these commits ${p.pushed === 1 ? 'is' : 'are'} already on ${p.upstream}. After the rebase you will have to force push, which rewrites history for anyone else using ${p.upstream}.`,
        );
      const v = await ui.form({
        title: `Rebase ${branch} onto ${ref}?`,
        message: lines.join('\n'),
        fields: [
          {
            name: 'how',
            label: 'What to do',
            type: 'radio',
            // Already-pushed work defaults to the safe choice.
            value: p.pushed > 0 ? 'merge' : 'rebase',
            options: [
              { value: 'rebase', label: `Rebase ${branch} onto ${ref}`, description: 'Linear history; rewrites the commits listed above.' },
              { value: 'merge', label: `Merge ${ref} into ${branch} instead`, description: 'Keeps existing commits as they are; adds a merge commit if needed.' },
            ],
          },
        ],
        danger: p.pushed > 0,
        confirm: 'Continue',
      });
      if (!v) return;
      if (v.how === 'merge') void run(`Merge ${ref}`, () => git.merge(repo, ref), { success: `Merged ${ref} — ⌘Z to undo` });
      else void run(`Rebase onto ${ref}`, () => git.rebase(repo, ref), { success: `Rebased ${branch} onto ${ref} — ⌘Z to undo` });
    },
    interactiveRebase: (base) => d.setRebaseBase(base),
    cherryPick: (hash) => void run('Cherry pick', () => git.cherryPick(repo, hash)),
    revert: (hash) => void run('Revert', () => git.revert(repo, hash)),
    reset: async (hash, mode) => {
      if (mode === 'hard') {
        const ok = await ui.confirm('Hard reset?', 'All uncommitted changes will be lost. This cannot be undone.', {
          danger: true,
          confirm: 'Reset hard',
        });
        if (!ok) return;
      }
      void run(`Reset ${mode}`, () => git.reset(repo, hash, mode));
    },
    createTag: async (hash, annotated) => {
      const fields = [{ name: 'name', label: 'Tag name', placeholder: 'v1.0.0' }];
      if (annotated) fields.push({ name: 'message', label: 'Message', type: 'textarea' } as any);
      const v = await ui.form({ title: annotated ? 'Create annotated tag' : 'Create tag', fields, confirm: 'Create tag' });
      if (v?.name) void run('Create tag', () => git.createTag(repo, v.name.trim(), hash, annotated ? v.message || v.name : undefined));
    },
    deleteTag: async (t) => {
      const remotes = data.remotes;
      const v = await ui.form({
        title: `Delete tag ${t.name}?`,
        fields: remotes.length ? [{ name: 'remote', label: `Also delete from ${remotes[0].name}`, type: 'checkbox' }] : [],
        danger: true,
        confirm: 'Delete',
      });
      if (!v) return;
      void run('Delete tag', async () => {
        await git.deleteTag(repo, t.name);
        if (v.remote) await git.deleteRemoteTag(repo, remotes[0].name, t.name);
      });
    },
    pushTag: async (t) => {
      const remote = await pickRemote();
      if (remote) void run(`Push ${t.name}`, () => git.pushTag(repo, remote, t.name), { success: `Pushed tag ${t.name}` });
    },
    fetch: () => void run('Fetch', () => git.fetch(repo, { prune: true })),
    pull: (mode = d.pullMode) =>
      void run('Pull', () => git.pull(repo, { rebase: mode === 'rebase', ffOnly: mode === 'ff-only' })),
    push: async (opts) => {
      const b: LocalBranch | undefined = opts?.branch ?? currentBranch();
      if (!b) return ui.toast('error', 'Nothing to push', 'HEAD is detached. Create a branch first.');
      if (!data.remotes.length) return ui.toast('error', 'No remotes', 'Add a remote before pushing.');
      if (!b.upstream || b.upstreamGone) {
        const v = await ui.form({
          title: `Push ${b.name}`,
          message: 'This branch has no upstream. Choose where to push it:',
          fields: [
            {
              name: 'remote',
              label: 'Remote',
              type: 'select',
              options: data.remotes.map((r) => ({ value: r.name, label: r.name })),
              value: data.remotes[0].name,
            },
            { name: 'branch', label: 'Remote branch name', value: b.name },
          ],
          confirm: 'Push',
        });
        if (!v) return;
        void run('Push', () => git.push(repo, { remote: v.remote, branch: `${b.name}:${v.branch}`, setUpstream: true }), {
          success: `Pushed ${b.name} to ${v.remote}/${v.branch}`,
        });
        return;
      }
      const slash = b.upstream.indexOf('/');
      const remote = b.upstream.slice(0, slash);
      const dest = b.upstream.slice(slash + 1);
      const doPush = (force: boolean) => git.push(repo, { remote, branch: `${b.name}:${dest}`, force });
      d.setBusy('Push');
      try {
        await doPush(!!opts?.force);
        ui.toast('success', `Pushed ${b.name}`);
      } catch (e) {
        const msg = errorMessage(e);
        if (/rejected|non-fast-forward|fetch first/i.test(msg)) {
          const ok = await ui.confirm(
            'Push rejected',
            `${b.upstream} has commits you do not have locally.\n\nPull first, or force push (--force-with-lease) to overwrite the remote branch.`,
            { danger: true, confirm: 'Force push' },
          );
          if (ok) await run('Force push', () => doPush(true), { success: `Force pushed ${b.name}` });
        } else ui.toast('error', 'Push failed', msg);
      } finally {
        d.setBusy(null);
        void refresh(true);
      }
    },
    stash: async () => {
      if (!wipCount) return ui.toast('info', 'Nothing to stash');
      const v = await ui.form({
        title: 'Stash changes',
        fields: [
          { name: 'message', label: 'Message (optional)', placeholder: `WIP on ${head() ?? 'HEAD'}` },
          { name: 'untracked', label: 'Include untracked files', type: 'checkbox', value: true },
        ],
        confirm: 'Stash',
      });
      if (v) void run('Stash', () => git.stashSave(repo, { message: v.message, includeUntracked: v.untracked }));
    },
    pop: () => {
      if (!data.stashes.length) return ui.toast('info', 'No stashes to pop');
      void run('Pop stash', () => git.stashApply(repo, 0, true));
    },
    stashApply: (s, pop) => void run(pop ? 'Pop stash' : 'Apply stash', () => git.stashApply(repo, s.index, pop)),
    stashDrop: async (s) => {
      const ok = await ui.confirm('Delete stash?', s.message, { danger: true, confirm: 'Delete' });
      if (ok) {
        if (d.selection?.kind === 'stash') d.setSelection(null);
        void run('Delete stash', () => git.stashDrop(repo, s.index));
      }
    },
    undo: () =>
      void run('Undo', async () => {
        const label = await d.app.undo(repo);
        ui.toast('info', label ? `Undid: ${label}` : 'Nothing to undo');
      }),
    redo: () =>
      void run('Redo', async () => {
        const label = await d.app.redo(repo);
        ui.toast('info', label ? `Redid: ${label}` : 'Nothing to redo');
      }),
    addRemote: async () => {
      const v = await ui.form({
        title: 'Add remote',
        fields: [
          { name: 'name', label: 'Name', value: data.remotes.length ? '' : 'origin' },
          { name: 'url', label: 'URL', placeholder: 'git@github.com:user/repo.git' },
        ],
        confirm: 'Add remote',
      });
      if (v?.name && v.url)
        void run('Add remote', async () => {
          await git.addRemote(repo, v.name.trim(), v.url.trim());
          await git.fetch(repo, { remote: v.name.trim() });
        });
    },
    editRemote: async (r) => {
      const v = await ui.form({
        title: `Edit remote ${r.name}`,
        fields: [
          { name: 'name', label: 'Name', value: r.name },
          { name: 'url', label: 'URL', value: r.fetchUrl },
        ],
        confirm: 'Save',
      });
      if (!v) return;
      void run('Edit remote', async () => {
        if (v.url !== r.fetchUrl) await git.setRemoteUrl(repo, r.name, v.url);
        if (v.name !== r.name) await git.renameRemote(repo, r.name, v.name);
      });
    },
    removeRemote: async (r) => {
      const ok = await ui.confirm(`Remove remote ${r.name}?`, 'Remote-tracking branches will be removed too.', { danger: true, confirm: 'Remove' });
      if (ok) void run('Remove remote', () => git.removeRemote(repo, r.name));
    },
    abort: async () => {
      const what = ({ merging: 'merge', rebasing: 'rebase', 'cherry-picking': 'cherry-pick', reverting: 'revert' } as Record<string, string>)[data.state.state] ?? 'operation';
      const ok = await ui.confirm(
        `Abort ${what}?`,
        `The branch goes back to exactly where it was before the ${what}. Conflict resolutions made so far are discarded.`,
        { danger: true, confirm: `Abort ${what}` },
      );
      if (!ok) return;
      const done = await run(`Abort ${what}`, () => git.abort(repo), { success: `${what[0].toUpperCase()}${what.slice(1)} aborted` });
      if (done && d.centerKind === 'conflict') d.setCenter({ kind: 'graph' });
    },
    continueOp: () => void run('Continue', () => git.continueOp(repo)),
    skip: () => void run('Skip commit', () => git.skipRebase(repo)),
    copy: (text, what = 'Text') => {
      void d.app.copy(text);
      ui.toast('info', `${what} copied`, text.length > 80 ? text.slice(0, 80) + '…' : text);
    },
    pickRef: (title, onPick, opts) => d.setRefPick({ title, onPick, worktree: !!opts?.worktree, kind: opts?.kind ?? 'all' }),
    compareWith: (rev, label, kind = 'all') =>
      d.setRefPick({
        title: kind === 'branches' ? `Compare ${label} with branch…` : kind === 'revisions' ? `Compare ${label} with revision…` : `Compare ${label} with…`,
        worktree: kind === 'all',
        exclude: rev,
        kind,
        // The working tree can only be the "to" side of a diff.
        onPick: (r) => d.setSelection(r === WORKTREE ? { kind: 'compare', from: rev, to: WORKTREE } : { kind: 'compare', from: r, to: rev }),
      }),
    compareFileWith: (file, kind) =>
      d.setRefPick({
        title: `Compare ${file} with ${kind === 'branches' ? 'branch' : 'revision'}…`,
        worktree: false,
        kind,
        // PyCharm-style: the file as it is now (working tree) against that branch/revision.
        onPick: (r) => d.setCenter({ kind: 'diff', source: { kind: 'range', from: r, to: WORKTREE }, file: { path: file, status: 'M' } }),
      }),
    undoMerge: async (c) => {
      const b = currentBranch();
      const before = c.parents[0];
      // Once the merge is on the remote, moving the branch back would need a force push that
      // rewrites shared history; a revert commit undoes the changes without that.
      const pushed = b?.upstream ? await git.isAncestor(repo, c.hash, b.upstream) : false;
      if (pushed) {
        const ok = await ui.confirm(
          'This merge is already pushed',
          `${b!.upstream} already contains this merge. Resetting would require a force push.\n\nCreate a revert commit that undoes the merged changes instead?`,
          { confirm: 'Revert merge' },
        );
        if (ok) void run('Revert merge', () => git.revert(repo, c.hash), { success: 'Merge reverted' });
        return;
      }
      const ok = await ui.confirm(
        `Undo "${c.subject}"?`,
        `${b?.name ?? 'HEAD'} goes back to ${before.slice(0, 7)}, where it was before the merge. The merged commits stay on their own branch, and uncommitted changes are kept.`,
        { confirm: 'Undo merge' },
      );
      if (ok) void run('Undo merge', () => git.reset(repo, before, 'keep'), { success: 'Merge undone — ⌘⇧Z to redo' });
    },
    rewriteHistory: async (hash, op) => {
      let message: string | undefined;
      if (op === 'reword') {
        const d = await git.commitDetails(repo, hash);
        const v = await ui.form({
          title: `Edit message of ${hash.slice(0, 7)}`,
          fields: [{ name: 'm', label: 'Commit message', type: 'textarea', value: d.message }],
          wide: true,
          confirm: 'Save message',
        });
        if (!v?.m?.trim()) return;
        message = v.m.trim();
      }
      if (op === 'drop') {
        const ok = await ui.confirm(`Drop commit ${hash.slice(0, 7)}?`, 'Its changes are removed from the branch history. You can undo this with ⌘Z.', {
          danger: true,
          confirm: 'Drop commit',
        });
        if (!ok) return;
      }
      const labels = { reword: 'Edit message', squash: 'Squash', fixup: 'Fixup', drop: 'Drop commit', up: 'Move commit', down: 'Move commit' };
      const ok = await run(labels[op], () => git.rewriteHistory(repo, hash, op, message), { success: `${labels[op]} done` });
      // The rewritten commit has a new hash; keep the selection on the branch tip instead.
      if (ok) d.setSelection(null);
    },
    runCustom: async (cmd, vars) => {
      const all = {
        repo,
        head: data.refs.headSha,
        branch: vars.branch ?? data.refs.head,
        sha: vars.sha ?? data.refs.headSha,
        file: vars.file ?? null,
      };
      d.setBusy(cmd.name);
      try {
        const r = await d.app.runCustom(repo, cmd.command, all);
        if (cmd.showOutput || r.code !== 0) d.setCmdOutput({ name: cmd.name, ...r });
        else ui.toast('success', `${cmd.name} finished`);
      } catch (e) {
        ui.toast('error', `${cmd.name} failed`, errorMessage(e));
      } finally {
        d.setBusy(null);
        void refresh(true);
      }
    },
  };
  async function pickRemote(): Promise<string | null> {
    if (!data.remotes.length) return null;
    if (data.remotes.length === 1) return data.remotes[0].name;
    const v = await ui.form({
      title: 'Choose remote',
      fields: [{ name: 'r', label: 'Remote', type: 'select', options: data.remotes.map((r) => ({ value: r.name, label: r.name })), value: data.remotes[0].name }],
    });
    return v?.r ?? null;
  }
  return a;
}
