// Right pane of the JetBrains-style log (OpenIDEA CommitDetails): the commit's changed files as a tree with a
// count on top, and below it the full message with hash, author and date.
import { useEffect, useMemo, useState } from 'react';
import { app, errorMessage, git } from '../../lib/api';
import type { CommitDetails, FileChange } from '../../lib/types';
import { absoluteTime } from '../../lib/format';
import { buildFileTree, folderPaths, jbTime, type FileNode } from '../../lib/jb';
import { IconChevron, IconFile, IconFolder } from '../Icons';
import { useUI } from '../Overlays';
import { customMenu, fileCompareItems, rowMenu, useRepo } from '../RepoContext';

const STATUS_CLASS: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted', R: 'modified', C: 'added', U: 'conflict' };

export function JbDetails({ hash }: { hash: string }) {
  const ctx = useRepo();
  const { repo, data, center, setCenter, select, actions: a } = ctx;
  const ui = useUI();
  const [details, setDetails] = useState<CommitDetails | null>(null);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDetails(null);
    setError('');
    git
      .commitDetails(repo, hash)
      .then(setDetails)
      .catch((e) => setError(errorMessage(e)));
  }, [repo, hash]);

  const tree = useMemo(() => buildFileTree(details?.files ?? []), [details]);
  if (error) return <div className="jb-message">{error}</div>;
  if (!details) return <div className="jb-message">Loading…</div>;

  const listed = data.commits.find((c) => c.hash === hash);
  const [subject, ...rest] = details.message.split('\n');
  const body = rest.join('\n').trim();
  const sameCommitter = details.committer === details.author && details.committerEmail === details.email;
  const selectedFile = center.kind === 'diff' && center.source.kind === 'commit' ? center.file.path : null;
  const toggle = (path: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  const fileMenu = (e: React.MouseEvent, f: FileChange) =>
    ui.menu(e, [
      { label: 'Show Diff', onClick: () => setCenter({ kind: 'diff', source: { kind: 'commit', hash }, file: f }) },
      ...(f.status === 'D' ? [] : fileCompareItems(ctx, f.path)),
      { label: 'File history', onClick: () => setCenter({ kind: 'history', file: f.path }) },
      { label: 'Annotate (blame) at this commit', onClick: () => setCenter({ kind: 'blame', file: f.path, rev: hash }), disabled: f.status === 'D' },
      { separator: true },
      { label: 'Restore file from this commit', onClick: () => a.run('Restore file', () => git.restoreFile(repo, f.status === 'D' ? `${hash}^` : hash, f.path)) },
      { label: 'View file at this commit', onClick: () => setCenter({ kind: 'file', file: f.path, rev: f.status === 'D' ? `${hash}^` : hash }) },
      { label: 'Open working file', onClick: () => void app.openFile(repo, f.path) },
      { label: 'Copy file path', onClick: () => a.copy(f.path, 'Path') },
      ...customMenu(ctx, 'file', { sha: hash, file: f.path }),
    ]);

  const node = (n: FileNode<FileChange>, depth: number): React.ReactNode => {
    if (n.dir) {
      const open = !closed.has(n.path);
      return (
        <div key={`d:${n.path}`}>
          <div className="jb-frow" style={{ paddingLeft: 6 + depth * 16 }} onClick={() => toggle(n.path)}>
            <span className="jb-twisty">
              <IconChevron width={10} height={10} style={{ transform: open ? undefined : 'rotate(-90deg)' }} />
            </span>
            <IconFolder width={14} height={14} className="jb-ficon" />
            <span className="jb-fname">{n.name}</span>
            <span className="jb-detail">{n.count} {n.count === 1 ? 'file' : 'files'}</span>
          </div>
          {open && n.children.map((c) => node(c, depth + 1))}
        </div>
      );
    }
    const f = n.file!;
    return (
      <div
        key={`f:${n.path}`}
        className={`jb-frow file ${STATUS_CLASS[f.status[0]] ?? 'modified'}${selectedFile === f.path ? ' selected' : ''}`}
        style={{ paddingLeft: 6 + depth * 16 }}
        onClick={() => setCenter({ kind: 'diff', source: { kind: 'commit', hash }, file: f })}
        onContextMenu={(e) => fileMenu(e, f)}
        title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
      >
        <span className="jb-twisty" />
        <IconFile width={14} height={14} className="jb-ficon" />
        <span className="jb-fname">{n.name}</span>
        {f.additions != null && (
          <span className="jb-detail">
            <span style={{ color: 'var(--vcs-added)' }}>+{f.additions}</span> <span style={{ color: 'var(--danger)' }}>−{f.deletions}</span>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="jb-details">
      <div className="jb-dbar">
        <span className="jb-dtitle">Commit</span>
        <span className="jb-count">
          {details.files.length} {details.files.length === 1 ? 'file' : 'files'}
          {details.parents.length > 1 && ' · vs. first parent'}
        </span>
        <span className="jb-grow" />
        <button className="jb-ibtn" title="Collapse all" onClick={() => setClosed(new Set(folderPaths(tree)))}>
          <IconChevron width={12} height={12} style={{ transform: 'rotate(-90deg)' }} />
        </button>
        <button className="jb-ibtn" title="Expand all" onClick={() => setClosed(new Set())}>
          <IconChevron width={12} height={12} />
        </button>
        {listed && (
          <button className="jb-ibtn" title="Commit actions" onClick={(e) => ui.menu(e, rowMenu(ctx, listed, ctx.labels.get(listed.hash) ?? []))}>
            ⋯
          </button>
        )}
      </div>
      <div className="jb-filetree">{tree.map((n) => node(n, 0))}{!tree.length && <div className="jb-message">No files changed</div>}</div>
      <div className="jb-msgbox">
        <div className="jb-msgsubject">{subject}</div>
        {body && <div className="jb-msgfull">{body}</div>}
        <div className="jb-meta">
          <span className="jb-hash jb-link" title="Copy hash" onClick={() => a.copy(details.hash, 'Hash')}>
            {details.hash.slice(0, 8)}
          </span>{' '}
          {details.author} &lt;{details.email}&gt; on <span title={absoluteTime(details.time)}>{jbTime(details.time)}</span>
          {!sameCommitter && (
            <>
              <br />
              committed by {details.committer} on {jbTime(details.committerTime)}
            </>
          )}
          {details.parents.length > 0 && (
            <>
              <br />
              parent{details.parents.length > 1 ? 's' : ''}:{' '}
              {details.parents.map((p) => (
                <span
                  key={p}
                  className="jb-hash jb-link"
                  onClick={() => {
                    select({ kind: 'commit', hash: p });
                    window.dispatchEvent(new CustomEvent('gitkrane:scrollTo', { detail: p }));
                  }}
                >
                  {p.slice(0, 8)}{' '}
                </span>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
