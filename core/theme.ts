export type ThemeMode = 'dark' | 'light' | 'system' | 'schedule';

const toMinutes = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN;
  return (Number(m[1]) % 24) * 60 + (Number(m[2]) % 60);
};

/**
 * Whether the light theme applies at `minutes` (minutes since midnight) for a schedule
 * "light from `lightFrom`, dark from `darkFrom`". Handles a window that wraps past midnight
 * (e.g. light 20:00 → dark 08:00). Invalid times fall back to 06:00 / 18:00.
 */
export function isLightAt(lightFrom: string, darkFrom: string, minutes: number): boolean {
  let start = toMinutes(lightFrom);
  let end = toMinutes(darkFrom);
  if (Number.isNaN(start)) start = 6 * 60;
  if (Number.isNaN(end)) end = 18 * 60;
  if (start === end) return true;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export function effectiveTheme(
  mode: ThemeMode,
  opts: { systemDark: boolean; now: Date; lightFrom: string; darkFrom: string },
): 'dark' | 'light' {
  if (mode === 'dark' || mode === 'light') return mode;
  if (mode === 'system') return opts.systemDark ? 'dark' : 'light';
  const minutes = opts.now.getHours() * 60 + opts.now.getMinutes();
  return isLightAt(opts.lightFrom, opts.darkFrom, minutes) ? 'light' : 'dark';
}

export const isValidTime = (hhmm: string) => !Number.isNaN(toMinutes(hhmm)) && /^\d{1,2}:\d{2}$/.test(hhmm.trim()) && Number(hhmm.split(':')[0]) < 24 && Number(hhmm.split(':')[1]) < 60;
