// First-launch chooser (and "Interface Style…" later): Kraken graph or JetBrains-style Git log.
import type { UiStyle } from '../lib/types';

const KRAKEN: { c: string; w: number }[] = [
  { c: '#15a0bf', w: 120 },
  { c: '#8e00c2', w: 96 },
  { c: '#f25d2e', w: 130 },
  { c: '#7bd938', w: 84 },
  { c: '#d90171', w: 110 },
];

function KrakenPreview() {
  return (
    <svg viewBox="0 0 260 150" className="sp-shot" aria-hidden>
      <rect width="260" height="150" fill="#1b1d23" />
      <rect width="260" height="18" fill="#15171c" />
      {KRAKEN.map((r, i) => (
        <g key={i} transform={`translate(0 ${24 + i * 24})`}>
          <rect width="260" height="22" fill={r.c} opacity=".13" />
          <rect x="8" y="5" width="56" height="12" rx="6" fill={r.c} opacity=".85" />
          <path d={`M92 0v22`} stroke={r.c} strokeWidth="2" />
          <circle cx="92" cy="11" r="8" fill={r.c} />
          <rect x="110" y="8" width={r.w} height="6" rx="3" fill="#d6d9e0" opacity=".7" />
          <rect x="226" y="8" width="24" height="6" rx="3" fill="#8c93a3" opacity=".6" />
        </g>
      ))}
    </svg>
  );
}

function JetBrainsPreview() {
  const rows = [0, 1, 2, 3, 4, 5];
  return (
    <svg viewBox="0 0 260 150" className="sp-shot" aria-hidden>
      <rect width="260" height="150" fill="#1e1f22" />
      <rect width="62" height="150" fill="#2b2d30" />
      <rect x="62" width="1" height="150" fill="#393b40" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x="8" y={12 + i * 14} width={34 + ((i * 11) % 14)} height="5" rx="2.5" fill="#868a91" opacity=".7" />
      ))}
      <rect x="63" width="197" height="16" fill="#2b2d30" />
      <rect x="70" y="5" width="40" height="6" rx="3" fill="#868a91" opacity=".6" />
      {rows.map((i) => (
        <g key={i} transform={`translate(63 ${18 + i * 20})`}>
          {i === 1 && <rect width="197" height="20" fill="#2e436e" />}
          <path d="M14 0v20" stroke="#3574f0" strokeWidth="1.5" />
          {i % 3 === 2 && <path d="M14 10C14 16 24 12 24 20" stroke="#8e00c2" strokeWidth="1.5" fill="none" />}
          <circle cx="14" cy="10" r="3.5" fill="#3574f0" />
          {i === 0 && <rect x="26" y="5" width="28" height="10" rx="3" fill="#3574f0" opacity=".85" />}
          <rect x={i === 0 ? 60 : 26} y="7" width={70 + ((i * 17) % 40)} height="6" rx="3" fill="#dfe1e5" opacity=".75" />
          <rect x="140" y="7" width="26" height="6" rx="3" fill="#868a91" opacity=".6" />
          <rect x="172" y="7" width="20" height="6" rx="3" fill="#868a91" opacity=".6" />
        </g>
      ))}
    </svg>
  );
}

const CHOICES: { id: UiStyle; name: string; blurb: string }[] = [
  { id: 'kraken', name: 'Kraken', blurb: 'Colourful lanes and row bands, avatars on the graph, branch labels in their own column.' },
  { id: 'jetbrains', name: 'JetBrains', blurb: 'The Git log of PyCharm / IntelliJ: filters, a branches tree, a table with graph, author, date and hash.' },
];

export function StylePicker({ current, onPick, onClose }: { current: UiStyle | null; onPick: (s: UiStyle) => void; onClose?: () => void }) {
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal style-picker">
        <h2>{current ? 'Interface style' : 'Choose your interface'}</h2>
        <p className="sp-sub">
          Same features either way — only the look of the history changes. You can switch at any time from the tab bar or Preferences.
        </p>
        <div className="sp-cards">
          {CHOICES.map((c) => (
            <button key={c.id} className={`sp-card${current === c.id ? ' on' : ''}`} onClick={() => onPick(c.id)} autoFocus={c.id === (current ?? 'kraken')}>
              {c.id === 'kraken' ? <KrakenPreview /> : <JetBrainsPreview />}
              <span className="sp-name">
                {c.name}
                {current === c.id && <em>current</em>}
              </span>
              <span className="sp-blurb">{c.blurb}</span>
            </button>
          ))}
        </div>
        {onClose && (
          <div className="sp-foot">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
