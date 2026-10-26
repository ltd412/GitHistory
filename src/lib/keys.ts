// Shortcut labels per platform: the macOS glyphs (⌘ ⇧ ⌥) are what the UI is written with; on Windows and
// Linux the same shortcuts are Ctrl / Shift / Alt (Electron's CmdOrCtrl accelerators).
const platform =
  (typeof window !== 'undefined' && (window as { bridge?: { platform?: string } }).bridge?.platform) ||
  (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent) ? 'darwin' : 'other');

export const IS_MAC = platform === 'darwin';

/** "⇧⌘S" → "Ctrl+Shift+S", "⌥T" → "Alt+T", "⌘-click" → "Ctrl-click" off macOS; unchanged on macOS. */
export const keyLabel = (text: string) => formatKeys(text, IS_MAC);

export function formatKeys(text: string, mac: boolean): string {
  if (mac || !/[⌘⇧⌥]/.test(text)) return text;
  return text
    .replace(/⌘-click/g, 'Ctrl-click')
    .replace(/([⌘⇧⌥]+)(\S)/g, (_m, mods: string, key: string) =>
      [mods.includes('⌘') && 'Ctrl', mods.includes('⌥') && 'Alt', mods.includes('⇧') && 'Shift', key].filter(Boolean).join('+'),
    );
}
