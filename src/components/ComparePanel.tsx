import { useEffect, useState } from 'react';
import { errorMessage, git } from '../lib/api';
import { WORKTREE, type FileChange } from '../lib/types';
import { FileList, ModeToggle, type ListMode } from './FileList';
import { fileCompareItems, useRepo } from './RepoContext';
import { useUI } from './Overlays';
import { keyLabel } from '../lib/keys';

const isSha = (rev: string) => /^[0-9a-f]{40}$/.test(rev);
export const revLabel = (rev: string) => (rev === WORKTREE ? 'working tree' : isSha(rev) ? rev.slice(0, 7) : rev);

/**
 * Right panel comparing two revisions — commits picked with ⌘-click, a branch/tag against the
 * current branch, or anything against the working tree — listing every file that differs.
 */
export function ComparePanel({ from, to }: { from: string; to: string }) {
  const ctx = useRepo();
  const { repo, data, center, setCenter, select, actions: a } = ctx;
  const ui = useUI();
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ListMode>('path');
  const [subjects, setSubjects] = useState<Record<string, { sha: string; subject: string }>>({});
  const worktree = to === WORKTREE;

  useEffect(() => {
    setFiles(null);
    git
      .rangeFiles(repo, from, to)
      .then((f) => {
        setFiles(f);
        setError('');
      })
      .catch((e) => setError(errorMessage(e)));
    // The working-tree side changes as files are edited: follow status updates.
  }, [repo, from, to, worktree ? data.status : null]);

  useEffect(() => {
    void Promise.all(
      [from, to]
        .filter((r) => r !== WORKTREE)
        .map(async (r) => {
          const sha = await git.revParse(repo, `${r}^{commit}`);
          const c = sha ? data.commits.find((x) => x.hash === sha) : undefined;
          return [r, { sha: sha ?? '', subject: c?.subject ?? '' }] as const;
        }),
    ).then((entries) => setSubjects(Object.fromEntries(entries)));
  }, [repo, from, to, data.commits]);

  const totals = (files ?? []).reduce((t, f) => ({ add: t.add + (f.additions ?? 0), del: t.del + (f.deletions ?? 0) }), { add: 0, del: 0 });

  const change = (which: 'from' | 'to') =>
    a.pickRef(
      `Compare: change the ${which === 'from' ? 'From' : 'To'} side`,
      (r) => select(which === 'from' ? { kind: 'compare', from: r, to } : { kind: 'compare', from, to: r }),
      { worktree: which === 'to' },
    );

  const side = (label: string, rev: string, which: 'from' | 'to') => {
    const info = subjects[rev];
    return (
      <div className="sha-row">
        {label}:
        <button className="btn ghost" style={{ padding: '1px 6px' }} title="Compare against another branch, tag or commit" onClick={() => change(which)}>
          Change…
        </button>
        {rev === WORKTREE ? (
          <code>working tree</code>
        ) : (
          <code title={info?.sha} onClick={() => info?.sha && a.copy(info.sha, 'SHA')}>
            {isSha(rev) ? rev.slice(0, 7) : `${rev} · ${info?.sha.slice(0, 7) ?? ''}`}
          </code>
        )}
        <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {rev === WORKTREE ? 'uncommitted changes included' : info?.subject}
        </span>
      </div>
    );
  };

  return (
    <>
      <div className="rp-head">
        <span className="title">
          Compare {revLabel(from)} ↔ {revLabel(to)}
        </span>
        <button className="btn ghost" title="Swap sides" disabled={worktree} onClick={() => select({ kind: 'compare', from: to, to: from })}>
          ⇄ Swap
        </button>
      </div>
      <div className="rp-scroll">
        <div className="detail">
          {side('From', from, 'from')}
          {side('To', to, 'to')}
          <div className="sha-row">{keyLabel('Tip: ⌘-click two commits, right-click a branch → Compare with…, or ⌘P → Compare branches.')}</div>
        </div>
        <div className="rp-section-head">
          <span className="flex">
            {files ? `${files.length} files changed` : error ? 'Could not compare' : 'Loading…'}
            {files && (
              <>
                {'  '}
                <span style={{ color: 'var(--green)' }}>+{totals.add}</span> <span style={{ color: 'var(--red)' }}>-{totals.del}</span>
              </>
            )}
          </span>
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
        {error && (
          <div className="empty-files" style={{ color: 'var(--red)', fontStyle: 'normal', whiteSpace: 'pre-wrap' }}>
            {error}
          </div>
        )}
        {files?.length === 0 && <div className="empty-files">No differences.</div>}
        {files && (
          <FileList
            files={files}
            mode={mode}
            showStats
            selected={center.kind === 'diff' && center.source.kind === 'range' ? center.file.path : null}
            onClick={(f) => setCenter({ kind: 'diff', source: { kind: 'range', from, to }, file: f })}
            onContextMenu={(e, f) =>
              ui.menu(e, [
                { label: 'View diff', onClick: () => setCenter({ kind: 'diff', source: { kind: 'range', from, to }, file: f }) },
                ...(f.status === 'D' ? [] : fileCompareItems(ctx, f.path)),
                { label: 'File history', onClick: () => setCenter({ kind: 'history', file: f.path }) },
                { label: 'Copy file path', onClick: () => a.copy(f.path, 'Path') },
              ])
            }
          />
        )}
      </div>
    </>
  );
}
