/** Lane colours for the dark background: muted, so long sessions are not tiring (lower saturation and contrast). */
export const LANE_COLORS = [
  '#4a9db3',
  '#5a86d4',
  '#8d56ab',
  '#b0599f',
  '#c0587f',
  '#b55b59',
  '#d4875f',
  '#d4bd6c',
  '#86b862',
  '#59b79d',
];

/** Same hues, toned down for a light background; still dark enough for white-on-colour labels. */
export const LANE_COLORS_LIGHT = [
  '#3f8aa6',
  '#5273c4',
  '#7d5fc7',
  '#a65792',
  '#b85a76',
  '#ae5a52',
  '#b87546',
  '#9a8444',
  '#5f8f4c',
  '#468f80',
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
export const bandAlpha = (hasRefs: boolean) => (lightTheme ? (hasRefs ? '14' : '08') : hasRefs ? '22' : '10');
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
  return `hsl(${hash(key) % 360} 38% 46%)`;
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
