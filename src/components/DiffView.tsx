import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { app, errorMessage, git } from '../lib/api';
import { buildPatch, isImagePath, pairLines, parseDiff, splitRows, wordDiff, type DiffLine, type FileDiff, type Hunk, type WordSeg } from '../lib/diff';
import { splitPath } from '../lib/format';
import { WORKTREE, type CenterView, type DiffSource, type FileChange } from '../lib/types';
import { revLabel } from './ComparePanel';
import { IconBlame, IconFile, IconHistory, IconX, StatusIcon } from './Icons';
import { ImageDiff, type BlobSide } from './ImageDiff';
import { useUI } from './Overlays';
import { useRepo } from './RepoContext';

type DiffCenter = Extract<CenterView, { kind: 'diff' }>;
type Mode = 'side' | 'file' | 'hunk' | 'split';

// View preferences persist across files for the session, like a diff tool's toolbar state.
let lastMode: Mode = 'side';
let lastIgnoreWs = false;

/** Where the "before" and "after" versions of a file live for a given diff source. */
function blobSides(source: DiffSource, file: FileChange): [BlobSide, BlobSide] {
  const added = file.status === 'A' || file.status === '?' || !!file.untracked;
  const deleted = file.status === 'D';
  const oldPath = file.oldPath ?? file.path;
  const none: BlobSide = { rev: 'none', path: file.path };
  switch (source.kind) {
    case 'unstaged':
      return [added ? none : { rev: ':', path: file.path }, deleted ? none : { rev: null, path: file.path }];
    case 'staged':
      return [added ? none : { rev: 'HEAD', path: oldPath }, deleted ? none : { rev: ':', path: file.path }];
    case 'commit':
      return [added ? none : { rev: `${source.hash}^`, path: oldPath }, deleted ? none : { rev: source.hash, path: file.path }];
    case 'stash':
      if (file.untracked) return [none, { rev: `${source.hash}^3`, path: file.path }];
      return [added ? none : { rev: `${source.hash}^1`, path: oldPath }, deleted ? none : { rev: source.hash, path: file.path }];
    case 'range':
      return [
        added ? none : { rev: source.from, path: oldPath },
        deleted ? none : { rev: source.to === WORKTREE ? null : source.to, path: file.path },
      ];
  }
}

export function DiffView({ view }: { view: DiffCenter }) {
  const { repo, data, actions: a, setCenter } = useRepo();
  const ui = useUI();
  const { source, file } = view;
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState('');
  const [mode, setModeState] = useState<Mode>(lastMode);
  const [ignoreWs, setIgnoreWsState] = useState(lastIgnoreWs);
  const [sel, setSel] = useState<{ hunk: number; lines: Set<number> } | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const setMode = (m: Mode) => {
    lastMode = m;
    setModeState(m);
  };
  const setIgnoreWs = (v: boolean) => {
    lastIgnoreWs = v;
    setIgnoreWsState(v);
  };

  const image = isImagePath(file.path);
  // WHY: a whitespace-insensitive diff no longer matches the file byte for byte, so patches
  // built from it would not apply; partial staging is only offered on the exact diff.
  const editable = (source.kind === 'unstaged' || source.kind === 'staged') && !ignoreWs;
  const untracked = !!file.untracked;

  const load = useCallback(async () => {
    if (image) return;
    try {
      let text: string;
      // Side-by-side and File show the whole file, so they ask git for full context.
      const full = mode === 'side' || mode === 'file';
      if (source.kind === 'unstaged') text = await git.diffWorking(repo, file.path, { untracked, ignoreWs, full });
      else if (source.kind === 'staged') text = await git.diffWorking(repo, file.path, { staged: true, ignoreWs, full });
      else if (source.kind === 'commit') text = await git.diffCommit(repo, source.hash, file.path, file.oldPath, ignoreWs, full);
      else if (source.kind === 'stash') text = await git.diffStash(repo, source.hash, file.path, untracked, ignoreWs, full);
      else text = await git.diffRange(repo, source.from, source.to, file.path, file.oldPath, ignoreWs, full);
      setDiff(parseDiff(text));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [repo, source, file.path, file.oldPath, untracked, ignoreWs, image, mode]);

  // Working-tree diffs follow every status change (staging a hunk rewrites the diff).
  const isWorking = source.kind === 'unstaged' || source.kind === 'staged' || (source.kind === 'range' && source.to === WORKTREE);
  useEffect(() => {
    void load();
    setSel(null);
  }, [load, isWorking ? data.status : null]);

  const pairs = useMemo(() => diff?.hunks.map(pairLines) ?? [], [diff]);

  const close = () => setCenter({ kind: 'graph' });

  const applyHunk = async (h: Hunk, action: 'stage' | 'unstage' | 'discard', lines: Set<number> | null) => {
    if (!diff) return;
    if (untracked && action === 'stage') {
      // Partial staging of an untracked file has no base to patch against: stage the whole file.
      return void a.run('Stage', () => git.stage(repo, [file.path]));
    }
    if (action === 'discard') {
      const ok = await ui.confirm('Discard changes?', lines ? `Discard ${lines.size} selected line(s)?` : 'Discard this hunk? This cannot be undone.', {
        danger: true,
        confirm: 'Discard',
      });
      if (!ok) return;
    }
    const reverse = action !== 'stage';
    const patch = buildPatch(diff, h, lines, reverse);
    await a.run(action === 'stage' ? 'Stage' : action === 'unstage' ? 'Unstage' : 'Discard', () =>
      git.applyPatch(repo, patch, { cached: action !== 'discard', reverse }),
    );
    setSel(null);
  };

  const clickLine = (hi: number, li: number, l: DiffLine, e: React.MouseEvent) => {
    if (!editable || (l.type !== '+' && l.type !== '-')) return;
    const h = diff!.hunks[hi];
    setSel((cur) => {
      const lines = new Set(cur && cur.hunk === hi ? cur.lines : []);
      if (e.shiftKey && anchor != null && cur?.hunk === hi) {
        const [x, y] = anchor < li ? [anchor, li] : [li, anchor];
        for (let k = x; k <= y; k++) if (h.lines[k].type === '+' || h.lines[k].type === '-') lines.add(k);
      } else if (lines.has(li)) lines.delete(li);
      else lines.add(li);
      return lines.size ? { hunk: hi, lines } : null;
    });
    setAnchor(li);
  };

  /** Word segments for a changed line, or null to render it plainly. */
  const wordsFor = (hi: number, li: number): WordSeg[] | null => {
    const h = diff!.hunks[hi];
    const partner = pairs[hi]?.get(li);
    if (partner == null) return null;
    const l = h.lines[li];
    const p = h.lines[partner];
    const wd = l.type === '-' ? wordDiff(l.text, p.text) : wordDiff(p.text, l.text);
    if (!wd) return null;
    return l.type === '-' ? wd.left : wd.right;
  };

  const { dir, name } = splitPath(file.path);
  const fileAction = async (action: 'stage' | 'unstage' | 'discard') => {
    if (action === 'stage') await a.run('Stage', () => git.stage(repo, [file.path]));
    else if (action === 'unstage') await a.run('Unstage', () => git.unstage(repo, [file.path]));
    else if (await ui.confirm('Discard changes?', `${file.path}\n\nThis cannot be undone.`, { danger: true, confirm: 'Discard' }))
      await a.run('Discard', () => git.discard(repo, [file]));
    else return;
    close();
  };

  const showLineActions = (source.kind === 'unstaged' || source.kind === 'staged') && !image;

  return (
    <div className="diff">
      <div className="diff-head">
        <StatusIcon status={file.status} />
        <span className="path" title={file.path}>
          {file.oldPath && <span className="dir">{file.oldPath} → </span>}
          <span className="dir">{dir}</span>
          {name}
          {source.kind === 'range' && (
            <span className="dir">
              {'  '}
              {revLabel(source.from)} → {revLabel(source.to)}
            </span>
          )}
        </span>
        {source.kind === 'unstaged' && (
          <>
            <button className="btn red" onClick={() => fileAction('discard')}>
              Discard File
            </button>
            <button className="btn green" onClick={() => fileAction('stage')}>
              Stage File
            </button>
          </>
        )}
        {source.kind === 'staged' && (
          <button className="btn red" onClick={() => fileAction('unstage')}>
            Unstage File
          </button>
        )}
        {!image && (
          <>
            <label className="toggle-check" title="Ignore whitespace changes (disables line staging)">
              <input type="checkbox" checked={ignoreWs} onChange={(e) => setIgnoreWs(e.target.checked)} />
              Ignore whitespace
            </label>
            <div className="view-toggle">
              <button className={mode === 'side' ? 'on' : ''} onClick={() => setMode('side')} title="Whole file, old and new side by side">
                Side-by-side
              </button>
              <button className={mode === 'file' ? 'on' : ''} onClick={() => setMode('file')} title="The whole new file, changes highlighted in place">
                File
              </button>
              <button className={mode === 'hunk' ? 'on' : ''} onClick={() => setMode('hunk')}>
                Hunk
              </button>
              <button className={mode === 'split' ? 'on' : ''} onClick={() => setMode('split')}>
                Split
              </button>
            </div>
          </>
        )}
        <button className="btn ghost" title="File history" disabled={untracked} onClick={() => setCenter({ kind: 'history', file: file.path })}>
          <IconHistory />
        </button>
        <button
          className="btn ghost"
          title="Blame"
          disabled={untracked || file.status === 'D' || image}
          onClick={() => setCenter({ kind: 'blame', file: file.path, rev: source.kind === 'commit' ? source.hash : source.kind === 'range' && source.to !== WORKTREE ? source.to : undefined })}
        >
          <IconBlame />
        </button>
        <button className="btn ghost" title="Open file" onClick={() => void app.openFile(repo, file.path)}>
          <IconFile />
        </button>
        <button
          className="btn ghost"
          title="Expand: hide the side panels for a wide comparison (again to restore)"
          onClick={() => window.dispatchEvent(new CustomEvent('gitkrane:focusCenter'))}
        >
          ⤢
        </button>
        <button className="btn ghost" title="Close (Esc)" onClick={close}>
          <IconX />
        </button>
      </div>
      {image ? (
        <ImageDiff key={`${file.path}:${JSON.stringify(source)}`} sides={blobSides(source, file)} />
      ) : (
        <div className="diff-body" tabIndex={0} onKeyDown={(e) => e.key === 'Escape' && close()}>
          {error && <div className="diff-msg">{error}</div>}
          {diff?.binary && <div className="diff-msg">Binary file — no text diff available.</div>}
          {diff && !diff.binary && !diff.hunks.length && !error && (
            <div className="diff-msg">
              {ignoreWs ? 'Only whitespace changed.' : file.status === 'R' ? 'File renamed without content changes.' : 'No changes to show.'}
            </div>
          )}
          {ignoreWs && showLineActions && diff?.hunks.length ? (
            <div className="diff-note">Whitespace is ignored — turn it off to stage or discard individual hunks and lines.</div>
          ) : null}
          {mode === 'side' && diff && !diff.binary && diff.hunks.length > 0 && (
            <SideBySide
              diff={diff}
              labels={paneLabels(source)}
              wordsFor={wordsFor}
              selected={sel}
              selectable={editable}
              onLineClick={clickLine}
              lineActions={
                sel && editable ? (
                  <>
                    <span>
                      {sel.lines.size} line{sel.lines.size > 1 ? 's' : ''} selected
                    </span>
                    {source.kind === 'unstaged' && (
                      <>
                        <button className="btn red" onClick={() => applyHunk(diff.hunks[sel.hunk], 'discard', sel.lines)}>
                          Discard lines
                        </button>
                        <button className="btn green" onClick={() => applyHunk(diff.hunks[sel.hunk], 'stage', sel.lines)}>
                          Stage lines
                        </button>
                      </>
                    )}
                    {source.kind === 'staged' && (
                      <button className="btn red" onClick={() => applyHunk(diff.hunks[sel.hunk], 'unstage', sel.lines)}>
                        Unstage lines
                      </button>
                    )}
                    <button className="btn ghost" onClick={() => setSel(null)}>
                      Clear
                    </button>
                  </>
                ) : null
              }
            />
          )}
          {mode !== 'side' && diff?.hunks.map((h, hi) => {
            const lines = sel?.hunk === hi ? sel.lines : null;
            return (
              <div className="hunk" key={hi}>
                <div className="hunk-head">
                  <span className="h">{mode === 'file' ? `${file.path} — whole file` : h.header}</span>
                  {source.kind === 'unstaged' && editable && (
                    <>
                      <button className="btn red" onClick={() => applyHunk(h, 'discard', lines)}>
                        {lines ? `Discard ${lines.size} line${lines.size > 1 ? 's' : ''}` : 'Discard Hunk'}
                      </button>
                      <button className="btn green" onClick={() => applyHunk(h, 'stage', lines)}>
                        {lines ? `Stage ${lines.size} line${lines.size > 1 ? 's' : ''}` : 'Stage Hunk'}
                      </button>
                    </>
                  )}
                  {source.kind === 'staged' && editable && (
                    <button className="btn red" onClick={() => applyHunk(h, 'unstage', lines)}>
                      {lines ? `Unstage ${lines.size} line${lines.size > 1 ? 's' : ''}` : 'Unstage Hunk'}
                    </button>
                  )}
                </div>
                {mode === 'hunk' || mode === 'file' ? (
                  h.lines.map((l, li) => (
                    <Line
                      key={li}
                      l={l}
                      words={l.type === '+' || l.type === '-' ? wordsFor(hi, li) : null}
                      selected={!!lines?.has(li)}
                      selectable={editable && (l.type === '+' || l.type === '-')}
                      onClick={(e) => clickLine(hi, li, l, e)}
                    />
                  ))
                ) : (
                  <div className="split">
                    {(['left', 'right'] as const).map((side) => (
                      <div className="side" key={side}>
                        {splitRows(h).map((r, k) => {
                          const l = r[side];
                          const idx = side === 'left' ? r.index[0] : r.index[1];
                          if (!l) return <div key={k} className="dl empty">&nbsp;</div>;
                          return (
                            <Line
                              key={k}
                              l={l}
                              single={side}
                              words={l.type !== ' ' ? wordsFor(hi, idx) : null}
                              selected={!!lines?.has(idx)}
                              selectable={editable && l.type !== ' '}
                              onClick={(e) => clickLine(hi, idx, l, e)}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Line({
  l,
  words,
  selected,
  selectable,
  single,
  onClick,
}: {
  l: DiffLine;
  words: WordSeg[] | null;
  selected: boolean;
  selectable: boolean;
  single?: 'left' | 'right';
  onClick: (e: React.MouseEvent) => void;
}) {
  const cls = l.type === '+' ? 'add' : l.type === '-' ? 'del' : l.type === '\\' ? 'meta' : '';
  const mark = l.type === '+' ? 'wd-add' : 'wd-del';
  return (
    <div className={`dl ${cls}${selected ? ' sel' : ''}${selectable ? ' selectable' : ''}`} onClick={onClick}>
      {single !== 'right' && <span className="no">{l.oldNo ?? ''}</span>}
      {single !== 'left' && <span className="no">{l.newNo ?? ''}</span>}
      <span className="sign">{l.type === ' ' || l.type === '\\' ? '' : l.type}</span>
      <span className="tx">
        {l.type === '\\'
          ? l.text.trim()
          : words
            ? words.map((w, i) => (w.changed ? <span key={i} className={mark}>{w.text}</span> : w.text))
            : l.text}
      </span>
    </div>
  );
}

/** Pane titles for the side-by-side viewer: what the left (before) and right (after) sides are. */
function paneLabels(source: DiffSource): [string, string] {
  switch (source.kind) {
    case 'unstaged':
      return ['Index (staged)', 'Working tree'];
    case 'staged':
      return ['HEAD', 'Index (staged)'];
    case 'commit':
      return [`${source.hash.slice(0, 7)}^ (parent)`, source.hash.slice(0, 7)];
    case 'stash':
      return ['Base', 'Stash'];
    case 'range':
      return [revLabel(source.from), revLabel(source.to)];
  }
}

const CTX = 3;

/**
 * PyCharm-style diff: the whole file, old on the left and new on the right, aligned row by
 * row in one scroll container (so both sides always scroll together). Long unchanged stretches
 * fold; ▲/▼ jump between changes.
 */
function SideBySide({
  diff,
  labels,
  wordsFor,
  selected,
  selectable,
  onLineClick,
  lineActions,
}: {
  diff: FileDiff;
  labels: [string, string];
  wordsFor: (hi: number, li: number) => WordSeg[] | null;
  selected: { hunk: number; lines: Set<number> } | null;
  selectable: boolean;
  onLineClick: (hi: number, li: number, l: DiffLine, e: React.MouseEvent) => void;
  lineActions: React.ReactNode;
}) {
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState(-1);
  const changeRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Rows of every hunk, split into unchanged runs (foldable) and change blocks (navigable).
  const blocks = useMemo(() => {
    const out: { hi: number; kind: 'same' | 'change'; rows: ReturnType<typeof splitRows> }[] = [];
    diff.hunks.forEach((h, hi) => {
      for (const r of splitRows(h)) {
        const same = r.left?.type === ' ' && r.right?.type === ' ';
        const kind = same ? 'same' : 'change';
        const last = out[out.length - 1];
        if (last && last.hi === hi && last.kind === kind) last.rows.push(r);
        else out.push({ hi, kind, rows: [r] });
      }
    });
    return out;
  }, [diff]);
  const changeCount = blocks.filter((b) => b.kind === 'change').length;

  const go = (d: 1 | -1) => {
    if (!changeCount) return;
    const n = (current + d + changeCount) % changeCount;
    setCurrent(n);
    changeRefs.current[n]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const cell = (hi: number, l: DiffLine | null, idx: number, side: 'left' | 'right', k: string) => {
    if (!l) return <div key={k} className="sb-cell empty" />;
    const words = l.type !== ' ' ? wordsFor(hi, idx) : null;
    const mark = l.type === '+' ? 'wd-add' : 'wd-del';
    const cls = l.type === '+' ? 'add' : l.type === '-' ? 'del' : '';
    const isSel = selected?.hunk === hi && selected.lines.has(idx);
    return (
      <div
        key={k}
        className={`sb-cell ${cls}${isSel ? ' sel' : ''}${selectable && l.type !== ' ' ? ' selectable' : ''}`}
        onClick={(e) => l.type !== ' ' && onLineClick(hi, idx, l, e)}
      >
        <span className="no">{side === 'left' ? (l.oldNo ?? '') : (l.newNo ?? '')}</span>
        <span className="tx">{words ? words.map((w, i) => (w.changed ? <span key={i} className={mark}>{w.text}</span> : w.text)) : l.text}</span>
      </div>
    );
  };

  let change = -1;
  return (
    <div className="sb">
      <div className="sb-head">
        <div className="sb-title">{labels[0]}</div>
        <div className="sb-title">{labels[1]}</div>
        <div className="sb-nav">
          {lineActions}
          <span className="sb-count">
            {changeCount} change{changeCount === 1 ? '' : 's'}
          </span>
          <button className="btn ghost" title="Previous change" onClick={() => go(-1)}>
            ▲
          </button>
          <button className="btn ghost" title="Next change" onClick={() => go(1)}>
            ▼
          </button>
        </div>
      </div>
      {blocks.map((b, bi) => {
        if (b.kind === 'change') {
          const ci = ++change;
          return (
            <div key={bi} ref={(el) => (changeRefs.current[ci] = el)} className={`sb-block change${ci === current ? ' current' : ''}`}>
              {b.rows.map((r, k) => (
                <div key={k} className="sb-row">
                  {cell(b.hi, r.left, r.index[0], 'left', `l${k}`)}
                  {cell(b.hi, r.right, r.index[1], 'right', `r${k}`)}
                </div>
              ))}
            </div>
          );
        }
        // Unchanged stretch: keep a few lines of context next to changes, fold the middle.
        const key = `${bi}`;
        const isFirst = bi === 0;
        const isLast = bi === blocks.length - 1;
        const head = isFirst ? 0 : CTX;
        const tail = isLast ? 0 : CTX;
        const foldable = b.rows.length > head + tail + 2 && !unfolded.has(key);
        const shown = foldable ? [...b.rows.slice(0, head), null, ...b.rows.slice(b.rows.length - tail)] : b.rows;
        return (
          <div key={bi} className="sb-block">
            {shown.map((r, k) =>
              r ? (
                <div key={k} className="sb-row">
                  {cell(b.hi, r.left, r.index[0], 'left', `l${k}`)}
                  {cell(b.hi, r.right, r.index[1], 'right', `r${k}`)}
                </div>
              ) : (
                <div key={k} className="sb-fold" onClick={() => setUnfolded((u) => new Set(u).add(key))}>
                  ··· {b.rows.length - head - tail} unchanged lines ···
                </div>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}
