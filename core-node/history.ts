// Undo / redo of user actions, shared by the Electron app and the Paseo plugin server (moved from
// electron/main.cjs). Each entry stores how to undo and redo one action as plain git operations, so
// replaying them never depends on in-memory UI state. Stacks live in memory, per repository.
import * as git from './git';

export interface UndoEntry {
  label: string;
  undo: () => Promise<unknown>;
  redo: () => Promise<unknown>;
}

const LIMIT = 50;

export function createHistory() {
  const history = new Map<string, { undo: UndoEntry[]; redo: UndoEntry[] }>();
  const stacks = (repo: string) => {
    let s = history.get(repo);
    if (!s) history.set(repo, (s = { undo: [], redo: [] }));
    return s;
  };
  function record(repo: string, entry: UndoEntry) {
    const s = stacks(repo);
    s.undo.push(entry);
    if (s.undo.length > LIMIT) s.undo.shift();
    s.redo = [];
  }
  async function headInfo(repo: string) {
    const r = await git.refs(repo);
    return { sha: r.headSha as string | null, branch: r.headDetached ? null : (r.head as string | null) };
  }

  /**
   * Wraps an operation that moves HEAD (merge, pull, rebase, cherry-pick, revert) so it can be
   * undone. Recorded only when it completed and HEAD actually moved — a conflicted merge is
   * still in progress and is backed out with Abort instead.
   */
  const headMover =
    (label: string | ((...args: any[]) => string)) =>
    (fn: (repo: string, ...args: any[]) => Promise<unknown>) =>
    async (repo: string, ...args: any[]) => {
      const before = await headInfo(repo);
      const result = await fn(repo, ...args);
      const after = await headInfo(repo);
      if (before.sha && after.sha && before.sha !== after.sha) {
        // WHY: --keep moves the branch back but refuses to clobber uncommitted edits.
        record(repo, {
          label: typeof label === 'function' ? label(...args) : label,
          undo: () => git.reset(repo, before.sha, 'keep'),
          redo: () => git.reset(repo, after.sha, 'keep'),
        });
      }
      return result;
    };

  /** Drop-in replacements for the git functions of the same name that also record an undo entry. */
  const tracked: Record<string, (repo: string, ...args: any[]) => Promise<unknown>> = {
    merge: headMover((ref) => `Merge ${ref}`)(git.merge),
    pull: headMover('Pull')(git.pull),
    rebase: headMover((onto) => `Rebase onto ${onto}`)(git.rebase),
    cherryPick: headMover('Cherry pick')(git.cherryPick),
    revert: headMover('Revert')(git.revert),
    interactiveRebase: headMover('Interactive rebase')(git.interactiveRebase),
    async commit(repo, message, opts) {
      const before = await headInfo(repo);
      await git.commit(repo, message, opts);
      const after = await headInfo(repo);
      if (before.sha) {
        record(repo, {
          label: opts && opts.amend ? 'Amend' : 'Commit',
          undo: () => git.reset(repo, before.sha, 'soft'),
          redo: () => git.reset(repo, after.sha, 'soft'),
        });
      }
    },
    async checkout(repo, ref) {
      const before = await headInfo(repo);
      await git.checkout(repo, ref);
      const prev = before.branch || before.sha;
      if (prev) {
        record(repo, {
          label: `Checkout ${ref}`,
          undo: () => git.checkout(repo, prev),
          redo: () => git.checkout(repo, ref),
        });
      }
    },
    async createBranch(repo, name, start, doCheckout) {
      const before = await headInfo(repo);
      await git.createBranch(repo, name, start, doCheckout);
      const sha = await git.revParse(repo, name);
      record(repo, {
        label: `Create branch ${name}`,
        undo: async () => {
          if (doCheckout && before.branch) await git.checkout(repo, before.branch);
          else if (doCheckout && before.sha) await git.checkout(repo, before.sha);
          await git.deleteBranch(repo, name, true);
        },
        redo: () => git.createBranch(repo, name, sha, doCheckout),
      });
    },
    async deleteBranch(repo, name, force) {
      const sha = await git.revParse(repo, `refs/heads/${name}`);
      await git.deleteBranch(repo, name, force);
      record(repo, {
        label: `Delete branch ${name}`,
        undo: () => git.createBranch(repo, name, sha, false),
        redo: () => git.deleteBranch(repo, name, true),
      });
    },
    async rewriteHistory(repo, hash, op, message) {
      const before = await headInfo(repo);
      await git.rewriteHistory(repo, hash, op, message);
      const after = await headInfo(repo);
      const labels: Record<string, string> = { reword: 'Edit message', squash: 'Squash', fixup: 'Fixup', drop: 'Drop commit', up: 'Move commit', down: 'Move commit' };
      // WHY: --keep (not --hard) moves the branch back but refuses to clobber local edits.
      record(repo, {
        label: labels[op] || op,
        undo: () => git.reset(repo, before.sha, 'keep'),
        redo: () => git.reset(repo, after.sha, 'keep'),
      });
    },
    async reset(repo, target, mode) {
      const before = await headInfo(repo);
      await git.reset(repo, target, mode);
      const after = await headInfo(repo);
      // A hard reset discards working-tree changes git cannot give back — not undoable.
      if (mode !== 'hard' && before.sha) {
        record(repo, {
          label: `Reset ${mode}`,
          undo: () => git.reset(repo, before.sha, 'soft'),
          redo: () => git.reset(repo, after.sha, 'soft'),
        });
      }
    },
  };

  async function undo(repo: string) {
    const s = stacks(repo);
    const e = s.undo.pop();
    if (!e) return null;
    await e.undo();
    s.redo.push(e);
    return e.label;
  }
  async function redo(repo: string) {
    const s = stacks(repo);
    const e = s.redo.pop();
    if (!e) return null;
    await e.redo();
    s.undo.push(e);
    return e.label;
  }
  function info(repo: string) {
    const s = stacks(repo);
    return {
      undo: s.undo.length ? s.undo[s.undo.length - 1].label : null,
      redo: s.redo.length ? s.redo[s.redo.length - 1].label : null,
    };
  }
  return { tracked, undo, redo, info, forget: (repo: string) => history.delete(repo) };
}
