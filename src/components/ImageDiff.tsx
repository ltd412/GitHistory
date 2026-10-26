import { useEffect, useState } from 'react';
import { git } from '../lib/api';
import { mimeFor } from '../lib/diff';
import { useRepo } from './RepoContext';

/** rev: a revision, ':' for the index, null for the working tree, 'none' when the side does not exist. */
export interface BlobSide {
  rev: string | null;
  path: string;
}

interface Loaded {
  url: string | null;
  size: number;
  tooLarge: boolean;
  w: number;
  h: number;
}

type Mode = '2up' | 'swipe' | 'onion';
let lastMode: Mode = '2up';

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function useBlob(repo: string, side: BlobSide): Loaded | null | 'missing' {
  const [state, setState] = useState<Loaded | null | 'missing'>(null);
  useEffect(() => {
    if (side.rev === 'none') return setState('missing');
    let alive = true;
    void git.readBlob(repo, side.rev, side.path).then((b) => {
      if (!alive) return;
      if (!b) return setState('missing');
      if (!b.base64) return setState({ url: null, size: b.size, tooLarge: true, w: 0, h: 0 });
      const url = `data:${mimeFor(side.path)};base64,${b.base64}`;
      const img = new Image();
      img.onload = () => alive && setState({ url, size: b.size, tooLarge: false, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => alive && setState({ url, size: b.size, tooLarge: false, w: 0, h: 0 });
      img.src = url;
    });
    return () => {
      alive = false;
    };
  }, [repo, side.rev, side.path]);
  return state;
}

export function ImageDiff({ sides }: { sides: [BlobSide, BlobSide] }) {
  const { repo } = useRepo();
  const before = useBlob(repo, sides[0]);
  const after = useBlob(repo, sides[1]);
  const [mode, setModeState] = useState<Mode>(lastMode);
  const [pos, setPos] = useState(50);
  const setMode = (m: Mode) => {
    lastMode = m;
    setModeState(m);
  };
  const both = before && after && before !== 'missing' && after !== 'missing' && before.url && after.url;

  const info = (label: string, b: Loaded | null | 'missing') => (
    <div className="img-info">
      <b>{label}</b>{' '}
      {b === 'missing' ? 'does not exist' : !b ? 'loading…' : b.tooLarge ? `${kb(b.size)} — too large to preview` : `${b.w}×${b.h} · ${kb(b.size)}`}
    </div>
  );
  const img = (b: Loaded | null | 'missing', cls: string) =>
    b && b !== 'missing' && b.url ? <img className={`img-check ${cls}`} src={b.url} alt="" draggable={false} /> : <div className="img-empty">—</div>;

  return (
    <div className="img-diff">
      <div className="img-toolbar">
        {info('Before', before)}
        {info('After', after)}
        <div className="view-toggle">
          <button className={mode === '2up' ? 'on' : ''} onClick={() => setMode('2up')}>
            Side by side
          </button>
          <button className={mode === 'swipe' ? 'on' : ''} disabled={!both} onClick={() => setMode('swipe')}>
            Swipe
          </button>
          <button className={mode === 'onion' ? 'on' : ''} disabled={!both} onClick={() => setMode('onion')}>
            Onion skin
          </button>
        </div>
      </div>
      <div className="img-stage">
        {mode === '2up' || !both ? (
          <div className="img-2up">
            <div className="img-cell del">{img(before, '')}</div>
            <div className="img-cell add">{img(after, '')}</div>
          </div>
        ) : (
          <div className="img-overlay">
            <div className="img-stack">
              {img(before, 'under')}
              <div className="img-top" style={mode === 'swipe' ? { clipPath: `inset(0 0 0 ${pos}%)` } : { opacity: pos / 100 }}>
                {img(after, '')}
              </div>
              {mode === 'swipe' && <div className="img-swipe-line" style={{ left: `${pos}%` }} />}
            </div>
            <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="img-slider" />
          </div>
        )}
      </div>
    </div>
  );
}
