import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, git } from '../lib/api';
import { parseConflicts, type ConflictChunk } from '../lib/diff';
import { acceptAll, applySide, buildOutput, ignoreSide, initialResolutions, isResolved, resultLines, type Resolution, type SideName } from '../lib/merge';
import { IconX } from './Icons';
import { useRepo } from './RepoContext';

const FOLD_AT = 8;

/**
 * PyCharm-style three-way merge tool: Ours | Result | Theirs, aligned chunk by chunk.
 * » / « apply a side into the result, × ignores it; the result is editable. With nothing
 * applied a conflict shows the common ancestor, so the starting point is never a guess.
 */
export function ConflictView({ file }: { file: string }) {
  const { repo, data, actions: a, setCenter } = useRepo();
  const [source, setSource] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [error, setError] = useState('');
  const [res, setRes] = useState<Resolution[]>([]);
  const [current, setCurrent] = useState(0);
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set());
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        // Rebuilt from the index stages so the base is always available, whatever conflictStyle is set.
        const diff3 = await git.conflictDiff3(repo, file);
        if (diff3 != null) setSource(diff3);
        else {
          const v = await git.conflictVersions(repo, file);
          setSource(v.working);
          setFallback(true);
        }
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [repo, file]);

  const chunks = useMemo<ConflictChunk[]>(() => (source != null ? parseConflicts(source) : []), [source]);
  const conflictIdx = useMemo(() => chunks.map((c, i) => (c.kind === 'conflict' ? i : -1)).filter((i) => i >= 0), [chunks]);
  // Reset resolutions in the same render the chunks change (not in an effect): rendering the
  // new chunks against the old resolution list would index past its end.
  const [resFor, setResFor] = useState(chunks);
  if (resFor !== chunks) {
    setResFor(chunks);
    setRes(initialResolutions(chunks));
  }

  const remaining = conflictIdx.length - res.filter(isResolved).length;
  const output = useMemo(() => buildOutput(chunks, res), [chunks, res]);

  const go = (k: number) => {
    if (!conflictIdx.length) return;
    const n = (k + conflictIdx.length) % conflictIdx.length;
    setCurrent(n);
    rowRefs.current[conflictIdx[n]]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const update = (k: number, f: (r: Resolution) => Resolution) => setRes((rs) => rs.map((r, i) => (i === k ? f(r) : r)));

  // Several conflicted files are worked through in one go: after resolving one, the next opens.
  const conflictedFiles = data.status.conflicted.map((f) => f.path);
  const fileIndex = conflictedFiles.indexOf(file);
  const openFile = (path: string) => setCenter({ kind: 'conflict', file: path });
  const goNextFile = () => {
    const next = conflictedFiles.filter((p) => p !== file);
    if (next.length) openFile(next[Math.max(0, fileIndex) % next.length]);
    else setCenter({ kind: 'graph' });
  };

  const save = async () => {
    const ok = await a.run('Resolve conflict', async () => {
      await git.writeWorkingFile(repo, file, output);
      await git.resolveConflict(repo, file, 'mark');
    });
    if (ok) goNextFile();
  };
  const takeWhole = (side: 'ours' | 'theirs') =>
    a.run('Resolve', () => git.resolveConflict(repo, file, side)).then((ok) => ok && goNextFile());

  const rebasing = data.state.state === 'rebasing';
  // During a rebase "ours" is the branch being rebased onto, "theirs" the commit being replayed.
  const leftTitle = rebasing ? 'Upstream (onto)' : `Yours — ${data.refs.head ?? 'HEAD'}`;
  const rightTitle = rebasing ? 'Your commit' : 'Theirs — incoming';

  let k = -1;
  return (
    <div className="conflict">
      <div className="diff-head">
        {conflictedFiles.length > 1 && fileIndex !== -1 && (
          <>
            <button className="btn ghost" title="Previous conflicted file" onClick={() => openFile(conflictedFiles[(fileIndex - 1 + conflictedFiles.length) % conflictedFiles.length])}>
              ◀
            </button>
            <select className="input mt-filepick" value={file} onChange={(e) => openFile(e.target.value)} title="Conflicted files">
              {conflictedFiles.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <span className="mt-left">{conflictedFiles.length} files left</span>
            <button className="btn ghost" title="Next conflicted file" onClick={() => openFile(conflictedFiles[(fileIndex + 1) % conflictedFiles.length])}>
              ▶
            </button>
          </>
        )}
        <span className="path">Merge: {file}</span>
        {conflictIdx.length > 0 && (
          <>
            <span className={remaining ? 'mt-left' : 'mt-done'}>{remaining ? `${remaining} of ${conflictIdx.length} conflicts left` : 'All conflicts resolved'}</span>
            <button className="btn ghost" title="Previous conflict" onClick={() => go(current - 1)}>
              ▲
            </button>
            <button className="btn ghost" title="Next conflict" onClick={() => go(current + 1)}>
              ▼
            </button>
            <button className="btn" onClick={() => setRes((rs) => acceptAll(rs, 'ours'))}>
              Accept Left
            </button>
            <button className="btn" onClick={() => setRes((rs) => acceptAll(rs, 'theirs'))}>
              Accept Right
            </button>
          </>
        )}
        {fallback && (
          <>
            <button className="btn" onClick={() => takeWhole('ours')}>
              Take ours
            </button>
            <button className="btn" onClick={() => takeWhole('theirs')}>
              Take theirs
            </button>
          </>
        )}
        <button className="btn red" onClick={a.abort}>
          Abort {rebasing ? 'rebase' : 'merge'}
        </button>
        <button className="btn green" disabled={remaining > 0 || source == null} onClick={save}>
          {conflictedFiles.length > 1 ? 'Apply & next file' : 'Apply'}
        </button>
        <button className="btn ghost" title="Close" onClick={() => setCenter({ kind: 'graph' })}>
          <IconX />
        </button>
      </div>
      {error && <div className="diff-msg">{error}</div>}
      {fallback && source != null && (
        <div className="diff-note">
          One side added or deleted this file, so there is no common ancestor to merge against. Edit the result, or take one side as a whole.
        </div>
      )}
      <div className="mt-grid mt-head">
        <div>{leftTitle}</div>
        <div />
        <div>Result</div>
        <div />
        <div>{rightTitle}</div>
      </div>
      <div className="mt-body">
        {chunks.map((c, ci) => {
          if (c.kind === 'common') {
            const lines = c.lines!;
            const fold = lines.length > FOLD_AT && !unfolded.has(ci);
            const text = fold ? null : lines.join('\n');
            return (
              <div key={ci} className="mt-grid mt-common" ref={(el) => (rowRefs.current[ci] = el)}>
                {fold ? (
                  <div className="mt-fold" onClick={() => setUnfolded((u) => new Set(u).add(ci))}>
                    ··· {lines.length} unchanged lines ···
                  </div>
                ) : (
                  <>
                    <pre>{text}</pre>
                    <div />
                    <pre>{text}</pre>
                    <div />
                    <pre>{text}</pre>
                  </>
                )}
              </div>
            );
          }
          const idx = ++k;
          const r = res[idx];
          if (!r) return null;
          const result = resultLines(c, r).join('\n');
          const gutter = (side: SideName) =>
            r[side] === 'pending' ? (
              <div className="mt-gutter">
                <button className="mt-arrow" title={side === 'ours' ? 'Apply left into result' : 'Apply right into result'} onClick={() => update(idx, (x) => applySide(x, side))}>
                  {side === 'ours' ? '»' : '«'}
                </button>
                <button className="mt-x" title="Ignore this side" onClick={() => update(idx, (x) => ignoreSide(x, side))}>
                  ×
                </button>
              </div>
            ) : (
              <div className="mt-gutter">
                <span className={`mt-state ${r[side]}`} title={r[side] === 'applied' ? 'Applied — click to undo' : 'Ignored — click to undo'} onClick={() => update(idx, (x) => ({ ...x, [side]: 'pending', order: x.order.filter((s) => s !== side), manual: null }))}>
                  {r[side] === 'applied' ? '✓' : '–'}
                </span>
              </div>
            );
          return (
            <div
              key={ci}
              ref={(el) => (rowRefs.current[ci] = el)}
              className={`mt-grid mt-conflict${isResolved(r) ? ' resolved' : ''}${conflictIdx[current] === ci ? ' current' : ''}`}
              onClick={() => setCurrent(conflictIdx.indexOf(ci))}
            >
              <pre className={`mt-side ours ${r.ours}`}>{c.ours!.join('\n') || ' '}</pre>
              {gutter('ours')}
              <textarea
                className="mt-result"
                spellCheck={false}
                value={result}
                rows={Math.max(1, result.split('\n').length, c.ours!.length, c.theirs!.length)}
                placeholder={c.base ? '(empty)' : '(choose a side)'}
                onChange={(e) => update(idx, (x) => ({ ...x, manual: e.target.value }))}
              />
              {gutter('theirs')}
              <pre className={`mt-side theirs ${r.theirs}`}>{c.theirs!.join('\n') || ' '}</pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
