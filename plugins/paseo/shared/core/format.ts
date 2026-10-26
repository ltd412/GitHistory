// GENERATED from core/format.ts by scripts/sync-core.mjs — do not edit; change core/format.ts and run `npm run sync-core`.
/** Lane colours tuned for the dark background: bright, saturated. */
export const LANE_COLORS = [
  '#15a0bf',
  '#0669f7',
  '#8e00c2',
  '#c517b6',
  '#d90171',
  '#cd0101',
  '#f25d2e',
  '#f2ca33',
  '#7bd938',
  '#2ece9d',
];

/** Same hues, deepened for a white background so lines and white-on-colour labels stay legible. */
export const LANE_COLORS_LIGHT = [
  '#0b7ea6',
  '#2257d6',
  '#7c3aed',
  '#b4238f',
  '#cc1f5a',
  '#c0362c',
  '#c75a12',
  '#a07800',
  '#3b8a1f',
  '#0f8a73',
];

let palette = LANE_COLORS;
let lightTheme = false;

/** Called by the app shell whenever the effective theme changes (before the graph re-renders). */
export function setLanePalette(theme: 'dark' | 'light') {
  lightTheme = theme === 'light';
  palette = lightTheme ? LANE_COLORS_LIGHT : LANE_COLORS;
}

export const laneColor = (i: number) => palette[i % palette.length];

/** Two-digit hex alpha for lane-coloured row bands: subtle on white, a bit stronger on dark. */
export const bandAlpha = (hasRefs: boolean) => (lightTheme ? (hasRefs ? '1a' : '0b') : hasRefs ? '2e' : '17');
export const isLightTheme = () => lightTheme;

export function relativeTime(sec: number): string {
  const d = Date.now() / 1000 - sec;
  if (d < 60) return 'just now';
  const units: [number, string][] = [
    [31536000, 'year'],
    [2592000, 'month'],
    [604800, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [s, name] of units) {
    if (d >= s) {
      const n = Math.floor(d / s);
      return `${n} ${name}${n > 1 ? 's' : ''} ago`;
    }
  }
  return 'just now';
}

export function absoluteTime(sec: number): string {
  const d = new Date(sec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatTime(sec: number, mode: 'relative' | 'absolute'): string {
  return mode === 'relative' ? relativeTime(sec) : absoluteTime(sec);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarColor(key: string): string {
  return `hsl(${hash(key) % 360} 55% 42%)`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function splitPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf('/');
  return i === -1 ? { dir: '', name: p } : { dir: p.slice(0, i + 1), name: p.slice(i + 1) };
}

export function basename(p: string): string {
  return p.replace(/\/+$/, '').split('/').pop() || p;
}
