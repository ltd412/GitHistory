import { useEffect, useState } from 'react';
import { app, errorMessage, git } from '../lib/api';
import type { CommitDetails, FileChange, Stash } from '../lib/types';
import { absoluteTime, avatarColor, initials, relativeTime } from '../lib/format';
import { FileList, ModeToggle, type ListMode } from './FileList';
import { useUI } from './Overlays';
import { customMenu, fileCompareItems, rowMenu, stashMenu, useRepo } from './RepoContext';

function Avatar({ name, email, size = 32 }: { name: string; email: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: avatarColor(email || name), fontSize: size * 0.36 }}>
      {initials(name)}
    </span>
  );
}

export function CommitPanel({ hash }: { hash: string }) {
  const ctx = useRepo();
  const { repo, data, center, setCenter, select, actions: a } = ctx;
  const ui = useUI();
  const [details, setDetails] = useState<CommitDetails | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ListMode>('path');
  const [view, setView] = useState<'changes' | 'all'>('changes');
  const [tree, setTree] = useState<FileChange[] | null>(null);

  useEffect(() => {
    if (view !== 'all' || tree) return;
    git.lsTree(repo, hash).then((paths) => setTree(paths.map((p) => ({ path: p, status: ' ' }))));
  }, [repo, hash, view, tree]);

  useEffect(() => {
    git
      .commitDetails(repo, hash)
      .then(setDetails)
      .catch((e) => setError(errorMessage(e)));
  }, [repo, hash]);

  if (error) return <div className="empty-files">{error}</div>;
  if (!details) return <div className="empty-files">Loading…</div>;

  const [subject, ...bodyLines] = details.message.split('\n');
  const body = bodyLines.join('\n').trim();
  const sameCommitter = details.committer === details.author && details.committerEmail === details.email;
  const listed = data.commits.find((c) => c.hash === hash);

  const fileMenu = (e: React.MouseEvent, f: FileChange) =>
    ui.menu(e, [
      { label: 'View diff', onClick: () => setCenter({ kind: 'diff', source: { kind: 'commit', hash }, file: f }) },
      ...(f.status === 'D' ? [] : fileCompareItems(ctx, f.path)),
      { label: 'File history', onClick: () => setCenter({ kind: 'history', file: f.path }) },
      { label: 'File blame at this commit', onClick: () => setCenter({ kind: 'blame', file: f.path, rev: hash }), disabled: f.status === 'D' },
      { separator: true },
      {
        label: 'Restore file from this commit',
        onClick: () => a.run('Restore file', () => git.restoreFile(repo, f.status === 'D' ? `${hash}^` : hash, f.path)),
      },
      { label: 'View file at this commit', onClick: () => setCenter({ kind: 'file', file: f.path, rev: f.status === 'D' ? `${hash}^` : hash }) },
      { label: 'Open working file', onClick: () => void app.openFile(repo, f.path) },
      { label: 'Copy file path', onClick: () => a.copy(f.path, 'Path') },
      ...customMenu(ctx, 'file', { sha: hash, file: f.path }),
    ]);

  return (
    <>
      <div className="rp-head">
        <span className="title">Commit</span>
        {listed && (
          <button className="btn ghost" onClick={(e) => ui.menu(e, rowMenu(ctx, listed, ctx.labels.get(listed.hash) ?? []))}>
            Actions ▾
          </button>
        )}
      </div>
      <div className="rp-scroll">
        <div className="detail">
          <div className="sha-row">
            commit:
            <code onClick={() => a.copy(details.hash, 'SHA')} title="Copy SHA">
              {details.hash.slice(0, 7)}
            </code>
            {details.parents.length > 0 && (
              <>
                parent{details.parents.length > 1 ? 's' : ''}:
                {details.parents.map((p) => (
                  <code
                    key={p}
                    onClick={() => {
                      select({ kind: 'commit', hash: p });
                      window.dispatchEvent(new CustomEvent('gitkrane:scrollTo', { detail: p }));
                    }}
                    title="Go to parent"
                  >
                    {p.slice(0, 7)}
                  </code>
                ))}
              </>
            )}
          </div>
          <div className="message">
            <span className="s">{subject}</span>
            {body}
          </div>
          <div className="who">
            <Avatar name={details.author} email={details.email} />
            <div>
              <div className="n">{details.author}</div>
              <div className="d" title={absoluteTime(details.time)}>
                authored {relativeTime(details.time)} · {absoluteTime(details.time)}
              </div>
            </div>
          </div>
          {!sameCommitter && (
            <div className="who">
              <Avatar name={details.committer} email={details.committerEmail} size={24} />
              <div>
                <div className="n">{details.committer}</div>
                <div className="d">committed {relativeTime(details.committerTime)}</div>
              </div>
            </div>
          )}
        </div>
        <div className="rp-section-head">
          <div className="view-toggle">
            <button className={view === 'changes' ? 'on' : ''} onClick={() => setView('changes')}>
              {details.files.length} changed
            </button>
            <button className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>
              All files
            </button>
          </div>
          <span className="flex">{view === 'changes' && details.parents.length > 1 && '(vs. first parent)'}</span>
          {view === 'changes' && <ModeToggle mode={mode} onChange={setMode} />}
        </div>
        {view === 'changes' ? (
          <FileList
            files={details.files}
            mode={mode}
            showStats
            selected={center.kind === 'diff' && center.source.kind === 'commit' ? center.file.path : null}
            onClick={(f) => setCenter({ kind: 'diff', source: { kind: 'commit', hash }, file: f })}
            onContextMenu={fileMenu}
          />
        ) : tree ? (
          <FileList
            files={tree}
            mode="tree"
            hideStatus
            startCollapsed
            selected={center.kind === 'file' && center.rev === hash ? center.file : null}
            onClick={(f) => setCenter({ kind: 'file', file: f.path, rev: hash })}
            onContextMenu={(e, f) =>
              ui.menu(e, [
                { label: 'View file', onClick: () => setCenter({ kind: 'file', file: f.path, rev: hash }) },
                ...fileCompareItems(ctx, f.path),
                { label: 'File history', onClick: () => setCenter({ kind: 'history', file: f.path }) },
                { label: 'Restore this version', onClick: () => a.run('Restore file', () => git.restoreFile(repo, hash, f.path)) },
                { label: 'Copy file path', onClick: () => a.copy(f.path, 'Path') },
                ...customMenu(ctx, 'file', { sha: hash, file: f.path }),
              ])
            }
          />
        ) : (
          <div className="empty-files">Loading file tree…</div>
        )
        }
      </div>
    </>
  );
}

export function StashPanel({ stash }: { stash: Stash }) {
  const ctx = useRepo();
  const { repo, center, setCenter, actions: a } = ctx;
  const ui = useUI();
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [mode, setMode] = useState<ListMode>('path');
  useEffect(() => {
    git.stashFiles(repo, stash.hash).then(setFiles).catch(() => setFiles([]));
  }, [repo, stash.hash]);
  return (
    <>
      <div className="rp-head">
        <span className="title">Stash</span>
        <button className="btn ghost" onClick={(e) => ui.menu(e, stashMenu(ctx, stash))}>
          Actions ▾
        </button>
      </div>
      <div className="rp-scroll">
        <div className="detail">
          <div className="sha-row">
            <code>{stash.ref}</code> {relativeTime(stash.time)}
          </div>
          <div className="message">
            <span className="s">{stash.message}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn green" onClick={() => a.stashApply(stash, false)}>
              Apply
            </button>
            <button className="btn" onClick={() => a.stashApply(stash, true)}>
              Pop
            </button>
            <button className="btn red" onClick={() => a.stashDrop(stash)}>
              Delete
            </button>
          </div>
        </div>
        <div className="rp-section-head">
          <span className="flex">{files?.length ?? 0} files</span>
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
        {files && (
          <FileList
            files={files}
            mode={mode}
            selected={center.kind === 'diff' && center.source.kind === 'stash' ? center.file.path : null}
            onClick={(f) => setCenter({ kind: 'diff', source: { kind: 'stash', hash: stash.hash }, file: f })}
          />
        )}
      </div>
    </>
  );
}
