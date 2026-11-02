// The JetBrains log's View Options, kept in localStorage (a per-device display preference, like the IDE's).
import { useSyncExternalStore } from 'react';
import { DEFAULT_JB_OPTIONS, parseJbOptions, type JbLogOptions } from '../../lib/jb';

const KEY = 'githistory.jb.logOptions';
const listeners = new Set<() => void>();
let current: JbLogOptions = load();

function load(): JbLogOptions {
  try {
    const raw = localStorage.getItem(KEY);
    return parseJbOptions(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_JB_OPTIONS };
  }
}

export function setJbOptions(patch: Partial<JbLogOptions>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: the options last for this session */
  }
  listeners.forEach((l) => l());
}

export const useJbOptions = (): JbLogOptions =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
