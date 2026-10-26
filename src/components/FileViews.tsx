import { useEffect, useMemo, useState } from 'react';
import { errorMessage, git } from '../lib/api';
import type { Commit } from '../lib/types';
import { absoluteTime, avatarColor, initials, relativeTime } from '../lib/format';
import { isImagePath, mimeFor, parseDiff } from '../lib/diff';
import { IconBlame, IconHistory, IconX } from './Icons';
import { useRepo } from './RepoContext';

export function HistoryView({ file }: { file: string }) {
  const { repo, setCenter, select } = useRepo();
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>('');

  useEffect(() => {
    git
      .fileHistory(repo, file)
      .then((c) => {
        setCommits(c);
        if (c[0]) setActive(c[0].hash);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [repo, file]);

  useEffect(() => {
    if (!active) return;
    git.diffCommit(repo, active, file).then(setDiff).catch(() => setDiff(''));
  }, [repo, file, active]);

  const parsed = useMemo(() => parseDiff(diff), [diff]);

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="path">History: {file}</span>
        <button className="btn ghost" title="Blame" onClick={() => setCenter({ kind: 'blame', file })}>
          <IconBlame />
        </button>
        <button className="btn ghost" onClick={() => setCenter({ kind: 'graph' })}>
          <IconX />
        </button>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: 340, overflowY: 'auto', borderRight: '1px solid var(--border)' }}>
          {error && <div className="diff-msg">{error}</div>}
          {commits?.length === 0 && <div className="diff-msg">No history (the file may be untracked).</div>}
          {commits?.map((c) => (
            <div
              key={c.hash}
              className={`list-row${active === c.hash ? ' selected' : ''}`}
              onClick={() => setActive(c.hash)}
              onDoubleClick={() => {
                select({ kind: 'commit', hash: c.hash });
                setCenter({ kind: 'graph' });
                setTimeout(() => window.dispatchEvent(new CustomEvent('gitkrane:scrollTo', { detail: c.hash })), 50);
              }}
              title="Double-click to show in graph"
            >
              <span className="avatar" style={{ width: 22, height: 22, fontSize: 8, background: avatarColor(c.email) }}>
                {initials(c.author)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="s">{c.subject}</div>
                <div className="m">
                  {c.author} · {relativeTime(c.time)} · {c.hash.slice(0, 7)}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="diff-body">
          {parsed.hunks.map((h, i) => (
            <div className="hunk" key={i}>
              <div className="hunk-head">
                <span className="h">{h.header}</span>
              </div>
              {h.lines.map((l, k) => (
                <div key={k} className={`dl ${l.type === '+' ? 'add' : l.type === '-' ? 'del' : ''}`}>
                  <span className="no">{l.oldNo ?? ''}</span>
                  <span className="no">{l.newNo ?? ''}</span>
                  <span className="sign">{l.type === ' ' ? '' : l.type}</span>
                  <span className="tx">{l.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BlameView({ file, rev }: { file: string; rev?: string }) {
  const { repo, setCenter, select } = useRepo();
  const [blame, setBlame] = useState<Awaited<ReturnType<typeof git.blame>> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    git
      .blame(repo, file, rev)
      .then(setBlame)
      .catch((e) => setError(errorMessage(e)));
  }, [repo, file, rev]);

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="path">
          Blame: {file}
          {rev && <span className="dir"> @ {rev.slice(0, 7)}</span>}
        </span>
        <button className="btn ghost" onClick={() => setCenter({ kind: 'history', file })}>
          History
        </button>
        <button className="btn ghost" onClick={() => setCenter({ kind: 'graph' })}>
          <IconX />
        </button>
      </div>
      <div className="diff-body">
        {error && <div className="diff-msg">{error}</div>}
        {blame?.lines.map((l, i) => {
          const m = blame.meta[l.hash];
          const first = i === 0 || blame.lines[i - 1].hash !== l.hash;
          const uncommitted = /^0+$/.test(l.hash);
          return (
            <div key={i} className="blame-row">
              <div
                className={`bm${first ? ' first' : ''}`}
                title={m ? `${m.summary}\n${m.author} · ${absoluteTime(m.time)}` : ''}
                onDoubleClick={() => {
                  if (uncommitted) return;
                  select({ kind: 'commit', hash: l.hash });
                  setCenter({ kind: 'graph' });
                  setTimeout(() => window.dispatchEvent(new CustomEvent('gitkrane:scrollTo', { detail: l.hash })), 50);
                }}
              >
                {first && m && (
                  <>
                    <span style={{ fontFamily: 'var(--mono)' }}>{uncommitted ? 'working' : l.hash.slice(0, 7)}</span>
                    <span className="bs">{uncommitted ? 'Not committed yet' : m.summary}</span>
                    <span>{m.author?.split(' ')[0]}</span>
                  </>
                )}
              </div>
              <span className="no" style={{ width: 44, textAlign: 'right', color: 'var(--text-faint)', flexShrink: 0 }}>
                {i + 1}
              </span>
              <span className="tx">{l.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Read-only view of one file at a revision (from a commit's "All files" tree). */
export function FileContentView({ file, rev }: { file: string; rev: string }) {
  const { repo, setCenter, actions: a } = useRepo();
  const [blob, setBlob] = useState<{ base64: string | null; size: number; tooLarge: boolean } | null | 'missing'>(null);
  useEffect(() => {
    git.readBlob(repo, rev, file).then((b) => setBlob(b ?? 'missing'));
  }, [repo, rev, file]);

  const image = isImagePath(file);
  const text = useMemo(() => {
    if (!blob || blob === 'missing' || !blob.base64 || image) return null;
    const bytes = Uint8Array.from(atob(blob.base64), (ch) => ch.charCodeAt(0));
    // A NUL byte in the first 8 KB is git's own heuristic for "binary".
    if (bytes.subarray(0, 8000).includes(0)) return null;
    return new TextDecoder().decode(bytes);
  }, [blob, image]);

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="path">
          {file} <span className="dir">@ {rev.slice(0, 7)}</span>
        </span>
        <button className="btn" onClick={() => a.run('Restore file', () => git.restoreFile(repo, rev, file), { success: `Restored ${file} from ${rev.slice(0, 7)}` })}>
          Restore this version
        </button>
        <button className="btn ghost" title="History" onClick={() => setCenter({ kind: 'history', file })}>
          <IconHistory />
        </button>
        <button className="btn ghost" title="Blame at this revision" disabled={image} onClick={() => setCenter({ kind: 'blame', file, rev })}>
          <IconBlame />
        </button>
        <button className="btn ghost" onClick={() => setCenter({ kind: 'graph' })}>
          <IconX />
        </button>
      </div>
      <div className="diff-body file-view">
        {blob === null && <div className="diff-msg">Loading…</div>}
        {blob === 'missing' && <div className="diff-msg">File does not exist at this revision.</div>}
        {blob && blob !== 'missing' && blob.tooLarge && <div className="diff-msg">File is too large to preview.</div>}
        {blob && blob !== 'missing' && blob.base64 && image && (
          <div className="img-stage">
            <img className="img-check" src={`data:${mimeFor(file)};base64,${blob.base64}`} alt={file} />
          </div>
        )}
        {blob && blob !== 'missing' && blob.base64 && !image && text == null && <div className="diff-msg">Binary file.</div>}
        {text?.split('\n').map((line, i) => (
          <div key={i} className="dl">
            <span className="no">{i + 1}</span>
            <span className="tx">{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
