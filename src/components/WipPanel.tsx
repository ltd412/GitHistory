import { useEffect, useRef, useState } from 'react';
import { app, git } from '../lib/api';
import type { FileChange } from '../lib/types';
import { FileList, ModeToggle, type ListMode } from './FileList';
import { IconTrash } from './Icons';
import { useUI, type MenuItem } from './Overlays';
import { customMenu, fileCompareItems, useRepo } from './RepoContext';

const SUMMARY_LIMIT = 72;

// Drafts outlive the panel, which unmounts whenever another commit is selected.
const drafts = new Map<string, { summary: string; description: string }>();

export function WipPanel() {
  const ctx = useRepo();
  const { repo, data, actions: a, center, setCenter, settings } = ctx;
  const [pushAfter, setPushAfter] = useState(settings.pushAfterCommit);
  const ui = useUI();
  const { status, state } = data;
  const [mode, setMode] = useState<ListMode>('path');
  const [summary, setSummary] = useState(() => drafts.get(repo)?.summary ?? '');
  const [description, setDescription] = useState(() => drafts.get(repo)?.description ?? '');
  useEffect(() => {
    drafts.set(repo, { summary, description });
  }, [repo, summary, description]);
  const [amend, setAmend] = useState(false);
  const savedDraft = useRef<{ summary: string; description: string } | null>(null);
  const prefilledMerge = useRef('');

  // Merges, cherry-picks and reverts leave a prepared message in MERGE_MSG — offer it once.
  useEffect(() => {
    if (state.mergeMsg && state.mergeMsg !== prefilledMerge.current && !summary) {
      prefilledMerge.current = state.mergeMsg;
      const [s, ...rest] = state.mergeMsg.split('\n');
      setSummary(s);
      setDescription(rest.join('\n').trim());
    }
  }, [state.mergeMsg, summary]);

  const toggleAmend = async (on: boolean) => {
    setAmend(on);
    if (on) {
      savedDraft.current = { summary, description };
      const msg = await git.lastCommitMessage(repo);
      const [s, ...rest] = msg.split('\n');
      setSummary(s);
      setDescription(rest.join('\n').trim());
    } else if (savedDraft.current) {
      setSummary(savedDraft.current.summary);
      setDescription(savedDraft.current.description);
    }
  };

  const total = status.staged.length + status.unstaged.length + status.conflicted.length;
  const canCommit = summary.trim().length > 0 && (status.staged.length > 0 || amend) && status.conflicted.length === 0;

  const doCommit = async () => {
    if (!canCommit) return;
    const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim();
    const isContinue = state.state === 'rebasing' || state.state === 'cherry-picking' || state.state === 'reverting';
    const ok = await a.run(amend ? 'Amend' : 'Commit', async () => {
      await git.commit(repo, message, { amend });
      if (isContinue) await git.continueOp(repo);
    });
    if (ok) {
      const wasAmend = amend;
      setSummary('');
      setDescription('');
      setAmend(false);
      savedDraft.current = null;
      if (center.kind === 'diff') setCenter({ kind: 'graph' });
      // Amending rewrites a commit that may already be on the remote: never force-push implicitly.
      if (pushAfter && !wasAmend && !isContinue && data.remotes.length) a.push();
    }
  };

  // Global Cmd+Enter from the menu.
  const commitRef = useRef(doCommit);
  commitRef.current = doCommit;
  useEffect(() => {
    const h = (e: Event) => (e as CustomEvent).detail === repo && commitRef.current();
    window.addEventListener('gitkrane:commit', h);
    return () => window.removeEventListener('gitkrane:commit', h);
  }, [repo]);

  const selectedPath = center.kind === 'diff' && (center.source.kind === 'unstaged' || center.source.kind === 'staged') ? `${center.source.kind}:${center.file.path}` : null;

  const fileMenu = (e: React.MouseEvent, f: FileChange, staged: boolean): void => {
    const items: MenuItem[] = [
      staged
        ? { label: 'Unstage file', onClick: () => a.run('Unstage', () => git.unstage(repo, [f.path])) }
        : { label: 'Stage file', onClick: () => a.run('Stage', () => git.stage(repo, [f.path])) },
    ];
    if (!staged)
      items.push({
        label: 'Discard changes',
        danger: true,
        onClick: async () => {
          if (await ui.confirm('Discard changes?', `${f.path}\n\nThis cannot be undone.`, { danger: true, confirm: 'Discard' }))
            void a.run('Discard', () => git.discard(repo, [f]));
        },
      });
    items.push(
      { separator: true },
      { label: 'Open file', onClick: () => void app.openFile(repo, f.path) },
      ...(f.untracked ? [] : fileCompareItems(ctx, f.path)),
      { label: 'File history', onClick: () => setCenter({ kind: 'history', file: f.path }), disabled: !!f.untracked },
      { label: 'File blame', onClick: () => setCenter({ kind: 'blame', file: f.path }), disabled: !!f.untracked },
      { separator: true },
    );
    if (f.untracked) {
      const ext = /\.[^./]+$/.exec(f.path)?.[0];
      items.push({ label: `Ignore ${f.path}`, onClick: () => a.run('Ignore', () => appendIgnore(repo, f.path)) });
      if (ext) items.push({ label: `Ignore all *${ext} files`, onClick: () => a.run('Ignore', () => appendIgnore(repo, `*${ext}`)) });
      items.push({ separator: true });
    }
    items.push({ label: 'Copy file path', onClick: () => a.copy(f.path, 'Path') });
    items.push(...customMenu(ctx, 'file', { file: f.path }));
    ui.menu(e, items);
  };

  const conflictMenu = (e: React.MouseEvent, f: FileChange) =>
    ui.menu(e, [
      { label: 'Resolve in merge tool', onClick: () => setCenter({ kind: 'conflict', file: f.path }) },
      { separator: true },
      { label: 'Take ours (current branch)', onClick: () => a.run('Resolve', () => git.resolveConflict(repo, f.path, 'ours')) },
      { label: 'Take theirs (incoming)', onClick: () => a.run('Resolve', () => git.resolveConflict(repo, f.path, 'theirs')) },
      { label: 'Mark as resolved', onClick: () => a.run('Resolve', () => git.resolveConflict(repo, f.path, 'mark')) },
      { separator: true },
      { label: 'Open file', onClick: () => void app.openFile(repo, f.path) },
    ]);

  const branch = data.refs.headDetached ? `detached HEAD` : (data.refs.head ?? 'HEAD');
  const stateLabel: Record<string, string> = {
    merging: 'Merge in progress',
    rebasing: 'Rebase in progress',
    'cherry-picking': 'Cherry-pick in progress',
    reverting: 'Revert in progress',
  };

  return (
    <>
      <div className="rp-head">
        <span className="title">
          {total} file change{total === 1 ? '' : 's'} on <b>{branch}</b>
        </span>
        <ModeToggle mode={mode} onChange={setMode} />
        <button
          className="btn ghost"
          title="Discard all changes"
          disabled={!total}
          onClick={async () => {
            if (await ui.confirm('Discard all changes?', 'All staged, unstaged and untracked changes will be lost. This cannot be undone.', { danger: true, confirm: 'Discard all' }))
              void a.run('Discard all', () => git.discardAll(repo));
          }}
        >
          <IconTrash />
        </button>
      </div>
      {state.state !== 'clean' && (
        <div className="banner">
          <b>{stateLabel[state.state]}</b>
          <span>
            {status.conflicted.length
              ? `${status.conflicted.length} conflicted file(s). Resolve them, then continue.`
              : 'All conflicts resolved. Commit or continue to finish.'}
          </span>
          <div className="acts">
            <button className="btn red" onClick={a.abort}>
              Abort
            </button>
            {state.state === 'rebasing' && (
              <button className="btn" onClick={a.skip}>
                Skip commit
              </button>
            )}
            {state.state !== 'merging' && (
              <button className="btn green" disabled={status.conflicted.length > 0} onClick={a.continueOp}>
                Continue
              </button>
            )}
          </div>
        </div>
      )}
      <div className="rp-scroll">
        {status.conflicted.length > 0 && (
          <>
            <div className="rp-section-head" style={{ color: 'var(--red)' }}>
              <span className="flex">Conflicted Files ({status.conflicted.length})</span>
            </div>
            <FileList
              files={status.conflicted}
              mode={mode}
              selected={center.kind === 'conflict' ? center.file : null}
              onClick={(f) => setCenter({ kind: 'conflict', file: f.path })}
              onContextMenu={conflictMenu}
            />
          </>
        )}
        <div className="rp-section-head">
          <span className="flex">Unstaged Files ({status.unstaged.length})</span>
          <button className="btn green" disabled={!status.unstaged.length} onClick={() => a.run('Stage all', () => git.stageAll(repo))}>
            Stage all changes
          </button>
        </div>
        {status.unstaged.length ? (
          <FileList
            files={status.unstaged}
            mode={mode}
            selected={selectedPath?.startsWith('unstaged:') ? selectedPath.slice(9) : null}
            onClick={(f) => setCenter({ kind: 'diff', source: { kind: 'unstaged' }, file: f })}
            onDoubleClick={(f) => a.run('Stage', () => git.stage(repo, [f.path]))}
            onContextMenu={(e, f) => fileMenu(e, f, false)}
            action={(f) => (
              <button
                className="btn green"
                onClick={(e) => {
                  e.stopPropagation();
                  void a.run('Stage', () => git.stage(repo, [f.path]));
                }}
              >
                Stage File
              </button>
            )}
          />
        ) : (
          <div className="empty-files">No unstaged changes</div>
        )}
        <div className="rp-section-head">
          <span className="flex">Staged Files ({status.staged.length})</span>
          <button className="btn red" disabled={!status.staged.length} onClick={() => a.run('Unstage all', () => git.unstageAll(repo))}>
            Unstage all changes
          </button>
        </div>
        {status.staged.length ? (
          <FileList
            files={status.staged}
            mode={mode}
            selected={selectedPath?.startsWith('staged:') ? selectedPath.slice(7) : null}
            onClick={(f) => setCenter({ kind: 'diff', source: { kind: 'staged' }, file: f })}
            onDoubleClick={(f) => a.run('Unstage', () => git.unstage(repo, [f.path]))}
            onContextMenu={(e, f) => fileMenu(e, f, true)}
            action={(f) => (
              <button
                className="btn red"
                onClick={(e) => {
                  e.stopPropagation();
                  void a.run('Unstage', () => git.unstage(repo, [f.path]));
                }}
              >
                Unstage File
              </button>
            )}
          />
        ) : (
          <div className="empty-files">No staged files</div>
        )}
      </div>
      <div className="commit-box">
        <div className="row">
          <b style={{ color: 'var(--text)', flex: 1 }}>Commit</b>
          <label className="toggle-check" title="Push to the upstream right after committing">
            <input
              type="checkbox"
              checked={pushAfter}
              disabled={!data.remotes.length}
              onChange={(e) => {
                setPushAfter(e.target.checked);
                void app.setSettings({ pushAfterCommit: e.target.checked });
              }}
            />
            Push after commit
          </label>
          <label className="toggle-check" title="Amend the previous commit">
            <input type="checkbox" checked={amend} disabled={!data.refs.headSha} onChange={(e) => void toggleAmend(e.target.checked)} />
            Amend
          </label>
        </div>
        <div className="summary-wrap">
          <input
            className="input"
            placeholder="Summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && doCommit()}
            style={{ paddingRight: 40 }}
          />
          <span className={`cnt${summary.length > SUMMARY_LIMIT ? ' over' : ''}`}>{SUMMARY_LIMIT - summary.length}</span>
        </div>
        <textarea
          className="textarea"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && doCommit()}
        />
        <button className="btn green big" disabled={!canCommit} onClick={doCommit}>
          {status.conflicted.length
            ? 'Resolve conflicts to commit'
            : amend
              ? 'Amend previous commit'
              : status.staged.length
                ? state.state === 'merging'
                  ? `Commit and merge`
                  : `Commit${pushAfter && data.remotes.length ? ' & Push' : ''} changes to ${status.staged.length} file${status.staged.length === 1 ? '' : 's'}`
                : 'Stage files/changes to commit'}
        </button>
      </div>
    </>
  );
}

async function appendIgnore(repo: string, pattern: string) {
  let current = '';
  try {
    current = await git.readWorkingFile(repo, '.gitignore');
  } catch {
    /* no .gitignore yet */
  }
  const sep = current && !current.endsWith('\n') ? '\n' : '';
  await git.writeWorkingFile(repo, '.gitignore', `${current}${sep}${pattern}\n`);
}
